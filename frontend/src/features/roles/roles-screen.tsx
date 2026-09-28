"use client";

import { KeyRound, Lock, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { Tag } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/misc";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/states";
import { Sub, Table, Td, Th, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { useStepUp } from "@/features/auth/use-step-up";
import { FormAlert } from "@/features/service-rules/shared";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";
import {
  type Catalog,
  CATALOG_KEY,
  rolesApi,
  ROLES_KEY,
  type RoleInput,
  type RoleRow,
} from "./api";
import { accessSummary } from "./grid";
import { RoleDrawer } from "./role-drawer";

const fetcher = <T,>(key: string) => apiFetch<T>(key);

export function RolesScreen() {
  const { can, me } = useSession();
  const allowed = can("roles.read");
  const roles = useSWR<RoleRow[]>(allowed ? ROLES_KEY : null, fetcher);
  const catalog = useSWR<Catalog>(allowed ? CATALOG_KEY : null, fetcher);
  const toast = useToast();
  const stepUp = useStepUp();
  const [editing, setEditing] = useState<RoleRow | "new" | null>(null);
  const [deleting, setDeleting] = useState<RoleRow | null>(null);
  const [deleteError, setDeleteError] = useState<string>();
  const [removing, setRemoving] = useState(false);

  if (me && !allowed) {
    return (
      <>
        <PageHeader title="Roles" />
        <Card>
          <EmptyState icon={<Lock className="size-6" />} title="You don't have access to this" />
        </Card>
      </>
    );
  }

  const scopeLabel = (value: RoleRow["ticketScope"]) =>
    catalog.data?.scopes.find((s) => s.value === value)?.label ?? value;

  const save = async (input: RoleInput) => {
    if (editing === "new") {
      const created = await stepUp.run(() => rolesApi.create(input));
      toast.success(`${created.name} created. Give it to people under Users & roles.`);
    } else if (editing) {
      const updated = await stepUp.run(() =>
        rolesApi.update(editing.id, { ...input, version: editing.version }),
      );
      const open = updated.openTicketsLeftAssigned;
      toast.success(
        open
          ? `${updated.name} saved. ${open} open ${open === 1 ? "ticket is" : "tickets are"} still assigned to people who are no longer engineers. Reassign them.`
          : `${updated.name} saved.`,
      );
    }
    setEditing(null);
    await roles.mutate();
  };

  const remove = async () => {
    if (!deleting) return;
    setRemoving(true);
    try {
      await stepUp.run(() => rolesApi.remove(deleting.id, deleting.version));
      toast.success(`${deleting.name} deleted.`);
      setDeleting(null);
      await roles.mutate();
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "STEP_UP_CANCELLED") return;
      setDeleteError(
        caught instanceof ApiError ? caught.message : "Something went wrong. Try again.",
      );
    } finally {
      setRemoving(false);
    }
  };

  const grid = catalog.data;
  const loading = (!roles.data && !roles.error) || (!catalog.data && !catalog.error);
  const failed = roles.error ?? catalog.error;

  return (
    <>
      <PageHeader
        title="Roles"
        description="What people can see and do. Everyone has one role; changes apply straight away."
        actions={
          can("roles.create") && (
            <Button
              variant="primary"
              icon={<Plus className="size-4" aria-hidden />}
              onClick={() => setEditing("new")}
              disabled={!catalog.data}
            >
              New role
            </Button>
          )
        }
      />
      <Card>
        {failed && !loading && (
          <ErrorState
            title="Couldn't load roles"
            description={failed instanceof ApiError ? failed.message : undefined}
            onRetry={() => {
              void roles.mutate();
              void catalog.mutate();
            }}
          />
        )}
        {loading && <TableSkeleton label="Loading roles" />}
        {roles.data?.length === 0 && (
          <EmptyState icon={<KeyRound className="size-6" />} title="No roles yet" />
        )}
        {roles.data && grid && roles.data.length > 0 && (
          <Table caption="Roles">
            <thead>
              <tr>
                <Th>Role</Th>
                <Th>Tickets they see</Th>
                <Th>Can open</Th>
                <Th align="right">People</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {roles.data.map((role) => (
                <Tr key={role.id}>
                  <Td className="min-w-56">
                    <span className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setEditing(role)}
                        className="cursor-pointer font-semibold text-text underline-offset-2 hover:underline"
                      >
                        {role.name}
                      </button>
                      {role.isLocked ? (
                        <Tag icon={<Lock className="size-3" aria-hidden />}>Locked</Tag>
                      ) : (
                        role.isBuiltIn && <Tag>Built-in</Tag>
                      )}
                    </span>
                    {role.description && <Sub>{role.description}</Sub>}
                  </Td>
                  <Td className="whitespace-nowrap">{scopeLabel(role.ticketScope)}</Td>
                  <Td className="min-w-48 text-muted">{accessSummary(role.permissions, grid)}</Td>
                  <Td align="right" className="tabular-nums">
                    {role.userCount}
                  </Td>
                  <Td align="right">
                    <span className="flex items-center justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(role)}>
                        {role.isLocked || !can("roles.edit") ? "View" : "Edit"}
                      </Button>
                      {can("roles.delete") && !role.isBuiltIn && (
                        <IconButton
                          label={`Delete ${role.name}`}
                          size="sm"
                          onClick={() => {
                            setDeleteError(undefined);
                            setDeleting(role);
                          }}
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </IconButton>
                      )}
                    </span>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {catalog.data && (
        <RoleDrawer
          key={editing === "new" ? "new" : (editing?.id ?? "closed")}
          role={editing}
          roles={roles.data ?? []}
          catalog={catalog.data}
          canSave={editing === "new" ? can("roles.create") : can("roles.edit")}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}

      <Dialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting?.name ?? "role"}?`}
        description={
          deleting?.userCount ? undefined : "Nobody has this role, so no one loses access."
        }
        footer={
          <>
            <Button onClick={() => setDeleting(null)}>Cancel</Button>
            <Button
              variant="danger"
              loading={removing}
              disabled={!!deleting?.userCount}
              onClick={() => void remove()}
            >
              Delete role
            </Button>
          </>
        }
      >
        <FormAlert
          message={
            deleteError ??
            (deleting?.userCount
              ? `${deleting.userCount === 1 ? "1 person has" : `${deleting.userCount} people have`} this role. Give them another role first.`
              : undefined)
          }
        />
      </Dialog>
      {stepUp.dialog}
    </>
  );
}
