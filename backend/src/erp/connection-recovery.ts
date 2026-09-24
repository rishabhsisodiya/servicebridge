import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AutomationsService } from '../automations/automations.service';
import { AppConfig } from '../core/config/app-config.service';
import { PrismaService } from '../core/prisma/prisma.service';
import { QueueService } from '../core/queue/queue.service';
import { testConnection } from './connection-tester';
import { ErpConnectionsService } from './connections/erp-connections.service';
import { ErpRequestLogService } from './request-log.service';

export const RECOVERY_KEY = 'erp.connection-recovery';
/** Waits before each re-test: 1, 5, 15 minutes, then hourly. */
export const RECOVERY_BACKOFF_MS = [60_000, 300_000, 900_000, 3_600_000];

export function recoveryDelay(attempt: number): number {
  return RECOVERY_BACKOFF_MS[Math.min(attempt, RECOVERY_BACKOFF_MS.length) - 1];
}

/**
 * Re-tests a failing ERP connection with increasing gaps until it recovers.
 * Event-driven: nothing runs unless a connection is actually failing.
 */
@Injectable()
export class ConnectionRecovery implements OnModuleInit {
  constructor(
    private readonly automations: AutomationsService,
    private readonly queues: QueueService,
    private readonly prisma: PrismaService,
    private readonly connections: ErpConnectionsService,
    private readonly requestLog: ErpRequestLogService,
    private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    this.automations.define(
      {
        key: RECOVERY_KEY,
        name: 'Re-test failing ERP connections',
        description:
          'When a connection starts failing, tests it again after 1, 5 and 15 minutes, then every hour, and marks it active again once it works. Runs only while a connection is failing.',
        category: 'ERP',
        queue: 'system',
        kind: 'event',
        defaultEnabled: true,
      },
      ({ job }) => this.probe(String(job.data.connectionId), Number(job.data.attempt ?? 1)),
    );
    this.connections.onFailing = (connectionId) => this.schedule(connectionId, 1);
  }

  async schedule(connectionId: string, attempt: number): Promise<void> {
    await this.queues.queue('system').add(
      RECOVERY_KEY,
      { automationKey: RECOVERY_KEY, trigger: 'EVENT', connectionId, attempt },
      // Fixed ID per attempt: scheduling the same attempt twice never creates a duplicate.
      { jobId: `recover:${connectionId}:${attempt}`, delay: recoveryDelay(attempt) },
    );
  }

  async probe(connectionId: string, attempt: number): Promise<string> {
    const row = await this.prisma.erpConnection.findUnique({ where: { id: connectionId } });
    if (!row) return 'Connection was deleted; nothing to do.';
    if (row.status !== 'FAILING') return `“${row.name}” is no longer failing; nothing to do.`;

    const credentials = await this.connections.credentialsFor(row);
    const result = await testConnection(credentials, {
      allowPrivateHosts: this.config.get('ALLOW_PRIVATE_ERP_HOSTS'),
      record: this.requestLog.record,
    });
    await this.prisma.erpConnection.update({
      where: { id: connectionId },
      data: {
        status: result.ok ? 'ACTIVE' : 'FAILING',
        lastTestedAt: new Date(result.testedAt),
        lastTestResult: result as unknown as Prisma.InputJsonValue,
        consecutiveFailures: result.ok ? 0 : { increment: 1 },
      },
    });
    if (result.ok) return `“${row.name}” works again and is active.`;

    await this.schedule(connectionId, attempt + 1);
    const minutes = recoveryDelay(attempt + 1) / 60_000;
    return `“${row.name}” is still failing (${result.rest.error?.message ?? result.db?.error?.message ?? 'unknown reason'}). Next check in ${minutes} minutes.`;
  }
}
