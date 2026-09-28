import type { TicketStage } from '@prisma/client';
import { can, type Permission } from '../auth/permissions';

/**
 * The ticket workflow:
 * NEW → TRIAGED → ASSIGNED → ACCEPTED → ON_SITE → IN_PROGRESS → RESOLVED → VERIFIED → CLOSED,
 * plus ON_HOLD (returns to where it was) and CANCELLED. Pure: no database access.
 */

export type TicketAction =
  | 'triage'
  | 'assign'
  | 'accept'
  | 'decline'
  | 'arrive'
  | 'start'
  | 'hold'
  | 'resume'
  | 'resolve'
  | 'verify'
  | 'reject'
  | 'close'
  | 'cancel'
  | 'reopen';

/**
 * Who may act:
 * - engineer: the ticket's own engineer (with tickets.work)
 * - manager: anyone with tickets.assign
 * - either: engineer or manager
 * - verifier: tickets.verify
 * - desk: tickets.create or tickets.verify (reopening after a customer calls back)
 */
type Actor = 'engineer' | 'manager' | 'either' | 'verifier' | 'desk';

export interface ActionRule {
  label: string;
  from: readonly TicketStage[];
  actor: Actor;
  /** Whether the user must give a reason/note. */
  note: 'required' | 'optional';
}

const WORKING: TicketStage[] = ['ACCEPTED', 'ON_SITE', 'IN_PROGRESS'];
export const OPEN_STAGES: TicketStage[] = [
  'NEW',
  'TRIAGED',
  'ASSIGNED',
  ...WORKING,
  'ON_HOLD',
  'RESOLVED',
  'VERIFIED',
];
export const FINAL_STAGES: TicketStage[] = ['CLOSED', 'CANCELLED'];
export const REOPEN_DAYS = 7;

export const ACTIONS: Record<TicketAction, ActionRule> = {
  triage: { label: 'Acknowledge', from: ['NEW'], actor: 'manager', note: 'optional' },
  assign: {
    label: 'Assign engineer',
    from: ['NEW', 'TRIAGED', 'ASSIGNED', ...WORKING],
    actor: 'manager',
    note: 'optional',
  },
  accept: { label: 'Accept', from: ['ASSIGNED'], actor: 'engineer', note: 'optional' },
  decline: { label: 'Decline', from: ['ASSIGNED'], actor: 'engineer', note: 'required' },
  arrive: { label: 'Reached site', from: ['ACCEPTED'], actor: 'engineer', note: 'optional' },
  start: { label: 'Start work', from: ['ON_SITE'], actor: 'engineer', note: 'optional' },
  hold: {
    label: 'Put on hold',
    from: ['TRIAGED', 'ASSIGNED', ...WORKING],
    actor: 'either',
    note: 'required',
  },
  resume: { label: 'Resume', from: ['ON_HOLD'], actor: 'either', note: 'optional' },
  resolve: {
    label: 'Mark resolved',
    from: ['ON_SITE', 'IN_PROGRESS'],
    actor: 'engineer',
    note: 'required',
  },
  verify: { label: 'Verify fix', from: ['RESOLVED'], actor: 'verifier', note: 'optional' },
  reject: { label: 'Send back', from: ['RESOLVED'], actor: 'verifier', note: 'required' },
  close: { label: 'Close ticket', from: ['VERIFIED'], actor: 'verifier', note: 'optional' },
  cancel: {
    label: 'Cancel ticket',
    from: ['NEW', 'TRIAGED', 'ASSIGNED', 'ACCEPTED', 'ON_HOLD'],
    actor: 'manager',
    note: 'required',
  },
  reopen: { label: 'Reopen', from: ['CLOSED'], actor: 'desk', note: 'required' },
};

export interface WorkflowUser {
  id: string;
  permissions: readonly Permission[];
}

export interface WorkflowTicket {
  stage: TicketStage;
  engineerId: string | null;
  stageBeforeHold: TicketStage | null;
  closedAt: Date | null;
}

function actorAllowed(actor: Actor, user: WorkflowUser, ticket: WorkflowTicket): boolean {
  const isEngineer = ticket.engineerId === user.id && can(user, 'tickets.work');
  const isManager = can(user, 'tickets.assign');
  switch (actor) {
    case 'engineer':
      return isEngineer;
    case 'manager':
      return isManager;
    case 'either':
      return isEngineer || isManager;
    case 'verifier':
      return can(user, 'tickets.verify');
    case 'desk':
      return can(user, 'tickets.create') || can(user, 'tickets.verify');
  }
}

/** Why an action is not possible right now, or null when it is. */
export function blockedReason(
  action: TicketAction,
  ticket: WorkflowTicket,
  user: WorkflowUser,
  now = new Date(),
): string | null {
  const rule = ACTIONS[action];
  if (!rule.from.includes(ticket.stage)) return 'That step is not possible at this stage.';
  if (!actorAllowed(rule.actor, user, ticket)) {
    return rule.actor === 'engineer'
      ? 'Only the assigned engineer can do this.'
      : "You don't have permission to do this.";
  }
  if (action === 'reopen') {
    const closedAt = ticket.closedAt?.getTime() ?? 0;
    if (now.getTime() - closedAt > REOPEN_DAYS * 86_400_000) {
      return `Tickets can be reopened within ${REOPEN_DAYS} days of closing. Log a new ticket instead.`;
    }
  }
  return null;
}

export function availableActions(
  ticket: WorkflowTicket,
  user: WorkflowUser,
  now = new Date(),
): TicketAction[] {
  return (Object.keys(ACTIONS) as TicketAction[]).filter(
    (action) => !blockedReason(action, ticket, user, now),
  );
}

/** The stage an action moves the ticket to. */
export function nextStage(action: TicketAction, ticket: WorkflowTicket): TicketStage {
  switch (action) {
    case 'triage':
      return 'TRIAGED';
    case 'assign':
      return 'ASSIGNED';
    case 'accept':
      return 'ACCEPTED';
    case 'decline':
      return 'TRIAGED';
    case 'arrive':
      return 'ON_SITE';
    case 'start':
      return 'IN_PROGRESS';
    case 'hold':
      return 'ON_HOLD';
    case 'resume':
      return ticket.stageBeforeHold ?? (ticket.engineerId ? 'ASSIGNED' : 'TRIAGED');
    case 'resolve':
      return 'RESOLVED';
    case 'verify':
      return 'VERIFIED';
    case 'reject':
      return 'IN_PROGRESS';
    case 'close':
      return 'CLOSED';
    case 'cancel':
      return 'CANCELLED';
    case 'reopen':
      return ticket.engineerId ? 'ASSIGNED' : 'TRIAGED';
  }
}
