"use client";

import { Lock, MoreHorizontal, Search, UserPlus, Users } from "lucide-react";
import { useState, type ReactNode } from "react";
import useSWR from "swr";
import { StatusPill, Tag, type Tone } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/field";
import { Avatar, PageHeader } from "@/components/ui/misc";
import { Popover } from "@/components/ui/popover";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/states";
import { Sub, Table, Td, Th, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { useStepUp } from "@/features/auth/use-step-up";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";
import {
  type IssuedLink,
  type Option,
  type Page,
  type UserFilters,
  type UserRow,
  usersApi,
  usersKey,
} from "./api";
import { LinkDialog } from "./link-dialog";
import { UserFormDrawer, type UserFormValues } from "./user-form-drawer";

const STATUS: Record<UserRow["status"], { label: string; tone: Tone }> = {
  ACTIVE: { label: "Active", tone: "ok" },
  INVITED: { label: "Invite pending", tone: "warn" },
  DEACTIVATED: { label: "Deactivated", tone: "done" },
};

const formatDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "Never";

export function UsersScreen() {
  const toast = useToast();
  const { me, can } = useSession();
  const stepUp = useStepUp();
  const [filters, setFilters] = useState<UserFilters>({
    search: "",
    role: "",
    status: "",
    page: 1,
  });
  const key = can("users.manage") ? usersKey(filters) : null;
  const { data, error, isLoading, mutate } = useSWR<Page<UserRow>>(
    key,
    (k: string) => apiFetch<Page<UserRow>>(k),
    {
      keepPreviousData: true,
    },
  );
  const roles = useSWR<Option[]>(key ? "/users/roles" : null, (k: string) => apiFetch<Option[]>(k));

  const [editing, setEditing] = useState<UserRow | "new" | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState<UserRow | null>(null);
  const [link, setLink] = useState<
    (IssuedLink & { kind: "invite" | "reset"; name: string }) | null
  >(null);
  const [busy, setBusy] = useState(false);

  const update = (patch: Partial<UserFilters>) => setFilters((f) => ({ ...f, page: 1, ...patch }));

  const handleError = (caught: unknown) => {
    if (caught instanceof ApiError && caught.code === "STEP_UP_CANCELLED") return;
    toast.error(caught instanceof ApiError ? caught.message : "Something went wrong. Try again.");
    if (caught instanceof ApiError && caught.code === "VERSION_CONFLICT") void mutate();
  };

  const saveUser = async (values: UserFormValues) => {
    if (editing === "new") {
      const result = await usersApi.invite({
        name: values.name,
        email: values.email,
        role: values.role,
        regionId: values.regionId || undefined,
      });
      setEditing(null);
      setLink({ ...result.invite, kind: "invite", name: result.user.name });
      toast.success(`${result.user.name} was invited.`);
    } else if (editing) {
      await usersApi.update(editing.id, {
        name: values.name,
        role: editing.id === me?.user.id ? undefined : values.role,
        regionId: values.regionId || null,
        version: editing.version,
      });
      setEditing(null);
      toast.success("Changes saved.");
    }
    await mutate();
  };

  const issueLink = async (user: UserRow, kind: "invite" | "reset") => {
    try {
      const issued =
        kind === "invite"
          ? await usersApi.inviteLink(user.id)
          : await stepUp.run(() => usersApi.resetLink(user.id));
      setLink({ ...issued, kind, name: user.name });
    } catch (caught) {
      handleError(caught);
    }
  };

  const setActive = async (user: UserRow, active: boolean) => {
    setBusy(true);
    try {
      await (active ? usersApi.reactivate(user.id) : usersApi.deactivate(user.id));
      toast.success(
        active ? `${user.name} was reactivated.` : `${user.name} was deactivated and signed out.`,
      );
      setConfirmDeactivate(null);
      await mutate();
    } catch (caught) {
      handleError(caught);
    } finally {
      setBusy(false);
    }
  };

  if (!can("users.manage") && me) {
    return (
      <>
        <PageHeader title="Users & roles" />
        <Card>
          <EmptyState
            icon={<Lock className="size-6" />}
            title="You don't have access to this"
            description="Only administrators can manage users."
          />
        </Card>
      </>
    );
  }

  const total = data?.meta.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 25));

  return (
    <>
      <PageHeader
        title="Users & roles"
        description={
          data
            ? `${total} ${total === 1 ? "person" : "people"}`
            : "Invite people and choose what they can do."
        }
        actions={
          <Button
            variant="primary"
            icon={<UserPlus className="size-4" aria-hidden />}
            onClick={() => setEditing("new")}
          >
            Invite user
          </Button>
        }
      />

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3.5 py-3">
          <div className="relative min-w-56 flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted"
              aria-hidden
            />
            <label htmlFor="user-search" className="sr-only">
              Search users
            </label>
            <input
              id="user-search"
              type="search"
              placeholder="Name or email"
              value={filters.search}
              onChange={(event) => update({ search: event.target.value })}
              className="min-h-9 w-full rounded-lg border border-line-strong bg-surface pr-3 pl-8 placeholder:text-faint focus:border-accent focus:outline-2 focus:outline-offset-0 focus:outline-accent/50 max-sm:text-base"
            />
          </div>
          <Select
            aria-label="Role"
            value={filters.role}
            onChange={(e) => update({ role: e.target.value })}
            className="min-h-9 sm:w-auto!"
          >
            <option value="">All roles</option>
            {roles.data?.map((role) => (
              <option key={role.value} value={role.value}>
                {role.label}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Status"
            value={filters.status}
            onChange={(e) => update({ status: e.target.value })}
            className="min-h-9 sm:w-auto!"
          >
            <option value="">Any status</option>
            <option value="ACTIVE">Active</option>
            <option value="INVITED">Invite pending</option>
            <option value="DEACTIVATED">Deactivated</option>
          </Select>
        </div>

        {isLoading && !data && <TableSkeleton label="Loading users" />}
        {error && !data && (
          <ErrorState
            title="Couldn't load users"
            description={error instanceof ApiError ? error.message : undefined}
            onRetry={() => void mutate()}
          />
        )}
        {data && data.data.length === 0 && (
          <EmptyState
            icon={<Users className="size-6" />}
            title={
              filters.search || filters.role || filters.status
                ? "No one matches these filters"
                : "No users yet"
            }
            description={
              filters.search || filters.role || filters.status
                ? "Try a different name or clear the filters."
                : "Invite your team to get started."
            }
          />
        )}
        {data && data.data.length > 0 && (
          <Table caption="Users">
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Role</Th>
                <Th>Region</Th>
                <Th>Status</Th>
                <Th>Last sign-in</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((user) => {
                const self = user.id === me?.user.id;
                return (
                  <Tr key={user.id}>
                    <Td className="min-w-56">
                      <span className="flex items-center gap-2.5">
                        <Avatar name={user.name} />
                        <span className="min-w-0">
                          <span className="block font-semibold">
                            {user.name}
                            {self && (
                              <span className="ml-1.5 text-xs font-normal text-muted">(you)</span>
                            )}
                          </span>
                          <Sub>{user.email}</Sub>
                        </span>
                      </span>
                    </Td>
                    <Td className="whitespace-nowrap">{user.roleLabel}</Td>
                    <Td className="whitespace-nowrap">
                      {user.region?.name ?? <span className="text-muted">—</span>}
                    </Td>
                    <Td>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <StatusPill tone={STATUS[user.status].tone}>
                          {STATUS[user.status].label}
                        </StatusPill>
                        {user.locked && (
                          <Tag icon={<Lock className="size-3" aria-hidden />}>Locked</Tag>
                        )}
                      </span>
                    </Td>
                    <Td className="whitespace-nowrap text-muted">{formatDate(user.lastLoginAt)}</Td>
                    <Td align="right">
                      <span className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(user)}>
                          Edit
                        </Button>
                        <Popover
                          className="w-64"
                          trigger={(props) => (
                            <IconButton
                              label={`More actions for ${user.name}`}
                              size="sm"
                              {...props}
                            >
                              <MoreHorizontal className="size-4" aria-hidden />
                            </IconButton>
                          )}
                        >
                          {(close) => (
                            <div className="flex flex-col py-1.5 text-left">
                              {user.status === "INVITED" && (
                                <MenuItem
                                  onClick={() => {
                                    close();
                                    void issueLink(user, "invite");
                                  }}
                                >
                                  New invite link
                                </MenuItem>
                              )}
                              {user.status === "ACTIVE" && (
                                <MenuItem
                                  onClick={() => {
                                    close();
                                    void issueLink(user, "reset");
                                  }}
                                >
                                  Password reset link
                                </MenuItem>
                              )}
                              {user.status === "DEACTIVATED" ? (
                                <MenuItem
                                  onClick={() => {
                                    close();
                                    void setActive(user, true);
                                  }}
                                >
                                  Reactivate
                                </MenuItem>
                              ) : (
                                !self && (
                                  <MenuItem
                                    danger
                                    onClick={() => {
                                      close();
                                      setConfirmDeactivate(user);
                                    }}
                                  >
                                    Deactivate…
                                  </MenuItem>
                                )
                              )}
                            </div>
                          )}
                        </Popover>
                      </span>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}

        {data && pages > 1 && (
          <div className="flex items-center gap-2 border-t border-line px-3.5 py-2.5 text-[12.5px] text-muted">
            Page {filters.page} of {pages}
            <span className="ml-auto flex gap-2">
              <Button
                size="sm"
                disabled={filters.page <= 1}
                onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}
              >
                Previous
              </Button>
              <Button
                size="sm"
                disabled={filters.page >= pages}
                onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}
              >
                Next
              </Button>
            </span>
          </div>
        )}
      </Card>

      <UserFormDrawer
        open={editing !== null}
        user={editing && editing !== "new" ? editing : undefined}
        isSelf={editing !== "new" && editing?.id === me?.user.id}
        onClose={() => setEditing(null)}
        onSubmit={saveUser}
      />

      <Dialog
        open={confirmDeactivate !== null}
        onClose={() => setConfirmDeactivate(null)}
        title={`Deactivate ${confirmDeactivate?.name ?? ""}?`}
        description="They're signed out everywhere straight away and can't sign in. Their tickets and history stay. You can reactivate them later."
        footer={
          <>
            <Button onClick={() => setConfirmDeactivate(null)}>Cancel</Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={() => confirmDeactivate && void setActive(confirmDeactivate, false)}
            >
              Deactivate
            </Button>
          </>
        }
      />

      <LinkDialog link={link} onClose={() => setLink(null)} />
      {stepUp.dialog}
    </>
  );
}

function MenuItem({
  children,
  onClick,
  danger,
}: {
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`cursor-pointer px-4 py-2.5 text-left hover:bg-surface-2 ${danger ? "text-bad" : "text-text"}`}
    >
      {children}
    </button>
  );
}
