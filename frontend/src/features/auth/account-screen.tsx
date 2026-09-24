"use client";

import { LogOut } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/misc";
import { Skeleton } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useSession, type Me } from "@/lib/auth/session";
import { PasswordInput, PasswordRules, passwordChecks } from "./password-input";

export function AccountScreen() {
  const { me } = useSession();
  return (
    <>
      <PageHeader title="My account" description="Your details, password and signed-in devices." />
      {!me ? (
        <Card>
          <CardBody className="flex flex-col gap-3" role="status" aria-label="Loading your account">
            <Skeleton className="w-1/3" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ProfileCard key={me.user.id} me={me} />
          <div className="flex flex-col gap-4">
            <PasswordCard email={me.user.email} />
            <DevicesCard />
          </div>
        </div>
      )}
    </>
  );
}

function ProfileCard({ me }: { me: Me }) {
  const toast = useToast();
  const { refresh } = useSession();
  const [name, setName] = useState(me.user.name);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (name.trim().length < 2) {
      setError("Enter your full name.");
      return;
    }
    setError(undefined);
    setSaving(true);
    try {
      await apiFetch("/auth/me", { method: "PATCH", json: { name } });
      await refresh();
      toast.success("Your name was updated.");
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? (caught.fieldMessage("name") ?? caught.message)
          : "Something went wrong.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card aria-labelledby="profile-title">
      <CardHeader titleId="profile-title" title="Profile" />
      <CardBody>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <Field label="Full name" error={error}>
            {(p) => (
              <Input
                {...p}
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </Field>
          <Field label="Email" help="Ask an administrator to change your email.">
            {(p) => <Input {...p} readOnly value={me.user.email} />}
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Role" help="Set by an administrator.">
              {(p) => <Input {...p} readOnly value={me.user.roleLabel} />}
            </Field>
            <Field label="Region">
              {(p) => <Input {...p} readOnly value={me.user.region?.name ?? "No region"} />}
            </Field>
          </div>
          <div>
            <Button
              type="submit"
              variant="strong"
              loading={saving}
              disabled={name.trim() === me.user.name}
            >
              Save name
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function PasswordCard({ email }: { email: string }) {
  const toast = useToast();
  const [values, setValues] = useState({ current: "", next: "", confirm: "" });
  const [errors, setErrors] = useState<Partial<Record<"current" | "next" | "confirm", string>>>({});
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next: typeof errors = {};
    if (!values.current) next.current = "Enter your current password.";
    if (passwordChecks(values.next).some((c) => !c.met)) next.next = "Meet both rules below.";
    if (values.confirm !== values.next) next.confirm = "The two passwords don't match.";
    setErrors(next);
    if (Object.keys(next).length) return;

    setSaving(true);
    try {
      await apiFetch("/auth/change-password", {
        method: "POST",
        json: { currentPassword: values.current, newPassword: values.next },
      });
      setValues({ current: "", next: "", confirm: "" });
      toast.success("Password changed. You were signed out on your other devices.");
    } catch (caught) {
      const apiError = caught instanceof ApiError ? caught : undefined;
      setErrors({
        current: apiError?.fieldMessage("currentPassword"),
        next:
          apiError?.fieldMessage("newPassword") ??
          (apiError?.fields.length ? undefined : apiError?.message),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card aria-labelledby="password-title">
      <CardHeader titleId="password-title" title="Password" />
      <CardBody>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <input
            type="email"
            name="username"
            autoComplete="username"
            value={email}
            readOnly
            hidden
          />
          <Field label="Current password" error={errors.current}>
            {(p) => (
              <PasswordInput
                {...p}
                autoComplete="current-password"
                value={values.current}
                onChange={(e) => setValues((v) => ({ ...v, current: e.target.value }))}
              />
            )}
          </Field>
          <Field
            label="New password"
            error={errors.next}
            help={<PasswordRules password={values.next} id="new-password-rules" />}
          >
            {(p) => (
              <PasswordInput
                {...p}
                autoComplete="new-password"
                value={values.next}
                onChange={(e) => setValues((v) => ({ ...v, next: e.target.value }))}
              />
            )}
          </Field>
          <Field label="Type the new password again" error={errors.confirm}>
            {(p) => (
              <PasswordInput
                {...p}
                autoComplete="new-password"
                value={values.confirm}
                onChange={(e) => setValues((v) => ({ ...v, confirm: e.target.value }))}
              />
            )}
          </Field>
          <div>
            <Button type="submit" variant="strong" loading={saving}>
              Change password
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function DevicesCard() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const signOutElsewhere = async () => {
    setBusy(true);
    try {
      const { signedOut } = await apiFetch<{ signedOut: number }>("/auth/sessions/revoke-others", {
        method: "POST",
      });
      toast.success(
        signedOut === 0
          ? "You weren't signed in anywhere else."
          : `Signed out on ${signedOut} other device${signedOut === 1 ? "" : "s"}.`,
      );
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card aria-labelledby="devices-title">
      <CardHeader titleId="devices-title" title="Signed-in devices" />
      <CardBody className="flex flex-col items-start gap-3">
        <p className="text-muted">
          If you used a shared computer or lost a phone, sign out everywhere except this browser.
        </p>
        <Button
          icon={<LogOut className="size-4" aria-hidden />}
          loading={busy}
          onClick={signOutElsewhere}
        >
          Sign out on other devices
        </Button>
      </CardBody>
    </Card>
  );
}
