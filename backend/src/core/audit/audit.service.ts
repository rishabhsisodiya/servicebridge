import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { validationFailed } from '../http/app.exception';

export interface AuditEntry {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  changes?: Record<string, { from: unknown; to: unknown }>;
  ip?: string | null;
  requestId?: string | null;
  /** Partner API key behind the change, if any (session 15). */
  partnerKeyId?: string | null;
}

/** Fields whose values must never reach the audit log. */
const SECRET_FIELDS = /password|secret|token|apikey|hash/i;

/** Before/after for the fields that actually changed, with secret values masked. */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [field, next] of Object.entries(after)) {
    if (next === undefined || before[field] === next) continue;
    changes[field] = SECRET_FIELDS.test(field)
      ? { from: '[redacted]', to: '[redacted]' }
      : { from: before[field] ?? null, to: next };
  }
  return changes;
}

export interface AuditSearchFilters {
  action?: string;
  entityType?: string;
  actorId?: string;
  partnerKeyId?: string;
  from?: Date;
  to?: Date;
  search?: string;
  page: number;
  pageSize: number;
}

export interface AuditSearchResult {
  rows: Array<{
    id: string;
    action: string;
    entityType: string;
    entityId: string | null;
    summary: string;
    changes: unknown;
    ip: string | null;
    requestId: string | null;
    createdAt: Date;
    actor: { id: string; name: string } | null;
    partnerKey: { id: string; name: string } | null;
  }>;
  total: number;
  page: number;
  pageSize: number;
}

const MAX_PAGE_SIZE = 100;
const RETENTION_KEY = 'audit.retention_days';
const DEFAULT_RETENTION_DAYS = 365;

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Pass `tx` to write the entry in the same transaction as the change,
   * so a change is never saved without its audit record (or vice versa).
   */
  async record(entry: AuditEntry, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    await client.auditLog.create({
      data: {
        actorId: entry.actorId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        summary: entry.summary,
        changes:
          entry.changes && Object.keys(entry.changes).length
            ? (entry.changes as Prisma.InputJsonValue)
            : undefined,
        ip: entry.ip ?? null,
        requestId: entry.requestId ?? null,
        partnerKeyId: entry.partnerKeyId ?? null,
      },
    });
    this.logger.log({ action: entry.action, entityId: entry.entityId }, entry.summary);
  }

  /**
   * Read-only query for the audit log screen. The audit trail is append-only:
   * this service exposes no update or delete — retention is enforced by an
   * explicit admin-triggered purge (see purgeOlderThan), never by editing rows.
   */
  async search(filters: AuditSearchFilters): Promise<AuditSearchResult> {
    const pageSize = Math.min(Math.max(filters.pageSize, 1), MAX_PAGE_SIZE);
    const page = Math.max(filters.page, 1);
    const where: Prisma.AuditLogWhereInput = {
      ...(filters.action ? { action: { contains: filters.action, mode: 'insensitive' } } : {}),
      ...(filters.entityType ? { entityType: filters.entityType } : {}),
      ...(filters.actorId ? { actorId: filters.actorId } : {}),
      ...(filters.partnerKeyId ? { partnerKeyId: filters.partnerKeyId } : {}),
      ...(filters.from || filters.to
        ? { createdAt: { gte: filters.from, lte: filters.to } }
        : {}),
      ...(filters.search
        ? { summary: { contains: filters.search, mode: 'insensitive' } }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          actor: { select: { id: true, name: true } },
          partnerKey: { select: { id: true, name: true } },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return {
      rows: rows.map((row) => ({
        id: row.id,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        summary: row.summary,
        changes: row.changes,
        ip: row.ip,
        requestId: row.requestId,
        createdAt: row.createdAt,
        actor: row.actor,
        partnerKey: row.partnerKey,
      })),
      total,
      page,
      pageSize,
    };
  }

  /** Configured retention in days (default 365), stored in AppSetting. */
  async retentionDays(): Promise<number> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: RETENTION_KEY } });
    const value = Number((row?.value as { days?: unknown } | null)?.days);
    return Number.isFinite(value) && value >= 1 ? Math.floor(value) : DEFAULT_RETENTION_DAYS;
  }

  async updateRetentionDays(
    days: number,
    actor: { id: string; name: string },
    client: { ip: string | null; requestId: string | null },
  ): Promise<number> {
    if (!Number.isInteger(days) || days < 30 || days > 3650) {
      throw validationFailed([
        { field: 'retentionDays', message: 'Retention must be between 30 and 3650 days.' },
      ]);
    }
    await this.prisma.appSetting.upsert({
      where: { key: RETENTION_KEY },
      create: { key: RETENTION_KEY, value: { days } },
      update: { value: { days } },
    });
    await this.record({
      actorId: actor.id,
      action: 'audit.retention_changed',
      entityType: 'AuditLog',
      summary: `Audit log retention set to ${days} days.`,
      ip: client.ip,
      requestId: client.requestId,
    });
    return days;
  }

  /**
   * Retention enforcement. Explicit and admin-triggered only — there is no
   * background purger, per the no-polling-crons product rule. Deletes rows
   * older than `retentionDays`, keeping the most recent `keepMinimum` rows
   * regardless of age so the trail is never emptied by a misconfigured value.
   */
  async purgeOlderThan(
    retentionDays: number,
    actor: { id: string; name: string },
    client: { ip: string | null; requestId: string | null },
  ): Promise<{ deleted: number }> {
    const days = Math.max(1, Math.floor(retentionDays));
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const keepMinimum = 1000;
    const victims = await this.prisma.auditLog.findMany({
      where: { createdAt: { lt: cutoff } },
      orderBy: { createdAt: 'desc' },
      skip: keepMinimum,
      select: { id: true },
    });
    let deleted = 0;
    // Delete in chunks so a huge purge doesn't hold one long transaction.
    for (let i = 0; i < victims.length; i += 500) {
      const chunk = victims.slice(i, i + 500).map((v) => v.id);
      const result = await this.prisma.auditLog.deleteMany({ where: { id: { in: chunk } } });
      deleted += result.count;
    }
    await this.record({
      actorId: actor.id,
      action: 'audit.purged',
      entityType: 'AuditLog',
      summary: `Audit log purged: ${deleted} rows older than ${days} days removed.`,
      ip: client.ip,
      requestId: client.requestId,
    });
    return { deleted };
  }
}
