import { Injectable, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../core/prisma/prisma.service';
import { StorageService } from '../core/storage/storage.service';
import { AutomationsService } from './automations.service';

const DAY_MS = 86_400_000;

/** Weekly clean-up of logs and expired records. The audit log is never touched. */
@Injectable()
export class Housekeeping implements OnModuleInit {
  constructor(
    private readonly automations: AutomationsService,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  onModuleInit(): void {
    this.automations.define(
      {
        key: 'housekeeping.cleanup',
        name: 'Weekly clean-up',
        description:
          'Removes ERP request logs older than 30 days, automation history, notifications and scheduled-report runs older than 90 days, and ended sign-in sessions and used links older than 30 days. The audit log is kept.',
        category: 'Maintenance',
        queue: 'system',
        kind: 'periodic',
        defaultEnabled: true,
        defaultCron: '0 3 * * 0', // Sundays 03:00
        minIntervalMinutes: 60,
      },
      () => this.run(),
    );
  }

  async run(now = Date.now()): Promise<string> {
    const days = (n: number) => new Date(now - n * DAY_MS);
    // Scheduled-report runs go first: their stored CSVs must be deleted too.
    const oldRuns = await this.prisma.reportRun.findMany({
      where: { startedAt: { lt: days(90) }, status: { not: 'RUNNING' } },
      select: { id: true, csvKey: true },
    });
    for (const run of oldRuns) {
      if (run.csvKey) await this.storage.remove(run.csvKey).catch(() => undefined);
    }
    const [reportRuns, requests, runs, sessions, links, notifications] = await this.prisma.$transaction([
      this.prisma.reportRun.deleteMany({ where: { id: { in: oldRuns.map((r) => r.id) } } }),
      this.prisma.erpRequestLog.deleteMany({ where: { createdAt: { lt: days(30) } } }),
      this.prisma.jobRun.deleteMany({
        where: { startedAt: { lt: days(90) }, status: { not: 'RUNNING' } },
      }),
      this.prisma.session.deleteMany({
        where: {
          OR: [
            { revokedAt: { lt: days(30) } },
            { absoluteExpiresAt: { lt: days(30) } },
            { expiresAt: { lt: days(30) } },
          ],
        },
      }),
      this.prisma.userToken.deleteMany({
        where: { OR: [{ usedAt: { lt: days(30) } }, { expiresAt: { lt: days(30) } }] },
      }),
      this.prisma.notification.deleteMany({ where: { createdAt: { lt: days(90) } } }),
    ]);
    const n = (count: number) => count.toLocaleString('en-IN');
    return `Removed ${n(requests.count)} ERP request log rows, ${n(runs.count)} old automation runs, ${n(reportRuns.count)} old scheduled-report runs, ${n(sessions.count)} ended sessions, ${n(links.count)} used or expired links and ${n(notifications.count)} old notifications.`;
  }
}
