import { apiFetch } from "@/lib/api/client";
import type { Permission, TicketScope } from "@/lib/auth/session";

export type RecordOp = "read" | "create" | "edit" | "delete";

export interface RecordType {
  key: string;
  label: string;
  ops: RecordOp[];
  hint?: string;
}

export interface ActionType {
  key: Permission;
  label: string;
  hint: string;
}

export interface Catalog {
  records: RecordType[];
  actions: ActionType[];
  scopes: { value: TicketScope; label: string; hint: string }[];
}

export interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  isLocked: boolean;
  isBuiltIn: boolean;
  ticketScope: TicketScope;
  permissions: Permission[];
  userCount: number;
  version: number;
  updatedAt: string;
}

export interface RoleDetail extends RoleRow {
  users: { id: string; name: string; status: "INVITED" | "ACTIVE" | "DEACTIVATED" }[];
}

export interface RoleInput {
  name: string;
  description: string | null;
  ticketScope: TicketScope;
  permissions: string[];
}

export const ROLES_KEY = "/roles";
export const CATALOG_KEY = "/roles/catalog";

export const rolesApi = {
  create: (body: RoleInput) => apiFetch<RoleRow>(ROLES_KEY, { method: "POST", json: body }),
  update: (id: string, body: RoleInput & { version: number }) =>
    apiFetch<RoleRow & { openTicketsLeftAssigned: number }>(`${ROLES_KEY}/${id}`, {
      method: "PATCH",
      json: body,
    }),
  remove: (id: string, version: number) =>
    apiFetch<void>(`${ROLES_KEY}/${id}?version=${version}`, { method: "DELETE" }),
};
