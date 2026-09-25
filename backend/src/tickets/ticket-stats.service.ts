import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../core/prisma/prisma.service';
import { AppSettingsService } from '../demo/app-settings.service';
import { visibleTo } from './tickets.service';
import { FINAL_STAGES } from './workflow';

const DAY_MS = 86_400_000;
/** Enough for a month of history on a busy desk; stats are indicative, not accounting. */
const SAMPLE_LIMIT = 5000;

/** Figures for the role home pages, always limited to the tickets the user can see. */
@Injectable()
export class TicketStatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AppSettingsService,
  ) {}

  async summary(user: AuthUser, now = new Date()) {
    const { timezone } = await this.settings.company();
    const dayOf = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(d);
    const days = Array.from({ length: 7 }, (_, i) =>
      dayOf(new Date(now.getTime() - (6 - i) * DAY_MS)),
    );
    const today = days[6];
    // A day of margin so every local day in the window is fully covered.
    const since7 = new Date(now.getTime() - 8 * DAY_MS);
    const since30 = new Date(now.getTime() - 30 * DAY_MS);

    const scope = visibleTo(user);
    const where = (extra: Prisma.TicketWhereInput): Prisma.TicketWhereInput => ({
      AND: [scope, extra],
    });
    const open = { stage: { notIn: FINAL_STAGES } };

    const [
      openCount,
      atRisk,
      breached,
      unassigned,
      awaitingVerification,
      onHold,
      mine,
      byStage,
      logged,
      closed,
      channels,
      resolved,
    ] = await this.prisma.$transaction([
      this.prisma.ticket.count({ where: where(open) }),
      this.prisma.ticket.count({ where: where({ slaRiskAt: { lte: now } }) }),
      this.prisma.ticket.count({ where: where({ slaDueAt: { lt: now } }) }),
      this.prisma.ticket.count({ where: where({ ...open, engineerId: null }) }),
      this.prisma.ticket.count({ where: where({ stage: { in: ['RESOLVED', 'VERIFIED'] } }) }),
      this.prisma.ticket.count({ where: where({ stage: 'ON_HOLD' }) }),
      this.prisma.ticket.count({ where: where({ ...open, engineerId: user.id }) }),
      this.prisma.ticket.groupBy({
        by: ['stage'],
        where: where(open),
        _count: { _all: true },
        orderBy: { stage: 'asc' },
      }),
      this.prisma.ticket.findMany({
        where: where({ createdAt: { gte: since7 } }),
        select: { createdAt: true, channel: true },
        take: SAMPLE_LIMIT,
      }),
      this.prisma.ticket.findMany({
        where: where({ closedAt: { gte: since7 } }),
        select: { closedAt: true },
        take: SAMPLE_LIMIT,
      }),
      this.prisma.ticket.groupBy({
        by: ['channel'],
        where: where({ createdAt: { gte: new Date(now.getTime() - 7 * DAY_MS) } }),
        _count: { _all: true },
        orderBy: { channel: 'asc' },
      }),
      this.prisma.ticket.findMany({
        where: where({ resolvedAt: { gte: since30 } }),
        select: { createdAt: true, resolvedAt: true, resolutionBreached: true },
        take: SAMPLE_LIMIT,
      }),
    ]);

    const loggedPerDay = new Map(days.map((d) => [d, 0]));
    for (const t of logged) {
      const d = dayOf(t.createdAt);
      if (loggedPerDay.has(d)) loggedPerDay.set(d, loggedPerDay.get(d)! + 1);
    }
    const closedPerDay = new Map(days.map((d) => [d, 0]));
    for (const t of closed) {
      const d = dayOf(t.closedAt!);
      if (closedPerDay.has(d)) closedPerDay.set(d, closedPerDay.get(d)! + 1);
    }
    const resolutionMinutes = resolved.map(
      (t) => (t.resolvedAt!.getTime() - t.createdAt.getTime()) / 60_000,
    );

    return {
      counts: {
        open: openCount,
        atRisk,
        breached,
        unassigned,
        awaitingVerification,
        onHold,
        mine,
        loggedToday: loggedPerDay.get(today) ?? 0,
        closedToday: closedPerDay.get(today) ?? 0,
      },
      byStage: byStage.map((s) => ({ stage: s.stage, count: (s._count as { _all: number })._all })),
      channels: channels.map((c) => ({
        channel: c.channel,
        count: (c._count as { _all: number })._all,
      })),
      flow: days.map((day) => ({
        day,
        logged: loggedPerDay.get(day)!,
        closed: closedPerDay.get(day)!,
      })),
      last30: {
        resolved: resolved.length,
        avgResolutionMinutes: resolutionMinutes.length
          ? Math.round(resolutionMinutes.reduce((a, b) => a + b, 0) / resolutionMinutes.length)
          : null,
        slaMetPercent: resolved.length
          ? Math.round(
              (100 * resolved.filter((t) => !t.resolutionBreached).length) / resolved.length,
            )
          : null,
      },
    };
  }
}
