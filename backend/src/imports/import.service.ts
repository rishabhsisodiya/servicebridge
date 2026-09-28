import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { PrismaService } from '../core/prisma/prisma.service';
import { AuditService } from '../core/audit/audit.service';
import { AppException, validationFailed } from '../core/http/app.exception';
import type { AuthUser, ClientInfo } from '../auth/auth.types';
import type { Permission } from '../auth/permissions';
import {
  ConfirmImportDto,
  IMPORT_ENTITIES,
  type ImportEntity,
  type RowMode,
} from './dto';

export const IMPORTS_EDIT: Permission = 'imports.edit';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 2000;
const VALIDATION_TTL_MS = 30 * 60 * 1000;

export type RowStatus = 'valid' | 'warning' | 'error';

export interface PreviewRow {
  index: number;
  data: Record<string, string>;
  status: RowStatus;
  errors: string[];
  /** Human note shown alongside the row, e.g. which existing record matched. */
  note: string | null;
  /** Default disposition the confirm step will use unless overridden. */
  defaultMode: Exclude<RowMode, 'skip'> | 'skip';
  matchedExisting: { id: string; name: string } | null;
}

export interface ValidationPreview {
  validationId: string;
  entity: ImportEntity;
  columns: string[];
  rows: PreviewRow[];
  summary: { valid: number; warning: number; error: number };
  expiresAt: string;
}

export interface ImportReport {
  created: number;
  updated: number;
  skipped: number;
  errors: { index: number; message: string }[];
}

interface HeldValidation {
  entity: ImportEntity;
  rows: PreviewRow[];
  expiresAt: number;
}

