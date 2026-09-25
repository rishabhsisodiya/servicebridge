import { HttpStatus, Injectable } from '@nestjs/common';
import type { DutyStatus, TicketStage } from '@prisma/client';
import type { AuthUser, ClientInfo } from '../auth/auth.types';
import { hasPermission } from '../auth/permissions';
import { AuditService } from '../core/audit/audit.service';
import { AppException } from '../core/http/app.exception';
import { PrismaService } from '../core/prisma/prisma.service';
import type { Candidate } from './assignment';

/** Stages where an engineer is busy with the ticket (counts towards their load). */
const WORKLOAD_STAGES: TicketStage[] = [
  'ASSIGNED',
  'ACCEPTED',
  'ON_SITE',
  'IN_PROGRESS',
  'ON_HOLD',
];
/** Stages that mean the engineer is at a site right now. */
const VISIT_STAGES: TicketStage[] = ['ON_SITE', 'IN_PROGRESS'];

export const DUTY_LABELS: Record<DutyStatus, string> = {
  ON_DUTY: 'On duty',
  OFF_DUTY: 'Off duty',
  ON_LEAVE: 'On leave',
};

/** Engineers' availability: a status they set, plus "on visit" derived from their tickets. */
@Injectable()
export class EngineersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Every active engineer with duty, load and skills, ready for the assignment rules. */
  async candidates(): Promise<Candidate[]> {
    const [engineers, load, visiting] = await Promise.all([
      this.prisma.user.findMany({
        where: { role: 'ENGINEER', status: 'ACTIVE' },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          regionId: true,
          dutyStatus: true,
          region: { select: { name: true } },
          skills: { select: { skillTag: { select: { name: true, equipmentModels: true } } } },
        },
      }),
      this.prisma.ticket.groupBy({
        by: ['engineerId'],
        where: { engineerId: { not: null }, stage: { in: WORKLOAD_STAGES } },
        _count: { _all: true },
      }),
      this.prisma.ticket.groupBy({
        by: ['engineerId'],
        where: { engineerId: { not: null }, stage: { in: VISIT_STAGES } },
        _count: { _all: true },
      }),
    ]);
    const loadOf = new Map(load.map((l) => [l.engineerId, l._count._all]));
    const onVisit = new Set(visiting.map((v) => v.engineerId));
    return engineers.map((e) => ({
      id: e.id,
      name: e.name,
      regionId: e.regionId,
      regionName: e.region?.name ?? null,
      dutyStatus: e.dutyStatus,
      skills: e.skills.map((s) => s.skillTag),
      openTickets: loadOf.get(e.id) ?? 0,
      onVisit: onVisit.has(e.id),
    }));
  }

  /** The signed-in engineer's own availability, for their home screen. */
  async me(userId: string) {
    const [user, open, visiting] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { dutyStatus: true, dutyChangedAt: true },
      }),
      this.prisma.ticket.count({ where: { engineerId: userId, stage: { in: WORKLOAD_STAGES } } }),
      this.prisma.ticket.count({ where: { engineerId: userId, stage: { in: VISIT_STAGES } } }),
    ]);
    return { ...user, openTickets: open, onVisit: visiting > 0 };
  }

  /** For managers' home screens: area managers see their own region's engineers first. */
  async list(user: AuthUser) {
    const candidates = await this.candidates();
    const own = (c: Candidate) => !!user.regionId && c.regionId === user.regionId;
    return candidates
      .sort((a, b) => Number(own(b)) - Number(own(a)) || a.name.localeCompare(b.name))
      .map((c) => ({
        id: c.id,
        name: c.name,
        region: c.regionName,
        dutyStatus: c.dutyStatus,
        onVisit: c.onVisit,
        openTickets: c.openTickets,
        skills: c.skills.map((s) => s.name),
        canChange: this.canChange(user, c),
      }));
  }

  /** Engineers change their own status; managers change it for their region (service managers: anyone). */
  private canChange(
    user: Pick<AuthUser, 'id' | 'role' | 'regionId'>,
    engineer: { id: string; regionId: string | null },
  ) {
    if (user.id === engineer.id) return true;
    if (!hasPermission(user.role, 'tickets.assign')) return false;
    if (hasPermission(user.role, 'tickets.viewAll')) return true;
    return !!user.regionId && user.regionId === engineer.regionId;
  }

  async setDuty(actor: AuthUser, engineerId: string, dutyStatus: DutyStatus, client: ClientInfo) {
    const engineer = await this.prisma.user.findUnique({
      where: { id: engineerId },
      select: { id: true, name: true, role: true, regionId: true, dutyStatus: true },
    });
    if (!engineer || engineer.role !== 'ENGINEER') {
      throw new AppException(
        'ENGINEER_NOT_FOUND',
        'That engineer no longer exists.',
        HttpStatus.NOT_FOUND,
      );
    }
    if (!this.canChange(actor, engineer)) {
      throw new AppException(
        'FORBIDDEN',
        'You can only change the status of engineers in your own region.',
        HttpStatus.FORBIDDEN,
      );
    }
    if (engineer.dutyStatus === dutyStatus) return { id: engineer.id, dutyStatus };
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: engineer.id },
        data: { dutyStatus, dutyChangedAt: new Date() },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'engineer.duty_changed',
          entityType: 'user',
          entityId: engineer.id,
          summary:
            actor.id === engineer.id
              ? `${actor.name} set themselves ${DUTY_LABELS[dutyStatus].toLowerCase()}`
              : `${actor.name} set ${engineer.name} ${DUTY_LABELS[dutyStatus].toLowerCase()}`,
          changes: { dutyStatus: { from: engineer.dutyStatus, to: dutyStatus } },
          ip: client.ip,
          requestId: client.requestId,
        },
        tx,
      );
    });
    return { id: engineer.id, dutyStatus };
  }
}
