import { HttpStatus } from '@nestjs/common';
import type { TicketScope } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { MEMBERSHIP_ACTIONS, type Permission, permissionsOf } from '../auth/permissions';
import { AppException } from '../core/http/app.exception';

type RoleLike = { isLocked: boolean; permissions: readonly string[]; ticketScope: TicketScope };
type Actor = Pick<AuthUser, 'isAdmin' | 'permissions' | 'ticketScope'>;

const SCOPE_RANK: Record<TicketScope, number> = { OWN: 0, REGION: 1, ALL: 2 };

/**
 * Permissions the actor may not hand out. Administrators may grant anything;
 * everyone else only what they hold themselves. Membership actions (engineer
 * pool, escalation alerts) give no access, so anyone may grant them.
 */
export function beyondActor(actor: Actor, permissions: readonly Permission[]): Permission[] {
  if (actor.isAdmin) return [];
  return permissions.filter(
    (p) => !actor.permissions.includes(p) && !MEMBERSHIP_ACTIONS.includes(p),
  );
}

/** True when the scope shows more tickets than the actor can see. */
export function scopeBeyondActor(actor: Actor, scope: TicketScope): boolean {
  return !actor.isAdmin && SCOPE_RANK[scope] > SCOPE_RANK[actor.ticketScope];
}

export const escalation = (message: string) =>
  new AppException('ROLE_ESCALATION', message, HttpStatus.FORBIDDEN);

/** Stops people giving out (or taking over) more access than they have. */
export function assertWithinActor(actor: Actor, role: RoleLike, action: 'assign' | 'manage') {
  if (role.isLocked && !actor.isAdmin) {
    throw escalation(
      action === 'assign'
        ? 'Only administrators can give someone the Administrator role.'
        : 'Only administrators can change administrators.',
    );
  }
  if (beyondActor(actor, permissionsOf(role)).length || scopeBeyondActor(actor, role.ticketScope)) {
    throw escalation(
      action === 'assign'
        ? 'This role has access you don’t have, so you can’t give it to someone.'
        : 'This person’s role has access you don’t have, so you can’t change their account.',
    );
  }
}
