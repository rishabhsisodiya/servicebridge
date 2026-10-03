import { HttpStatus } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AppException } from '../core/http/app.exception';
import type { AuthUser } from '../auth/auth.types';
import type { CustomerIdentity } from './portal.guard';

/** A 404-masking "not found": out-of-scope records must never leak via 403. */
export const portalNotFound = (code: string, message: string) =>
  new AppException(code, message, HttpStatus.NOT_FOUND);

/**
 * Every portal record carries customerId, so portal visibility is just the
 * customer scope — fetch-then-404, never 403, so record ids don't leak.
 */
export function visibleToCustomer(customerId: string): Prisma.TicketWhereInput {
  return { customerId };
}

/**
 * The synthetic actor passed into tickets.create(). Portal tickets belong to
 * ERPTick itself (createdById: null), exactly like the partner seam;
 * the contact is identified in the audit summary instead.
 */
export function portalActor(identity: CustomerIdentity): AuthUser {
  return {
    id: `customer:${identity.contactId}`,
    email: identity.email,
    name: identity.contactName,
    roleId: '',
    isAdmin: false,
    ticketScope: 'ALL',
    regionId: null,
    permissions: [],
    sessionId: '',
    stepUpAt: null,
  } as unknown as AuthUser;
}

/** Display name for a machine: the ERP item name, falling back to the serial. */
export function equipmentName(equipment: { itemName: string | null; serialNo: string }): string {
  return equipment.itemName ?? equipment.serialNo;
}
