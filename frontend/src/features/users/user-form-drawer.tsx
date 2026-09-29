"use client";

import { useState, type FormEvent } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { apiFetch, ApiError } from "@/lib/api/client";
import type { Option, UserRow } from "./api";

export interface UserFormValues {
  name: string;
  email: string;
  role: string;
  regionId: string;
}

interface UserFormDrawerProps {
  /** Omit to invite a new user. */
  user?: UserRow;
  isSelf?: boolean;
  open: boolean;
  onClose: () => void;
  onSubmit: (values: UserFormValues) => Promise<void>;
}

type Errors = Partial<Record<keyof UserFormValues | "form", string>>;

const fetcher = <T,>(key: string) => apiFetch<T>(key);

/** Invite or edit form. Keyed by the user so it resets when a different user is opened. */
export function UserFormDrawer(props: UserFormDrawerProps) {
  return <UserForm key={props.open ? (props.user?.id ?? "new") : "closed"} {...props} />;
}

function UserForm({ user, isSelf, open, onClose, onSubmit }: UserFormDrawerProps) {
  const roles = useSWR<Option[]>(open ? "/users/roles" : null, fetcher);
  const regions = useSWR<{ id: string; name: string }[]>(open ? "/regions" : null, fetcher);
  const [values, setValues] = useState<UserFormValues>({
    name: user?.name ?? "",
    email: user?.email ?? "",
    role: user?.role.id ?? "",
    regionId: user?.region?.id ?? "",
  });
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const editing = !!user;

  const set = (field: keyof UserFormValues) => (event: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [field]: event.target.value }));

  const initial: UserFormValues = {
    name: user?.name ?? "",
    email: user?.email ?? "",
    role: user?.role.id ?? "",
    regionId: user?.region?.id ?? "",
  };
  const dirty = (Object.keys(values) as (keyof UserFormValues)[]).some(
    (k) => values[k] !== initial[k],
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next: Errors = {};
    if (values.name.trim().length < 2) next.name = "Enter their full name.";
    if (!editing && !/^\S+@\S+\.\S+$/.test(values.email.trim()))
      next.email = "Enter a valid email address.";
    if (!values.role) next.role = "Choose a role.";
    setErrors(next);
    if (Object.keys(next).length) return;

    setSaving(true);
    try {
      await onSubmit(values);
    } catch (caught) {
      const apiError = caught instanceof ApiError ? caught : undefined;
      const fieldErrors: Errors = {};
      for (const field of ["name", "email", "role", "regionId"] as const) {
        // The API calls the role field roleId.
        const message = apiError?.fieldMessage(field === "role" ? "roleId" : field);
        if (message) fieldErrors[field] = message;
      }
      if (!Object.keys(fieldErrors).length)
        fieldErrors.form = apiError?.message ?? "Something went wrong. Try again.";
      setErrors(fieldErrors);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      dirty={dirty}
      title={editing ? `Edit ${user.name}` : "Invite a user"}
      description={
        editing ? user.email : "You'll get a one-time link to send them. It expires after 48 hours."
      }
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="user-form" variant="primary" loading={saving}>
            {editing ? "Save changes" : "Create invite link"}
          </Button>
        </>
      }
    >
      <form id="user-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {errors.form && (
          <p role="alert" className="rounded-lg bg-bad-bg px-3.5 py-2.5 text-[13px] text-bad">
            {errors.form}
          </p>
        )}
        <Field label="Full name" required error={errors.name}>
          {(p) => <Input {...p} autoComplete="off" value={values.name} onChange={set("name")} />}
        </Field>
        {!editing && (
          <Field label="Work email" required error={errors.email}>
            {(p) => (
              <Input
                {...p}
                type="email"
                autoComplete="off"
                value={values.email}
                onChange={set("email")}
              />
            )}
          </Field>
        )}
        <Field
          label="Role"
          required
          error={errors.role}
          help={
            isSelf
              ? "You can't change your own role."
              : "Decides which screens and actions they get."
          }
        >
          {(p) => (
            <Select
              {...p}
              value={values.role}
              onChange={set("role")}
              disabled={isSelf || roles.isLoading}
            >
              <option value="">{roles.isLoading ? "Loading roles…" : "Choose a role"}</option>
              {roles.data?.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label="Region"
          error={errors.regionId}
          help={
            regions.data?.length === 0
              ? "No regions yet. They're added under Settings → Regions."
              : "Engineers and area managers only see tickets in their region."
          }
        >
          {(p) => (
            <Select
              {...p}
              value={values.regionId}
              onChange={set("regionId")}
              disabled={regions.isLoading}
            >
              <option value="">No region</option>
              {regions.data?.map((region) => (
                <option key={region.id} value={region.id}>
                  {region.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </form>
    </Drawer>
  );
}
