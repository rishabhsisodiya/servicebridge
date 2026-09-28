import { HttpStatus, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { ErpWriteback, Prisma, WritebackType } from '@prisma/client';
import type { Job } from 'bullmq';
import type { AuthUser, ClientInfo } from '../../auth/auth.types';
import { AutomationsService } from '../../automations/automations.service';
import { AuditService } from '../../core/audit/audit.service';
import { AppException, validationFailed } from '../../core/http/app.exception';
import { stripUrlCredentials } from '../../core/logging/redact';
import { PrismaService } from '../../core/prisma/prisma.service';
import { QueueService } from '../../core/queue/queue.service';
import {
  AppSettingsService,
  INVOICE_TRIGGERS,
  type InvoiceTrigger,
  type WritebackSettings,
} from '../../demo/app-settings.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { rolesWith } from '../../roles/role-filters';
import { FrappeRestClient } from '../adapters/frappe-rest.client';
import { SB_REF_DOCTYPES, SB_REF_FIELD } from '../connection-tester';
import { ErpConnectionsService } from '../connections/erp-connections.service';
import { ErpError } from '../erp.types';

/** Automation keys: each write-back has its own switch, off by default. */
export const INVOICE_KEY = 'writeback-invoice';
export const STOCK_ENTRY_KEY = 'writeback-stock-entry';

/** Approved retry policy: 5 attempts, exponential backoff from 60 s. */
const MAX_ATTEMPTS = 5;
const BACKOFF_MS = 60_000;

const jobIdFor = (type: WritebackType, sourceId: string) =>
  `writeback-${type === 'INVOICE' ? 'invoice' : 'stock-entry'}-${sourceId}`;

const idempotencyKeyFor = (type: WritebackType, sourceId: string) =>
  `${type === 'INVOICE' ? 'invoice' : 'stock-entry'}-${sourceId}`;

interface WritebackJobData {
  automationKey: string;
  trigger: 'EVENT';
  writebackId: string;
  actorId?: string;
}

export interface SetupCheckResult {
  ok: boolean;
  connection: { id: string; name: string; status: string } | null;
  readyForWriteback: boolean;
  missingFields: { doctype: string; fieldname: string }[];
  /** True when the field check itself couldn't run (e.g. the ERP was unreachable). */
  fieldCheckUnknown: boolean;
  fieldInstructions: string;
}

/**
 * Why ServiceBridge stamps its own reference on ERP documents: without
 * `custom_sb_ref` the worker can't pre-search for a document it already
 * created, and a retry after a network timeout could post a duplicate.
 * Rishabh decided against auto-creating the field, so the setup check fails
 * closed instead: the admin UI shows exactly which fields are missing with
 * copy-paste instructions for ERPNext's Customize Form.
 */
export const FIELD_INSTRUCTIONS = [
  'ServiceBridge stamps every document it creates with a reference field so',
  'retries can never post duplicates. Create it once per document type:',
  '',
  '1. In ERPNext open the document list (Stock > Stock Entry, or',
  '   Accounting > Sales Invoice), then the menu > Customize.',
  '2. Add a custom field: label "ServiceBridge ref", fieldname',
  '   "custom_sb_ref" (exactly), type Data. Save the customization.',
  '3. Repeat for the other document type, then re-run the setup check here.',
].join('\n');

const typeLabel = (type: WritebackType) => (type === 'INVOICE' ? 'Sales invoice' : 'Stock entry');

/**
 * ERP write-backs (session 11). Draft sales invoices from the ticket's sent
 * quotation lines (zero bill when the ticket is AMC-covered), and material-
 * issue stock entries for spares used on submitted visits. Everything goes
 * through the Frappe REST API; the MariaDB connection stays read-only.
 *
 * No polling: each write-back is one BullMQ job with a fixed job id, 5
 * attempts and exponential backoff. Handlers re-read the database, pre-search
 * the ERP by `custom_sb_ref` before creating anything, and fail closed when
 * the connection or the custom fields aren't ready.
 */
@Injectable()
export class WritebacksService implements OnModuleInit {
  private readonly logger = new Logger(WritebacksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    private readonly automations: AutomationsService,
    private readonly audit: AuditService,
    private readonly settings: AppSettingsService,
    private readonly connections: ErpConnectionsService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.automations.define(
      {
        key: INVOICE_KEY,
        name: 'ERP sales invoices',
        description:
          'Creates a draft sales invoice in the ERP from the ticket\u2019s sent quotation lines when a ticket is closed (or verified, per the write-back settings). Each ticket gets its own job; nothing runs when the switch is off.',
        category: 'ERP',
        queue: 'erp-writeback',
        kind: 'event',
        defaultEnabled: false,
      },
      async ({ job }) => this.run(job),
    );
    this.automations.define(
      {
        key: STOCK_ENTRY_KEY,
        name: 'ERP stock entries',
        description:
          'Posts a draft material-issue stock entry in the ERP for stock spares used on a submitted visit. Each visit gets its own job; non-stock spares are skipped; nothing runs when the switch is off.',
        category: 'ERP',
        queue: 'erp-writeback',
        kind: 'event',
        defaultEnabled: false,
      },
      async ({ job }) => this.run(job),
    );
  }

  // ── Event entry points (never throw: queueing must not block ticket/visit work) ──

  /** Called after a ticket close/verify commits. */
  async onTicketAction(
    action: string,
    ticket: { id: string; number: string },
    actorId: string,
  ): Promise<void> {
    try {
      if (!INVOICE_TRIGGERS.includes(action as InvoiceTrigger)) return;
      const settings = await this.settings.writebacks();
      if (!settings.invoiceTriggers.includes(action as InvoiceTrigger)) return;
      if (!(await this.automations.isEnabled(INVOICE_KEY))) return;
      await this.ensureQueued('INVOICE', ticket.id, { ticketId: ticket.id }, actorId);
    } catch (error) {
      this.logger.error(
        `Could not queue the invoice write-back for ticket ${ticket.id}: ${(error as Error).message}`,
      );
    }
  }

  /** Called after a visit submit commits. */
  async onVisitSubmitted(visitId: string, actorId: string): Promise<void> {
    try {
      if (!(await this.automations.isEnabled(STOCK_ENTRY_KEY))) return;
      await this.ensureQueued('STOCK_ENTRY', visitId, { visitId }, actorId);
    } catch (error) {
      this.logger.error(
        `Could not queue the stock-entry write-back for visit ${visitId}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Creates (or resets) the write-back row and enqueues its job. A SUCCEEDED
   * row is left alone: re-closing a ticket must never invoice twice.
   */
  private async ensureQueued(
    type: WritebackType,
    sourceId: string,
    link: { ticketId: string } | { visitId: string },
    actorId: string,
  ): Promise<void> {
    const idempotencyKey = idempotencyKeyFor(type, sourceId);
    const existing = await this.prisma.erpWriteback.findUnique({ where: { idempotencyKey } });
    if (existing?.status === 'SUCCEEDED') return;
    const writeback = await this.prisma.erpWriteback.upsert({
      where: { idempotencyKey },
      create: {
        type,
        status: 'PENDING',
        ...link,
        idempotencyKey,
        erpDocType: type === 'INVOICE' ? 'Sales Invoice' : 'Stock Entry',
        createdById: actorId,
      },
      update: { status: 'PENDING', error: null, attempts: 0, erpDocName: null },
    });
    const key = type === 'INVOICE' ? INVOICE_KEY : STOCK_ENTRY_KEY;
    const data: WritebackJobData = {
      automationKey: key,
      trigger: 'EVENT',
      writebackId: writeback.id,
      actorId,
    };
    await this.queues.queue('erp-writeback').add(key, data, {
      jobId: jobIdFor(type, sourceId),
      attempts: MAX_ATTEMPTS,
      backoff: { type: 'exponential', delay: BACKOFF_MS },
    });
  }

  // ── Worker ──

  /** Runs one write-back job. Throws to let BullMQ retry; marks FAILED on the last attempt. */
  private async run(job: Job): Promise<string> {
    const data = job.data as WritebackJobData;
    const writeback = await this.prisma.erpWriteback.findUnique({
      where: { id: data.writebackId },
    });
    if (!writeback) return 'Write-back record gone; nothing to do.';
    if (writeback.status === 'SUCCEEDED') return 'Already completed; skipping.';
    await this.prisma.erpWriteback.update({
      where: { id: writeback.id },
      data: { status: 'PROCESSING', attempts: { increment: 1 }, error: null },
    });
    try {
      const summary =
        writeback.type === 'INVOICE'
          ? await this.processInvoice(writeback)
          : await this.processStockEntry(writeback);
      await this.prisma.erpWriteback.update({
        where: { id: writeback.id },
        data: { status: 'SUCCEEDED', error: null },
      });
      await this.notifyDone(writeback, true, summary);
      return summary;
    } catch (error) {
      const message =
        error instanceof ErpError
          ? `ERP ${error.kind}: ${error.message}`
          : ((error as Error).message ?? String(error));
      const lastAttempt = job.attemptsMade + 1 >= MAX_ATTEMPTS;
      await this.prisma.erpWriteback.update({
        where: { id: writeback.id },
        data: {
          status: lastAttempt ? 'FAILED' : 'PROCESSING',
          error: stripUrlCredentials(message).slice(0, 2000),
        },
      });
      if (lastAttempt) await this.notifyDone(writeback, false, message);
      throw error;
    }
  }

  /** A REST client for the WRITEBACK connection, failing closed when it isn't ready. */
  private async writebackClient(): Promise<{
    rest: FrappeRestClient;
    cleanup: () => Promise<void>;
  }> {
    const purposes = await this.connections.purposes();
    const connectionId = purposes.WRITEBACK;
    if (!connectionId) {
      throw new AppException(
        'WRITEBACK_NOT_CONFIGURED',
        'No ERP connection is assigned to write-backs. Assign one under Settings > ERP connections first.',
        HttpStatus.CONFLICT,
      );
    }
    const { view, result, credentials, allowPrivateHosts } =
      await this.connections.probeForSetup(connectionId);
    if (view.status !== 'ACTIVE') {
      throw new AppException(
        'WRITEBACK_CONNECTION_INACTIVE',
        `The write-back connection “${view.name}” is ${view.status}. Test it under Settings > ERP connections first.`,
        HttpStatus.CONFLICT,
      );
    }
    const missing = new Set((result.setup.missingFields ?? []).map((f) => f.doctype));
    if (SB_REF_DOCTYPES.some((dt) => missing.has(dt))) {
      throw new AppException(
        'WRITEBACK_SETUP_INCOMPLETE',
        `The ERP is missing the “${SB_REF_FIELD}” custom field on ${SB_REF_DOCTYPES.filter((dt) => missing.has(dt)).join(' and ')}. Create it via Customize Form, then re-run the setup check.`,
        HttpStatus.CONFLICT,
      );
    }
    const rest = new FrappeRestClient(credentials, { allowPrivateHosts });
    return { rest, cleanup: () => rest.close() };
  }

  private async processInvoice(writeback: ErpWriteback): Promise<string> {
    const settings = await this.settings.writebacks();
    const { rest, cleanup } = await this.writebackClient();
    try {
      const ticket = await this.prisma.ticket.findUnique({
        where: { id: writeback.ticketId! },
        select: {
          number: true,
          coverage: true,
          customer: { select: { name: true, erpName: true } },
          quotations: {
            where: { status: { in: ['SENT', 'PO_RECEIVED'] } },
            orderBy: { sentAt: 'desc' },
            take: 1,
            include: {
              lines: {
                include: { item: { select: { itemCode: true, name: true } } },
                orderBy: { createdAt: 'asc' },
              },
            },
          },
        },
      });
      if (!ticket) {
        throw new AppException(
          'TICKET_NOT_FOUND',
          'The ticket no longer exists; the write-back is abandoned.',
          HttpStatus.GONE,
        );
      }
      const quotation = ticket.quotations[0];
      if (!quotation || !quotation.lines.length) {
        throw new AppException(
          'WRITEBACK_NO_QUOTATION',
          `Ticket ${ticket.number} has no sent quotation, so there is nothing to invoice.`,
          HttpStatus.CONFLICT,
        );
      }
      const customerName = ticket.customer.erpName;
      if (!customerName) {
        // Approved: customer-not-found fails loudly, never silently queues.
        throw new AppException(
          'WRITEBACK_CUSTOMER_NOT_FOUND',
          `Customer “${ticket.customer.name}” isn’t linked to the ERP (no ERP name). Link it via the ERP sync before retrying.`,
          HttpStatus.CONFLICT,
        );
      }
      const customer = await rest.getDoc('Customer', customerName);
      if (!customer) {
        throw new AppException(
          'WRITEBACK_CUSTOMER_NOT_FOUND',
          `Customer “${customerName}” doesn’t exist in the ERP. Create it there before retrying.`,
          HttpStatus.CONFLICT,
        );
      }
      // Idempotent pre-search: a retry after a timeout finds the posted invoice.
      const existing = await rest.list<{ name: string }>('Sales Invoice', {
        fields: ['name'],
        filters: [['Sales Invoice', SB_REF_FIELD, '=', writeback.idempotencyKey]],
        pageLength: 1,
      });
      if (existing.length) {
        await this.prisma.erpWriteback.update({
          where: { id: writeback.id },
          data: { erpDocName: existing[0].name },
        });
        return `Sales Invoice ${existing[0].name} already exists in the ERP; reusing it.`;
      }
      // AMC-covered tickets still get an invoice, but with a zero bill.
      const zeroBill = ticket.coverage === 'AMC';
      const doc = {
        customer: customerName,
        docstatus: 0, // Invoices are always drafts; the ERP submits them.
        [SB_REF_FIELD]: writeback.idempotencyKey,
        po_no: quotation.poNumber ?? undefined,
        remarks: `ServiceBridge ${ticket.number} — quotation ${quotation.number}${zeroBill ? ' (AMC covered, zero bill)' : ''}`,
        items: quotation.lines.map((line) => ({
          item_code: line.item.itemCode,
          qty: Number(line.quantity),
          rate: zeroBill ? 0 : Number(line.rate),
        })),
        // Tax is governed by the ERP's tax template, never computed here.
        ...(settings.invoiceTaxTemplate
          ? { taxes_and_charges: settings.invoiceTaxTemplate }
          : {}),
      };
      const created = await rest.create<{ name: string }>('Sales Invoice', doc);
      await this.prisma.erpWriteback.update({
        where: { id: writeback.id },
        data: {
          erpDocName: created.name,
          quotationId: quotation.id,
          payload: doc,
        },
      });
      return `Sales Invoice ${created.name} created as a draft${zeroBill ? ' (zero bill, AMC covered)' : ''}.`;
    } finally {
      await cleanup();
    }
  }

  private async processStockEntry(writeback: ErpWriteback): Promise<string> {
    const settings = await this.settings.writebacks();
    const { rest, cleanup } = await this.writebackClient();
    try {
      const visit = await this.prisma.visit.findUnique({
        where: { id: writeback.visitId! },
        include: {
          ticket: { select: { number: true } },
          spares: {
            include: { item: { select: { itemCode: true, name: true, isStockItem: true } } },
          },
        },
      });
      if (!visit) {
        throw new AppException(
          'VISIT_NOT_FOUND',
          'The visit no longer exists; the write-back is abandoned.',
          HttpStatus.GONE,
        );
      }
      // Approved: non-stock spares (labour, services) are skipped.
      const stockSpares = visit.spares.filter((s) => s.item.isStockItem);
      if (!stockSpares.length) {
        await this.prisma.erpWriteback.update({
          where: { id: writeback.id },
          data: { payload: { skipped: 'no stock spares on this visit' } },
        });
        return 'No stock spares on this visit; nothing to post.';
      }
      const warehouse = settings.defaultWarehouseId
        ? await this.prisma.warehouse.findUnique({ where: { id: settings.defaultWarehouseId } })
        : null;
      if (!warehouse || !warehouse.active) {
        throw new AppException(
          'WRITEBACK_NO_WAREHOUSE',
          'Choose a default warehouse in the write-back settings before retrying.',
          HttpStatus.CONFLICT,
        );
      }
      const warehouseName = warehouse.erpName ?? warehouse.name;
      const existing = await rest.list<{ name: string }>('Stock Entry', {
        fields: ['name'],
        filters: [['Stock Entry', SB_REF_FIELD, '=', writeback.idempotencyKey]],
        pageLength: 1,
      });
      if (existing.length) {
        await this.prisma.erpWriteback.update({
          where: { id: writeback.id },
          data: { erpDocName: existing[0].name },
        });
        return `Stock Entry ${existing[0].name} already exists in the ERP; reusing it.`;
      }
      const doc = {
        stock_entry_type: 'Material Issue',
        from_warehouse: warehouseName,
        docstatus: settings.stockEntryAsDraft ? 0 : 1,
        [SB_REF_FIELD]: writeback.idempotencyKey,
        remarks: `ServiceBridge visit ${visit.visitNumber} on ${visit.ticket.number}`,
        items: stockSpares.map((s) => ({
          item_code: s.item.itemCode,
          qty: s.quantity,
          s_warehouse: warehouseName,
        })),
      };
      const created = await rest.create<{ name: string }>('Stock Entry', doc);
      await this.prisma.erpWriteback.update({
        where: { id: writeback.id },
        data: { erpDocName: created.name, payload: doc },
      });
      return `Stock Entry ${created.name} posted${settings.stockEntryAsDraft ? ' as a draft' : ''}.`;
    } finally {
      await cleanup();
    }
  }

  /** Tells everyone who can edit write-backs what happened. Never throws. */
  private async notifyDone(
    writeback: ErpWriteback,
    ok: boolean,
    detail: string,
  ): Promise<void> {
    try {
      const users = await this.prisma.user.findMany({
        where: { status: 'ACTIVE', role: rolesWith('writebacks.edit') },
        select: { id: true },
      });
      if (!users.length) return;
      const label = typeLabel(writeback.type);
      await this.notifications.notify({
        userIds: users.map((u) => u.id),
        exceptUserId: writeback.createdById ?? undefined,
        type: ok ? 'WRITEBACK_SUCCEEDED' : 'WRITEBACK_FAILED',
        title: ok ? `${label} posted to the ERP` : `${label} write-back failed`,
        body: stripUrlCredentials(detail).slice(0, 500),
      });
    } catch (error) {
      this.logger.error(`Could not notify about write-back ${writeback.id}: ${(error as Error).message}`);
    }
  }

  // ── Admin API ──

  async updateSettings(
    actor: AuthUser,
    input: Partial<WritebackSettings>,
    client: ClientInfo,
  ): Promise<WritebackSettings> {
    return this.settings.updateWritebackSettings(actor, input, client);
  }

  async overview(): Promise<{
    settings: WritebackSettings;
    automations: { key: string; name: string; description: string; enabled: boolean }[];
    setup: SetupCheckResult;
    warehouses: {
      id: string;
      name: string;
      erpName: string | null;
      active: boolean;
      source: string;
      isDefault: boolean;
    }[];
    recent: ErpWriteback[];
  }> {
    const [settings, setup, warehouses, recent] = await Promise.all([
      this.settings.writebacks(),
      this.setupCheck(),
      this.warehouses(),
      this.prisma.erpWriteback.findMany({
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { ticket: { select: { number: true } } },
      }),
    ]);
    const automations = await Promise.all(
      [INVOICE_KEY, STOCK_ENTRY_KEY].map(async (key) => {
        const setting = await this.prisma.automationSetting.findUnique({ where: { key } });
        const name =
          key === INVOICE_KEY ? 'ERP sales invoices' : 'ERP stock entries';
        return {
          key,
          name,
          description:
            key === INVOICE_KEY
              ? 'Draft sales invoices from sent quotation lines on close/verify.'
              : 'Draft material-issue stock entries for spares on visit submit.',
          enabled: setting?.enabled ?? false,
        };
      }),
    );
    return { settings, automations, setup, warehouses, recent };
  }

  async setupCheck(): Promise<SetupCheckResult> {
    const purposes = await this.connections.purposes();
    const connectionId = purposes.WRITEBACK;
    if (!connectionId) {
      return {
        ok: false,
        connection: null,
        readyForWriteback: false,
        missingFields: [],
        fieldCheckUnknown: false,
        fieldInstructions: FIELD_INSTRUCTIONS,
      };
    }
    const { view, result } = await this.connections.probeForSetup(connectionId);
    const readyForWriteback = result.readyFor.includes('WRITEBACK');
    const missingFields = result.setup.missingFields ?? [];
    const fieldCheckUnknown = result.setup.missingFields === null;
    const fieldsOk =
      !fieldCheckUnknown && SB_REF_DOCTYPES.every((dt) => !missingFields.some((f) => f.doctype === dt));
    return {
      ok: view.status === 'ACTIVE' && readyForWriteback && fieldsOk,
      connection: { id: view.id, name: view.name, status: view.status },
      readyForWriteback,
      missingFields,
      fieldCheckUnknown,
      fieldInstructions: FIELD_INSTRUCTIONS,
    };
  }

  async list(ticketId?: string): Promise<ErpWriteback[]> {
    return this.prisma.erpWriteback.findMany({
      where: ticketId ? { ticketId } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { ticket: { select: { number: true } } },
    });
  }

  async retry(actor: AuthUser, id: string, client: ClientInfo): Promise<ErpWriteback> {
    const writeback = await this.prisma.erpWriteback.findUnique({ where: { id } });
    if (!writeback) {
      throw new AppException(
        'WRITEBACK_NOT_FOUND',
        'That write-back no longer exists.',
        HttpStatus.NOT_FOUND,
      );
    }
    if (writeback.status !== 'FAILED') {
      throw new AppException(
        'WRITEBACK_NOT_FAILED',
        'Only failed write-backs can be retried.',
        HttpStatus.CONFLICT,
      );
    }
    const updated = await this.prisma.erpWriteback.update({
      where: { id },
      data: { status: 'PENDING', error: null, attempts: 0 },
    });
    await this.audit.record({
      actorId: actor.id,
      action: 'erp.writeback_retried',
      entityType: 'erp_writeback',
      entityId: id,
      summary: `${actor.name} retried the failed ${typeLabel(writeback.type).toLowerCase()} write-back`,
      ip: client.ip,
      requestId: client.requestId,
    });
    const key = writeback.type === 'INVOICE' ? INVOICE_KEY : STOCK_ENTRY_KEY;
    await this.queues.queue('erp-writeback').add(
      key,
      {
        automationKey: key,
        trigger: 'EVENT',
        writebackId: writeback.id,
        actorId: actor.id,
      } satisfies WritebackJobData,
      {
        jobId: jobIdFor(
          writeback.type,
          writeback.type === 'INVOICE' ? writeback.ticketId! : writeback.visitId!,
        ),
        attempts: MAX_ATTEMPTS,
        backoff: { type: 'exponential', delay: BACKOFF_MS },
      },
    );
    return updated;
  }

  async warehouses(): Promise<
    {
      id: string;
      name: string;
      erpName: string | null;
      active: boolean;
      source: string;
      isDefault: boolean;
    }[]
  > {
    const settings = await this.settings.writebacks();
    const rows = await this.prisma.warehouse.findMany({ orderBy: { name: 'asc' } });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      erpName: r.erpName,
      active: r.active,
      source: r.source,
      isDefault: r.id === settings.defaultWarehouseId,
    }));
  }

  async addWarehouse(
    actor: AuthUser,
    name: string,
    client: ClientInfo,
  ): Promise<{ id: string; name: string; erpName: string | null; active: boolean; source: string }> {
    const trimmed = name.trim();
    if (!trimmed) {
      throw validationFailed([{ field: 'name', message: 'Give the warehouse a name.' }]);
    }
    const duplicate = await this.prisma.warehouse.findFirst({
      where: { name: { equals: trimmed, mode: 'insensitive' } },
    });
    if (duplicate) {
      throw validationFailed([{ field: 'name', message: 'A warehouse with that name already exists.' }]);
    }
    const row = await this.prisma.warehouse.create({
      data: { name: trimmed, source: 'LOCAL', active: true },
    });
    await this.audit.record({
      actorId: actor.id,
      action: 'erp.warehouse_added',
      entityType: 'warehouse',
      entityId: row.id,
      summary: `${actor.name} added warehouse “${trimmed}” for write-backs`,
      ip: client.ip,
      requestId: client.requestId,
    });
    return { id: row.id, name: row.name, erpName: row.erpName, active: row.active, source: row.source };
  }

  async updateWarehouse(
    actor: AuthUser,
    id: string,
    input: { name?: string; active?: boolean },
    client: ClientInfo,
  ): Promise<{ id: string; name: string; erpName: string | null; active: boolean; source: string }> {
    const row = await this.prisma.warehouse.findUnique({ where: { id } });
    if (!row) {
      throw new AppException(
        'WAREHOUSE_NOT_FOUND',
        'That warehouse no longer exists.',
        HttpStatus.NOT_FOUND,
      );
    }
    if (row.source !== 'LOCAL') {
      throw new AppException(
        'WAREHOUSE_SYNCED',
        'Warehouses from the ERP sync can’t be edited here; change them in the ERP.',
        HttpStatus.CONFLICT,
      );
    }
    const data: Prisma.WarehouseUpdateInput = {};
    if (input.name !== undefined) {
      const trimmed = input.name.trim();
      if (!trimmed) throw validationFailed([{ field: 'name', message: 'Give the warehouse a name.' }]);
      data.name = trimmed;
    }
    if (input.active !== undefined) data.active = input.active;
    const updated = await this.prisma.warehouse.update({ where: { id }, data });
    await this.audit.record({
      actorId: actor.id,
      action: 'erp.warehouse_updated',
      entityType: 'warehouse',
      entityId: id,
      summary: `${actor.name} updated warehouse “${updated.name}”`,
      ip: client.ip,
      requestId: client.requestId,
    });
    return {
      id: updated.id,
      name: updated.name,
      erpName: updated.erpName,
      active: updated.active,
      source: updated.source,
    };
  }
}
