import type { DutyStatus } from '@prisma/client';

/** An engineer as the assignment rules see them. Pure data: no database access here. */
export interface Candidate {
  id: string;
  name: string;
  regionId: string | null;
  regionName: string | null;
  dutyStatus: DutyStatus;
  skills: { name: string; equipmentModels: string[] }[];
  /** Tickets assigned and not yet resolved. */
  openTickets: number;
  /** Has a ticket on site or in progress right now. */
  onVisit: boolean;
}

export interface RankedEngineer {
  id: string;
  name: string;
  region: string | null;
  dutyStatus: DutyStatus;
  onVisit: boolean;
  sameRegion: boolean;
  /** Names of this engineer's skills that cover the ticket's machine model. */
  skills: string[];
  openTickets: number;
  current: boolean;
}

export interface AssignmentTicket {
  regionId: string | null;
  itemCode: string | null;
  engineerId: string | null;
}

/**
 * Suggestion order: on duty first, then a matching skill, then same region,
 * then fewest open tickets, then name (stable and predictable for managers).
 */
export function rankEngineers(candidates: Candidate[], ticket: AssignmentTicket): RankedEngineer[] {
  return candidates
    .map((c) => ({
      id: c.id,
      name: c.name,
      region: c.regionName,
      dutyStatus: c.dutyStatus,
      onVisit: c.onVisit,
      sameRegion: !!ticket.regionId && c.regionId === ticket.regionId,
      skills: ticket.itemCode
        ? c.skills.filter((s) => s.equipmentModels.includes(ticket.itemCode!)).map((s) => s.name)
        : [],
      openTickets: c.openTickets,
      current: c.id === ticket.engineerId,
    }))
    .sort(
      (a, b) =>
        Number(b.dutyStatus === 'ON_DUTY') - Number(a.dutyStatus === 'ON_DUTY') ||
        Number(b.skills.length > 0) - Number(a.skills.length > 0) ||
        Number(b.sameRegion) - Number(a.sameRegion) ||
        a.openTickets - b.openTickets ||
        a.name.localeCompare(b.name),
    );
}

/**
 * Who automatic assignment picks: the best on-duty engineer who either has the
 * machine's skill or works in the ticket's region. Nobody otherwise, so a
 * manager decides instead of the ticket going to a random engineer.
 */
export function pickAutoAssignee(ranked: RankedEngineer[]): RankedEngineer | null {
  return (
    ranked.find((e) => e.dutyStatus === 'ON_DUTY' && (e.skills.length > 0 || e.sameRegion)) ?? null
  );
}
