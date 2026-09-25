import type { TicketStage } from '@prisma/client';

/** The running clock turns "at risk" in the last quarter of its target. */
export const RISK_SHARE = 0.25;

export type SlaClock = 'response' | 'resolution';
export type SlaState = 'ok' | 'risk' | 'breach' | 'paused' | 'met' | 'none';

export interface SlaTicket {
  stage: TicketStage;
  responseMinutes: number;
  resolutionMinutes: number;
  responseDueAt: Date;
  resolutionDueAt: Date;
  respondedAt: Date | null;
  resolvedAt: Date | null;
}

/** The clock that is running: response until an engineer accepts, then resolution. */
export function runningClock(t: SlaTicket): SlaClock | null {
  if (t.stage === 'CANCELLED' || t.resolvedAt || t.stage === 'ON_HOLD') return null;
  return t.respondedAt ? 'resolution' : 'response';
}

/** slaDueAt / slaRiskAt for the running clock; both null when nothing is running. */
export function slaFields(t: SlaTicket): { slaDueAt: Date | null; slaRiskAt: Date | null } {
  const clock = runningClock(t);
  if (!clock) return { slaDueAt: null, slaRiskAt: null };
  const due = clock === 'response' ? t.responseDueAt : t.resolutionDueAt;
  const target = clock === 'response' ? t.responseMinutes : t.resolutionMinutes;
  return {
    slaDueAt: due,
    slaRiskAt: new Date(due.getTime() - target * RISK_SHARE * 60_000),
  };
}

export interface SlaStatus {
  clock: SlaClock;
  state: SlaState;
  dueAt: Date | null;
  /** When the clock stopped: resolved, responded (for the response clock) or paused. */
  metAt: Date | null;
}

/** What the SLA badge shows. */
export function slaStatus(t: SlaTicket, now = new Date()): SlaStatus {
  if (t.stage === 'CANCELLED') {
    return { clock: 'resolution', state: 'none', dueAt: null, metAt: null };
  }
  if (t.resolvedAt) {
    return {
      clock: 'resolution',
      state: t.resolvedAt <= t.resolutionDueAt ? 'met' : 'breach',
      dueAt: t.resolutionDueAt,
      metAt: t.resolvedAt,
    };
  }
  const clock: SlaClock = t.respondedAt ? 'resolution' : 'response';
  if (t.stage === 'ON_HOLD') return { clock, state: 'paused', dueAt: null, metAt: null };
  const { slaDueAt, slaRiskAt } = slaFields(t);
  const state: SlaState =
    slaDueAt && now > slaDueAt ? 'breach' : slaRiskAt && now >= slaRiskAt ? 'risk' : 'ok';
  return { clock, state, dueAt: slaDueAt, metAt: null };
}
