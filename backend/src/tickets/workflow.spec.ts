import { BUILT_IN_ROLES } from '../auth/permissions';
import { slaFields, slaStatus, type SlaTicket } from './sla';
import { availableActions, blockedReason, nextStage, type WorkflowTicket } from './workflow';

/** Users with the permissions of the built-in roles. */
const as = (id: string, key: string) => ({
  id,
  permissions: BUILT_IN_ROLES.find((r) => r.key === key)?.permissions ?? [],
});
const engineer = as('eng', 'ENGINEER');
const otherEngineer = as('eng2', 'ENGINEER');
const areaManager = as('am', 'AREA_MANAGER');
const callCenter = as('cc', 'CALL_CENTER');

const ticket = (patch: Partial<WorkflowTicket> = {}): WorkflowTicket => ({
  stage: 'ASSIGNED',
  engineerId: 'eng',
  stageBeforeHold: null,
  closedAt: null,
  ...patch,
});

describe('ticket workflow', () => {
  it('lets only the assigned engineer accept', () => {
    expect(availableActions(ticket(), engineer)).toEqual(
      expect.arrayContaining(['accept', 'decline', 'hold']),
    );
    expect(blockedReason('accept', ticket(), otherEngineer)).toMatch(/assigned engineer/);
    expect(blockedReason('accept', ticket(), areaManager)).toMatch(/assigned engineer/);
  });

  it('lets managers assign and cancel, but not do field steps', () => {
    const actions = availableActions(ticket({ stage: 'NEW', engineerId: null }), areaManager);
    expect(actions).toEqual(expect.arrayContaining(['triage', 'assign', 'cancel']));
    expect(actions).not.toContain('resolve');
  });

  it('call center can log and reopen but not assign', () => {
    expect(blockedReason('assign', ticket({ stage: 'NEW' }), callCenter)).toMatch(/permission/);
    const closedAt = new Date('2026-09-20T10:00:00Z');
    expect(
      blockedReason(
        'reopen',
        ticket({ stage: 'CLOSED', closedAt }),
        callCenter,
        new Date('2026-09-25T10:00:00Z'),
      ),
    ).toBeNull();
  });

  it('refuses reopening after 7 days', () => {
    const closedAt = new Date('2026-09-01T10:00:00Z');
    expect(
      blockedReason(
        'reopen',
        ticket({ stage: 'CLOSED', closedAt }),
        callCenter,
        new Date('2026-09-25T10:00:00Z'),
      ),
    ).toMatch(/within 7 days/);
  });

  it('resumes to the stage before the hold', () => {
    expect(nextStage('resume', ticket({ stage: 'ON_HOLD', stageBeforeHold: 'IN_PROGRESS' }))).toBe(
      'IN_PROGRESS',
    );
    expect(nextStage('reopen', ticket({ stage: 'CLOSED' }))).toBe('ASSIGNED');
    expect(nextStage('reopen', ticket({ stage: 'CLOSED', engineerId: null }))).toBe('TRIAGED');
  });

  it('allows no actions on a cancelled ticket', () => {
    expect(availableActions(ticket({ stage: 'CANCELLED' }), areaManager)).toEqual([]);
  });
});

describe('SLA status', () => {
  const t0 = new Date('2026-09-25T10:00:00Z');
  const base: SlaTicket = {
    stage: 'ASSIGNED',
    responseMinutes: 120,
    resolutionMinutes: 1440,
    responseDueAt: new Date('2026-09-25T12:00:00Z'),
    resolutionDueAt: new Date('2026-09-26T10:00:00Z'),
    respondedAt: null,
    resolvedAt: null,
  };
  const at = (iso: string) => new Date(iso);

  it('runs the response clock until accepted, at risk in its last quarter', () => {
    expect(slaFields(base)).toEqual({
      slaDueAt: base.responseDueAt,
      slaRiskAt: at('2026-09-25T11:30:00Z'),
    });
    expect(slaStatus(base, t0).state).toBe('ok');
    expect(slaStatus(base, at('2026-09-25T11:45:00Z')).state).toBe('risk');
    expect(slaStatus(base, at('2026-09-25T12:01:00Z')).state).toBe('breach');
  });

  it('switches to the resolution clock after acceptance', () => {
    const accepted = {
      ...base,
      stage: 'ACCEPTED' as const,
      respondedAt: at('2026-09-25T10:20:00Z'),
    };
    expect(slaStatus(accepted, t0)).toMatchObject({ clock: 'resolution', state: 'ok' });
  });

  it('pauses on hold and reports met or breached once resolved', () => {
    expect(slaStatus({ ...base, stage: 'ON_HOLD' }, t0).state).toBe('paused');
    expect(slaFields({ ...base, stage: 'ON_HOLD' }).slaDueAt).toBeNull();
    const resolved = { ...base, stage: 'RESOLVED' as const, respondedAt: t0 };
    expect(slaStatus({ ...resolved, resolvedAt: at('2026-09-26T09:00:00Z') }).state).toBe('met');
    expect(slaStatus({ ...resolved, resolvedAt: at('2026-09-26T11:00:00Z') }).state).toBe('breach');
  });
});
