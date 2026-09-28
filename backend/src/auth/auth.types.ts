import type { TicketScope, UserStatus } from '@prisma/client';
import type { Permission } from './permissions';

/** The signed-in user, attached to every authenticated request. */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  roleId: string;
  /** Holds the locked Administrator role. */
  isAdmin: boolean;
  /** Which tickets the user can see; set on their role. */
  ticketScope: TicketScope;
  regionId: string | null;
  permissions: Permission[];
  sessionId: string;
  stepUpAt: Date | null;
}

export interface AccessTokenClaims {
  sub: string;
  sid: string;
}

/** Shape returned by GET /auth/me and after sign-in. */
export interface MeResponse {
  user: {
    id: string;
    email: string;
    name: string;
    role: { id: string; name: string; ticketScope: TicketScope };
    status: UserStatus;
    region: { id: string; name: string } | null;
  };
  permissions: Permission[];
}

/** What the controller needs to know about the caller's connection. */
export interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}
