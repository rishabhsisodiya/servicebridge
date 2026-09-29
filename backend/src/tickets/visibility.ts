import type { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';

/**
 * Where a user may see tickets, from their role's ticket scope. Everyone else
 * gets a 404, not a 403, so ticket numbers don't leak.
 *
 * Lives here (not in tickets.service.ts) so feature services like CSAT can
 * apply ticket visibility without importing the whole tickets service module.
 */
export function visibleTo(
  user: Pick<AuthUser, 'id' | 'ticketScope' | 'regionId'>,
): Prisma.TicketWhereInput {
  if (user.ticketScope === 'ALL') return {};
  if (user.ticketScope === 'OWN') {
    return { OR: [{ engineerId: user.id }, { createdById: user.id }] };
  }
  return {
    OR: [
      ...(user.regionId ? [{ regionId: user.regionId }] : []),
      { areaManagerId: user.id },
      { createdById: user.id },
      { engineerId: user.id },
    ],
  };
}