const CUSTOMER_COLUMNS = ['name', 'customer_group', 'territory', 'tax_id', 'mobile', 'email'];
const MACHINE_COLUMNS = [
  'serial_no',
  'item_code',
  'item_name',
  'customer_name',
  'warranty_expires_on',
  'amc_expires_on',
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const normalize = (value: string) => value.trim().toLowerCase();
const isBlank = (value: string | null | undefined) => !value || !value.trim();

/** Minimal shape of a multer memory-storage file. */
export interface UploadedFileLike {
  originalname: string;
  size: number;
  buffer: Buffer;
}

function parseDateCell(value: string, field: string): Date | null {
  if (isBlank(value)) return null;
  if (!DATE_RE.test(value.trim())) {
    throw new AppException('VALIDATION_FAILED', `Bad date in ${field}: use YYYY-MM-DD.`, HttpStatus.UNPROCESSABLE_ENTITY);
  }
  const date = new Date(`${value.trim()}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new AppException('VALIDATION_FAILED', `Bad date in ${field}: use YYYY-MM-DD.`, HttpStatus.UNPROCESSABLE_ENTITY);
  }
  return date;
}

@Injectable()
export class ImportService {
  private readonly logger = new Logger(ImportService.name);
  /** Server-held validation sessions: the preview can't be tampered with between validate and confirm. */
  private readonly held = new Map<string, HeldValidation>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  assertEntity(entity: string): ImportEntity {
    if ((IMPORT_ENTITIES as readonly string[]).includes(entity)) return entity as ImportEntity;
    throw new AppException('NOT_FOUND', 'Unknown import entity.', HttpStatus.NOT_FOUND);
  }

  async validate(entity: ImportEntity, file: UploadedFileLike | undefined): Promise<ValidationPreview> {
    this.sweepExpired();
    if (!file) {
      throw validationFailed([{ field: 'file', message: 'Attach a CSV file.' }]);
    }
    if (file.size > MAX_FILE_BYTES) {
      throw validationFailed([{ field: 'file', message: 'The file must be under 5 MB.' }]);
    }
    const name = file.originalname.toLowerCase();
    if (!name.endsWith('.csv')) {
      throw validationFailed([{ field: 'file', message: 'Only .csv files are accepted.' }]);
    }

    let records: Record<string, string>[];
    try {
      records = parse(file.buffer.toString('utf-8'), {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        // Real-world CSVs are ragged (trailing commas, short rows); missing
        // cells become '' via pick(), extras are ignored.
        relax_column_count: true,
      }) as Record<string, string>[];
    } catch {
      throw validationFailed([{ field: 'file', message: 'Could not parse the CSV file.' }]);
    }
    if (records.length > MAX_ROWS) {
      throw validationFailed([
        { field: 'file', message: `The file has more than ${MAX_ROWS} rows.` },
      ]);
    }

    const expected = entity === 'customers' ? CUSTOMER_COLUMNS : MACHINE_COLUMNS;
    const header = records.length ? Object.keys(records[0]) : [];
    const missing = expected.filter((c) => c === 'name' || c === 'serial_no').filter((c) => !header.includes(c));
    if (missing.length) {
      throw validationFailed([
        { field: 'file', message: `Missing required column: ${missing.join(', ')}.` },
      ]);
    }

    const rows =
      entity === 'customers' ? await this.validateCustomers(records) : await this.validateMachines(records);

    const validationId = `imp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    this.held.set(validationId, { entity, rows, expiresAt: Date.now() + VALIDATION_TTL_MS });
    this.logger.log({ entity, rows: rows.length }, 'Import validated');
    return {
      validationId,
      entity,
      columns: header,
      rows,
      summary: {
        valid: rows.filter((r) => r.status === 'valid').length,
        warning: rows.filter((r) => r.status === 'warning').length,
        error: rows.filter((r) => r.status === 'error').length,
      },
      expiresAt: new Date(Date.now() + VALIDATION_TTL_MS).toISOString(),
    };
  }

  async confirm(
    entity: ImportEntity,
    dto: ConfirmImportDto,
    actor: AuthUser,
    client: ClientInfo,
  ): Promise<ImportReport> {
    this.sweepExpired();
    const held = this.held.get(dto.validationId);
    if (!held || held.entity !== entity) {
      throw new AppException(
        'VALIDATION_EXPIRED',
        'That validation has expired. Upload the file again.',
        HttpStatus.GONE,
      );
    }
    const overrides = new Map((dto.rows ?? []).map((r) => [r.index, r.mode]));
    const report: ImportReport = { created: 0, updated: 0, skipped: 0, errors: [] };

    for (const row of held.rows) {
      const mode = overrides.get(row.index) ?? row.defaultMode;
      if (mode === 'skip' || row.status === 'error') {
        report.skipped += 1;
        continue;
      }
      try {
        if (entity === 'customers') await this.applyCustomerRow(row, mode);
        else await this.applyMachineRow(row, mode);
        if (mode === 'create') report.created += 1;
        else report.updated += 1;
      } catch (error) {
        report.skipped += 1;
        report.errors.push({
          index: row.index,
          message: error instanceof Error ? error.message : 'Import failed.',
        });
      }
    }

    await this.audit.record({
      actorId: actor.id,
      action: entity === 'customers' ? 'import.customers' : 'import.equipment',
      entityType: 'Import',
      summary:
        `Bulk import of ${entity}: ${report.created} created, ` +
        `${report.updated} updated, ${report.skipped} skipped.`,
      ip: client.ip,
      requestId: client.requestId,
    });
    this.held.delete(dto.validationId);
    this.logger.log({ entity, ...report }, 'Import confirmed');
    return report;
  }

  // ─── Customers ────────────────────────────────────────────────────────────

  private async validateCustomers(records: Record<string, string>[]): Promise<PreviewRow[]> {
    const existing = await this.prisma.customer.findMany({
      select: { id: true, name: true, taxId: true },
    });
    const byName = new Map(existing.map((c) => [normalize(c.name), c]));
    const byTaxId = new Map(
      existing.filter((c) => c.taxId).map((c) => [normalize(c.taxId!), c]),
    );
    const seenInFile = new Set<string>();
    return records.map((record, i) => {
      const data = pick(record, CUSTOMER_COLUMNS);
      const errors: string[] = [];
      const name = data.name.trim();
      if (!name) errors.push('name is required.');
      if (data.email && !EMAIL_RE.test(data.email)) errors.push('email looks invalid.');
      if (data.mobile && data.mobile.length > 30) errors.push('mobile is too long.');
      const key = normalize(name);
      if (name && seenInFile.has(key)) errors.push('Duplicate customer name in this file.');
      seenInFile.add(key);
      const matched = name
        ? (byName.get(key) ?? (data.tax_id ? byTaxId.get(normalize(data.tax_id)) : undefined) ?? null)
        : null;
      const status: RowStatus = errors.length ? 'error' : matched ? 'warning' : 'valid';
      return {
        index: i + 1,
        data,
        status,
        errors,
        note:
          matched && status !== 'error'
            ? `Matches existing customer "${matched.name}" — updates fill blanks only.`
            : null,
        defaultMode: status === 'error' ? 'skip' : matched ? 'update-fill' : 'create',
        matchedExisting: matched ? { id: matched.id, name: matched.name } : null,
      };
    });
  }

  private async applyCustomerRow(row: PreviewRow, mode: Exclude<RowMode, 'skip'>): Promise<void> {
    const d = row.data;
    if (mode === 'create') {
      await this.prisma.customer.create({
        data: {
          source: 'IMPORT',
          name: d.name.trim(),
          customerGroup: d.customer_group || null,
          territory: d.territory || null,
          taxId: d.tax_id || null,
          mobile: d.mobile || null,
          email: d.email || null,
        },
      });
      return;
    }
    const id = row.matchedExisting?.id;
    if (!id) throw new Error('No matching customer to update.');
    const existing = await this.prisma.customer.findUnique({ where: { id } });
    if (!existing) throw new Error('The matching customer no longer exists.');
    const patch: Record<string, string | null> = {
      customerGroup: d.customer_group || null,
      territory: d.territory || null,
      taxId: d.tax_id || null,
      mobile: d.mobile || null,
      email: d.email || null,
    };
    const data: Record<string, string | null> = {};
    for (const [field, value] of Object.entries(patch)) {
      if (value === null) continue;
      const current = (existing as unknown as Record<string, string | null>)[field];
      if (mode === 'update-overwrite' || isBlank(current)) data[field] = value;
    }
    if (Object.keys(data).length) {
      await this.prisma.customer.update({ where: { id }, data });
    }
  }

  // ─── Machines ─────────────────────────────────────────────────────────────

  private async validateMachines(records: Record<string, string>[]): Promise<PreviewRow[]> {
    const customers = await this.prisma.customer.findMany({
      where: { active: true },
      select: { id: true, name: true },
    });
    const customerByName = new Map(customers.map((c) => [normalize(c.name), c]));
    const seenSerials = new Set<string>();
    const rows: PreviewRow[] = [];
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const data = pick(record, MACHINE_COLUMNS);
      const errors: string[] = [];
      const serial = data.serial_no.trim();
      if (!serial) errors.push('serial_no is required.');
      if (serial && seenSerials.has(normalize(serial))) {
        errors.push('Duplicate serial_no in this file.');
      }
      seenSerials.add(normalize(serial));
      for (const field of ['warranty_expires_on', 'amc_expires_on'] as const) {
        if (data[field] && !DATE_RE.test(data[field])) {
          errors.push(`${field} must be YYYY-MM-DD.`);
        }
      }
      let matched: { id: string; name: string } | null = null;
      if (serial && !errors.length) {
        const existing = await this.prisma.equipment.findFirst({
          where: { serialNo: serial },
          select: { id: true, serialNo: true },
        });
        matched = existing ? { id: existing.id, name: existing.serialNo } : null;
      }
      let customerId: string | null = null;
      if (data.customer_name) {
        const customer = customerByName.get(normalize(data.customer_name));
        if (!customer) {
          errors.push(
            `No customer matches "${data.customer_name}". Import the customer first.`,
          );
        } else {
          customerId = customer.id;
        }
      }
      const status: RowStatus = errors.length ? 'error' : matched ? 'warning' : 'valid';
      rows.push({
        index: i + 1,
        data: { ...data, _customerId: customerId ?? '' },
        status,
        errors,
        note:
          matched && status !== 'error'
            ? `Serial ${serial} already exists — updates fill blanks only.`
            : null,
        defaultMode: status === 'error' ? 'skip' : matched ? 'update-fill' : 'create',
        matchedExisting: matched,
      });
    }
    return rows;
  }

  private async applyMachineRow(row: PreviewRow, mode: Exclude<RowMode, 'skip'>): Promise<void> {
    const d = row.data;
    const customerId = d._customerId || null;
    const dates = {
      warrantyExpiresOn: parseDateCell(d.warranty_expires_on, 'warranty_expires_on'),
      amcExpiresOn: parseDateCell(d.amc_expires_on, 'amc_expires_on'),
    };
    if (mode === 'create') {
      await this.prisma.equipment.create({
        data: {
          source: 'IMPORT',
          serialNo: d.serial_no.trim(),
          itemCode: d.item_code || null,
          itemName: d.item_name || null,
          customerId,
          ...dates,
        },
      });
      return;
    }
    const id = row.matchedExisting?.id;
    if (!id) throw new Error('No matching machine to update.');
    const existing = await this.prisma.equipment.findUnique({ where: { id } });
    if (!existing) throw new Error('The matching machine no longer exists.');
    const patch: Record<string, string | Date | null> = {
      itemCode: d.item_code || null,
      itemName: d.item_name || null,
      warrantyExpiresOn: dates.warrantyExpiresOn,
      amcExpiresOn: dates.amcExpiresOn,
    };
    const data: Record<string, string | Date | null> = {};
    for (const [field, value] of Object.entries(patch)) {
      if (value === null) continue;
      const current = (existing as unknown as Record<string, string | Date | null>)[field];
      if (mode === 'update-overwrite' || current === null) data[field] = value;
    }
    if (customerId && (mode === 'update-overwrite' || !existing.customerId)) {
      data.customerId = customerId;
    }
    if (Object.keys(data).length) {
      await this.prisma.equipment.update({ where: { id }, data });
    }
  }

  private sweepExpired(): void {
    const now = Date.now();
    for (const [id, held] of this.held) {
      if (held.expiresAt <= now) this.held.delete(id);
    }
  }
}

function pick(record: Record<string, string>, columns: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const column of columns) {
    const value = record[column];
    out[column] = typeof value === 'string' ? value : '';
  }
  return out;
}
