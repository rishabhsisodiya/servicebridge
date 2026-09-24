import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  changes?: Record<string, { from: unknown; to: unknown }>;
  ip?: string | null;
  requestId?: string | null;
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
      },
    });
    this.logger.log({ action: entry.action, entityId: entry.entityId }, entry.summary);
  }
}
