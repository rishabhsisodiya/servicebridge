"use client";

import { LinkIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { EmptyState, Skeleton } from "@/components/ui/states";
import { apiFetch, ApiError } from "@/lib/api/client";
import { PasswordInput, PasswordRules, passwordChecks } from "./password-input";

interface LinkInfo {
  type: "INVITE" | "PASSWORD_RESET";
  name: string;
  email: string;
  expiresAt: string;
}

/** Shared by /welcome/[token] (invites) and /reset-password/[token]. */
export function SetPasswordForm({ token }: { token: string }) {
  const { data, error, isLoading } = useSWR<LinkInfo, ApiError>(
    `/auth/links/${token}`,
    (key: string) => apiFetch<LinkInfo>(key, { noAuthRedirect: true }),
  );
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ password?: string; confirm?: string; form?: string }>({});
  const [saving, setSaving] = useState(false);

  if (isLoading) {
    return (
      <div role="status" aria-label="Checking your link" className="flex flex-col gap-3">
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <EmptyState
        icon={<LinkIcon className="size-6" />}
        title="This link can't be used"
        description={
          error?.code === "LINK_INVALID"
            ? error.message
            : "We couldn't check this link. Check your connection and reload the page."
        }
      />
    );
  }

  const invite = data.type === "INVITE";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next: typeof errors = {};
    if (passwordChecks(password).some((check) => !check.met))
      next.password = "Meet both rules below.";
    if (confirm !== password) next.confirm = "The two passwords don't match.";
    setErrors(next);
    if (next.password || next.confirm) return;

    setSaving(true);
    try {
      await apiFetch(`/auth/links/${token}/accept`, {
        method: "POST",
        json: { password },
        noAuthRedirect: true,
      });
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full load clears every cached screen from the previous session
      window.location.assign("/");
    } catch (caught) {
      setSaving(false);
      const apiError = caught instanceof ApiError ? caught : undefined;
      setErrors({
        password: apiError?.fieldMessage("password"),
        form: apiError?.fieldMessage("password")
          ? undefined
          : (apiError?.message ?? "Something went wrong. Try again."),
      });
    }
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <div>
        <h1 id="page-title" tabIndex={-1} className="text-2xl font-semibold tracking-tight">
          {invite ? `Welcome, ${data.name.split(" ")[0]}` : "Choose a new password"}
        </h1>
        <p className="mt-1 text-muted">
          {invite
            ? "Set a password to finish setting up your account."
            : "Your old password stops working once you save."}{" "}
          You&apos;ll sign in as <span className="font-semibold text-text">{data.email}</span>.
        </p>
      </div>

      {errors.form && (
        <p role="alert" className="rounded-lg bg-bad-bg px-3.5 py-2.5 text-[13px] text-bad">
          {errors.form}
        </p>
      )}

      {/* Lets password managers save the new password against the right account. */}
      <input
        type="email"
        name="username"
        autoComplete="username"
        value={data.email}
        readOnly
        hidden
      />

      <Field
        label="New password"
        error={errors.password}
        help={<PasswordRules password={password} id="password-rules" />}
      >
        {(props) => (
          <PasswordInput
            {...props}
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="min-h-11"
          />
        )}
      </Field>
      <Field label="Type it again" error={errors.confirm}>
        {(props) => (
          <PasswordInput
            {...props}
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            className="min-h-11"
          />
        )}
      </Field>
      <Button type="submit" variant="primary" loading={saving} className="min-h-11">
        {invite ? "Set password and sign in" : "Save password and sign in"}
      </Button>
    </form>
  );
}
