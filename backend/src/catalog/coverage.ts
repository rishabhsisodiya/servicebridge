import type { Prisma } from '@prisma/client';

export type Coverage = 'AMC' | 'WARRANTY' | 'CHARGEABLE';

/** An AMC ending within this many days is flagged "expiring" (renewal alerts use the same window). */
export const AMC_EXPIRING_DAYS = 60;

const startOfDay = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

/**
 * Coverage decides who pays for a visit: an active AMC first, then warranty,
 * otherwise chargeable. Expiry dates are inclusive (covered on the last day).
 */
export function coverageOf(
  machine: { amcExpiresOn: Date | null; warrantyExpiresOn: Date | null },
  today = new Date(),
): { coverage: Coverage; until: Date | null; amcExpiring: boolean } {
  const day = startOfDay(today);
  if (machine.amcExpiresOn && machine.amcExpiresOn >= day) {
    const days = (machine.amcExpiresOn.getTime() - day.getTime()) / 86_400_000;
    return { coverage: 'AMC', until: machine.amcExpiresOn, amcExpiring: days <= AMC_EXPIRING_DAYS };
  }
  if (machine.warrantyExpiresOn && machine.warrantyExpiresOn >= day) {
    return { coverage: 'WARRANTY', until: machine.warrantyExpiresOn, amcExpiring: false };
  }
  return { coverage: 'CHARGEABLE', until: null, amcExpiring: false };
}

export type CoverageFilter = 'amc' | 'amc_expiring' | 'warranty' | 'chargeable';

/** The same rules as a database filter, so lists can be filtered and paginated by coverage. */
export function coverageWhere(
  filter: CoverageFilter,
  today = new Date(),
): Prisma.EquipmentWhereInput {
  const day = startOfDay(today);
  const soon = new Date(day.getTime() + AMC_EXPIRING_DAYS * 86_400_000);
  const noAmc: Prisma.EquipmentWhereInput = {
    OR: [{ amcExpiresOn: null }, { amcExpiresOn: { lt: day } }],
  };
  switch (filter) {
    case 'amc':
      return { amcExpiresOn: { gte: day } };
    case 'amc_expiring':
      return { amcExpiresOn: { gte: day, lte: soon } };
    case 'warranty':
      return { AND: [noAmc, { warrantyExpiresOn: { gte: day } }] };
    case 'chargeable':
      return {
        AND: [noAmc, { OR: [{ warrantyExpiresOn: null }, { warrantyExpiresOn: { lt: day } }] }],
      };
  }
}
