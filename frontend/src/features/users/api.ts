import { apiFetch } from "@/lib/api/client";

export type UserStatus = "INVITED" | "ACTIVE" | "DEACTIVATED";

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: { id: string; name: string };
  status: UserStatus;
  locked: boolean;
  region: { id: string; name: string } | null;
  lastLoginAt: string | null;
  createdAt: string;
  version: number;
}

export interface Page<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number };
}

export interface IssuedLink {
  url: string;
  expiresAt: string;
  /** True when the link was also emailed to the user (session 12). */
  emailed?: boolean;
}

export interface Option {
  value: string;
  label: string;
}

export interface UserFilters {
  search: string;
  /** Role id. */
  role: string;
  status: string;
  page: number;
}

export function usersKey(filters: UserFilters): string {
  const params = new URLSearchParams({ page: String(filters.page), pageSize: "25" });
  if (filters.search.trim()) params.set("search", filters.search.trim());
  if (filters.role) params.set("roleId", filters.role);
  if (filters.status) params.set("status", filters.status);
  return `/users?${params}`;
}

export const usersApi = {
  invite: (body: { name: string; email: string; roleId: string; regionId?: string }) =>
    apiFetch<{ user: UserRow; invite: IssuedLink }>("/users/invite", {
      method: "POST",
      json: body,
    }),
  update: (
    id: string,
    body: { name?: string; roleId?: string; regionId?: string | null; version: number },
  ) => apiFetch<UserRow>(`/users/${id}`, { method: "PATCH", json: body }),
  deactivate: (id: string) => apiFetch<UserRow>(`/users/${id}/deactivate`, { method: "POST" }),
  reactivate: (id: string) => apiFetch<UserRow>(`/users/${id}/reactivate`, { method: "POST" }),
  inviteLink: (id: string) => apiFetch<IssuedLink>(`/users/${id}/invite-link`, { method: "POST" }),
  resetLink: (id: string) => apiFetch<IssuedLink>(`/users/${id}/reset-link`, { method: "POST" }),
};
