import { HttpStatus, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { TicketStage } from '@prisma/client';
import { AppException } from '../core/http/app.exception';
import { AppConfig } from '../core/config/app-config.service';
import { PrismaService } from '../core/prisma/prisma.service';
import { QueueService } from '../core/queue/queue.service';
import { EmailService } from '../notifications/email.service';
import { rolesWith } from '../roles/role-filters';
import { AutomationsService, type AutomationContext } from '../automations/automations.service';
import { TicketNotifier } from './ticket-notifier';

export const ESCALATION_L1_KEY = 'escalation-l1';
export const ESCALATION_L2_KEY = 'escalation-l2';
export const ESCALATION_L3_KEY = 'escalation-l3';

const MIN_MINUTES = 5;
const MAX_MINUTES = 7 * 24 * 60; // one week

interface EscalationLevel {
  key: string;
  level: number;
  name: string;
  description: string;
  defaultAfterMinutes: number;
  /** Level 1 goes to the area manager; 2 and 3 go to an admin-chosen role. */
  roleBased: boolean;
}

const LEVELS: EscalationLevel[] = [
  {
    key: ESCALATION_L1_KEY,
    level: 1,
    name: 'Escalation — level 1',
    description:
      'Notifies the area manager when an assigned ticket has not been accepted in time. Each assignment sets its own timer.',
    defaultAfterMinutes: 60,
    roleBased: false,
  },
  {
    key: ESCALATION_L2_KEY,
    level: 2,
    name: 'Escalation — level 2',
    description:
      'Notifies a role you choose (service managers, for example) when an assigned ticket is still unaccepted. Each assignment sets its own timer.',
    defaultAfterMinutes: 240,
    roleBased: true,
  },
  {
    key: ESCALATION_L3_KEY,
    level: 3,
    name: 'Escalation — level 3',
    description:
      'Notifies a role you choose (senior leadership, for example) when an assigned ticket is still unaccepted. Each assignment sets its own timer.',
    defaultAfterMinutes: 1440,
    roleBased: true,
  },
];

/** BullMQ job ids can't contain ":"; one fixed id per ticket and level makes rescheduling idempotent. */
const jobId = (ticketId: string, level: number) => `escalation-${ticketId}-l${level}`;

/** A job that is running right now is locked and can't be removed; its handler sees the change and skips. */
const removeQuietly = (queue: Queue, id: string) => queue.remove(id).catch(() => 0);

interface EscalationTicket {
  id: string;
  stage: TicketStage;
  engineerId: string | null;
}

interface EscalationJobData {
  automationKey: string;
  ticketId: string;
  level: number;
  /** The engineer the ticket was assigned to when the timer was set. */
  engineerId: string;
}

interface LevelParams {
  afterMinutes: number;
  roleId: string | null;
}

/**
 * Escalation timers: one delayed job per assigned ticket per enabled level.
 * No polling: every relevant ticket change calls sync(), which replaces the
 * ticket's jobs, and every handler re-reads the ticket before acting.
 */
@Injectable()
export class EscalationTimersService implements OnModuleInit {
  private readonly logger = new Logger(EscalationTimersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    private readonly automations: AutomationsService,
    private readonly notifier: TicketNotifier,
    private readonly email: EmailService,
    private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    for (const level of LEVELS) {
      this.automations.define(
        {
          key: level.key,
          name: level.name,
          description: level.description,
          category: 'Service',
          queue: 'escalations',
          kind: 'event',
          defaultEnabled: false,
          validateParams: (params) => this.validateLevelParams(level, params),
        },
        async (context) => this.fire(level, context),
      );
    }
  }

  /**
   * Save-time checks for the escalation settings UI. Problems are
   * "field: message" strings the automations screen shows next to the field.
   */
  private async validateLevelParams(
    level: EscalationLevel,
    params: Record<string, unknown>,
  ): Promise<string[]> {
    const problems: string[] = [];
    if (params.afterMinutes !== undefined) {
      const v = params.afterMinutes;
      if (typeof v !== 'number' || !Number.isInteger(v) || v < MIN_MINUTES || v > MAX_MINUTES) {
        problems.push(`afterMinutes: Enter a whole number of minutes between ${MIN_MINUTES} and ${MAX_MINUTES}.`);
      }
    }
    const roleId = params.notifyRoleId;
    if (level.roleBased) {
      if (typeof roleId !== 'string' || !roleId.trim()) {
        problems.push('notifyRoleId: Choose the role to notify for this level.');
      } else {
        const role = await this.prisma.role.findUnique({ where: { id: roleId }, select: { id: true } });
        if (!role) problems.push('notifyRoleId: That role no longer exists — pick another.');
      }
    }
    return problems;
  }

  /**
   * Replaces a ticket's escalation jobs to match its current state. Call after
   * create, assign, accept, hold, resume and close. Never throws: a Redis
   * outage must not block ticket work.
   */
  async sync(ticket: EscalationTicket): Promise<void> {
    try {
      const queue = this.queues.queue('escalations');
      await Promise.all(LEVELS.map((level) => removeQuietly(queue, jobId(ticket.id, level.level))));
      if (ticket.stage !== 'ASSIGNED' || !ticket.engineerId) return;
      for (const level of LEVELS) {
        if (!(await this.automations.isEnabled(level.key))) continue;
        let params: LevelParams;
        try {
          params = await this.paramsFor(level);
        } catch (error) {
          this.logger.warn(`Not scheduling ${level.key} for ticket ${ticket.id}: ${(error as Error).message}`);
          continue;
        }
        await queue.add(
          level.key,
          {
            automationKey: level.key,
            ticketId: ticket.id,
            level: level.level,
            engineerId: ticket.engineerId,
          } satisfies EscalationJobData,
          { jobId: jobId(ticket.id, level.level), delay: params.afterMinutes * 60_000 },
        );
      }
    } catch (error) {
      this.logger.error(`Could not sync escalation timers for ${ticket.id}: ${(error as Error).message}`);
    }
  }

  /** Reads and validates a level's params from its automation setting. */
  private async paramsFor(level: EscalationLevel): Promise<LevelParams> {
    const setting = await this.prisma.automationSetting.findUnique({ where: { key: level.key } });
    const raw = (setting?.params as Record<string, unknown> | null) ?? {};
    return this.validateParams(level, raw, true);
  }

  /**
   * Validates the admin-configured params. When `forScheduling` is false the
   * role's existence is also checked (an async step the scheduler skips).
   */
  private validateParams(level: EscalationLevel, raw: Record<string, unknown>, forScheduling: boolean): LevelParams {
    const configured = raw.afterMinutes;
    const afterMinutes = configured === undefined ? level.defaultAfterMinutes : configured;
    if (typeof afterMinutes !== 'number' || !Number.isInteger(afterMinutes) || afterMinutes < MIN_MINUTES || afterMinutes > MAX_MINUTES) {
      throw new AppException(
        'ESCALATION_MISCONFIGURED',
        `${level.name}: the wait must be between ${MIN_MINUTES} minutes and a week.`,
        HttpStatus.CONFLICT,
      );
    }
    const roleId = raw.roleId ?? null;
    if (level.roleBased && typeof roleId !== 'string') {
      throw new AppException(
        'ESCALATION_MISCONFIGURED',
        `${level.name}: choose the role to notify.`,
        HttpStatus.CONFLICT,
      );
    }
    void forScheduling;
    return { afterMinutes, roleId: typeof roleId === 'string' ? roleId : null };
  }

  private async fire(level: EscalationLevel, { job, params }: AutomationContext): Promise<string> {
    const { ticketId, engineerId } = job.data as unknown as EscalationJobData;
    const parsed = this.validateParams(level, params, false);
    if (parsed.roleId) {
      const role = await this.prisma.role.findUnique({ where: { id: parsed.roleId } });
      if (!role) {
        throw new AppException(
          'ESCALATION_MISCONFIGURED',
          `${level.name}: that role no longer exists. Pick another one.`,
          HttpStatus.CONFLICT,
        );
      }
    }
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: {
        id: true,
        number: true,
        title: true,
        stage: true,
        engineerId: true,
        areaManagerId: true,
        engineer: { select: { name: true } },
      },
    });
    if (!ticket) return 'Skipped: the ticket no longer exists';
    if (ticket.stage !== 'ASSIGNED' || ticket.engineerId !== engineerId) {
      return 'Skipped: the ticket is no longer waiting for that engineer';
    }

    const recipients = await this.recipientsFor(level, parsed, ticket.areaManagerId);
    await this.prisma.ticketEvent.create({
      data: {
        ticketId: ticket.id,
        type: 'ESCALATED',
        actorId: null,
        data: { level: level.level, reason: 'not accepted in time' },
      },
    });
    const reason = `${ticket.engineer?.name ?? 'The assigned engineer'} did not accept ${ticket.number} within ${parsed.afterMinutes} minutes`;
    await this.notifier.escalated(
      { id: ticket.id, number: ticket.number, title: ticket.title, engineerId: ticket.engineerId, areaManagerId: ticket.areaManagerId },
      level.level,
      recipients.ids,
    );
    let emailed = 0;
    const ticketUrl = `${this.config.get('APP_URL').replace(/\/$/, '')}/tickets/${ticket.id}`;
    for (const recipient of recipients.withEmail) {
      const queued = await this.email.queueEmail({
        to: recipient.email,
        templateKey: 'escalation.fired',
        variables: {
          ticketNumber: ticket.number,
          ticketTitle: ticket.title,
          level: level.level,
          reason,
          ticketUrl,
        },
        ticketId: ticket.id,
      });
      if (queued) emailed += 1;
    }
    return `Escalated ${ticket.number} to level ${level.level}: ${recipients.ids.length} notified (${emailed} emailed)`;
  }

  private async recipientsFor(
    level: EscalationLevel,
    params: LevelParams,
    areaManagerId: string | null,
  ): Promise<{ ids: string[]; withEmail: { id: string; email: string }[] }> {
    let rows: { id: string; email: string | null }[];
    if (level.roleBased) {
      // The admin-chosen role for this level.
      rows = await this.prisma.user.findMany({
        where: { status: 'ACTIVE', roleId: params.roleId! },
        select: { id: true, email: true },
      });
    } else if (areaManagerId) {
      rows = await this.prisma.user.findMany({
        where: { status: 'ACTIVE', id: areaManagerId },
        select: { id: true, email: true },
      });
    } else {
      // No area manager: fall back to the escalation recipients.
      rows = await this.prisma.user.findMany({
        where: { status: 'ACTIVE', role: rolesWith('tickets.escalations') },
        select: { id: true, email: true },
      });
    }
    return {
      ids: rows.map((r) => r.id),
      withEmail: rows.filter((r): r is { id: string; email: string } => !!r.email),
    };
  }
}
