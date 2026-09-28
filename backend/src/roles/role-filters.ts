import type { Prisma } from '@prisma/client';
import { ADMIN_PERMISSIONS, type Permission, permissionsOf } from '../auth/permissions';

/**
 * Roles that grant `permission`, for queries such as "every engineer"
 * (`tickets.work`). Stored permission lists are normalised on save, so a
 * plain array lookup is enough; the locked Administrator role grants
 * everything in ADMIN_PERMISSIONS without storing it.
 */
export function rolesWith(permission: Permission): Prisma.RoleWhereInput {
  return ADMIN_PERMISSIONS.includes(permission)
    ? { OR: [{ isLocked: true }, { permissions: { has: permission } }] }
    : { isLocked: false, permissions: { has: permission } };
}

export function roleGrants(
  role: { isLocked: boolean; permissions: readonly string[] },
  permission: Permission,
): boolean {
  return permissionsOf(role).includes(permission);
}
