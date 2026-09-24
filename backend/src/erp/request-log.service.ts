import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../core/prisma/prisma.service';
import type { ErpCallRecord, ErpCallRecorder } from './erp.types';

/**
 * Writes one row per ERP call for the System monitor. Writes are
 * fire-and-forget: logging must never slow down or break an ERP call.
 */
@Injectable()
export class ErpRequestLogService {
  private readonly logger = new Logger(ErpRequestLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  readonly record: ErpCallRecorder = (entry: ErpCallRecord) => {
    this.prisma.erpRequestLog
      .create({
        data: {
          connectionId: entry.connectionId ?? null,
          channel: entry.channel,
          method: entry.method,
          target: entry.target.slice(0, 200),
          doctype: entry.doctype ?? null,
          httpStatus: entry.httpStatus ?? null,
          ok: entry.ok,
          latencyMs: entry.latencyMs,
          error: entry.error?.slice(0, 500) ?? null,
        },
      })
      .catch((error: unknown) =>
        this.logger.warn({ error: (error as Error).message }, 'Could not record ERP request'),
      );
  };
}
