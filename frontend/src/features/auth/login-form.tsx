"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { apiFetch, ApiError } from "@/lib/api/client";
import { PasswordInput } from "./password-input";

interface LoginFormProps {
  next: string;
  signedOut: boolean;
}

export function LoginForm({ next, signedOut }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [submitting, setSubmitting] = useState(false);
  const alertRef = useRef<HTMLDivElement>(null);

  // Move focus to the error once it has rendered, so screen readers announce it.
  useEffect(() => {
    if (error) alertRef.current?.focus();
  }, [error]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const missing = {
      email: email.trim() ? undefined : "Enter your work email.",
      password: password ? undefined : "Enter your password.",
    };
    setFieldErrors(missing);
    setError(undefined);
    if (missing.email || missing.password) return;

    setSubmitting(true);
    try {
      await apiFetch("/auth/login", {
        method: "POST",
        json: { email, password },
        noAuthRedirect: true,
      });
      // Full navigation so the app starts fresh with the new session.
      window.location.assign(next);
    } catch (caught) {
      setSubmitting(false);
      const apiError = caught instanceof ApiError ? caught : undefined;
      setFieldErrors({ email: apiError?.fieldMessage("email") });
      setError(apiError?.message ?? "Something went wrong. Try again.");
    }
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <div>
        <h1 id="page-title" tabIndex={-1} className="text-2xl font-semibold tracking-tight">
          Sign in
        </h1>
        <p className="mt-1 text-muted">Use your work email and password.</p>
      </div>

      {signedOut && !error && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg bg-ok-bg px-3.5 py-2.5 text-[13px] text-ok"
        >
          <CheckCircle2 className="size-4 shrink-0" aria-hidden />
          You&apos;ve signed out.
        </div>
      )}
      {error && (
        <div
          ref={alertRef}
          tabIndex={-1}
          role="alert"
          className="flex items-start gap-2 rounded-lg bg-bad-bg px-3.5 py-2.5 text-[13px] text-bad"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      <Field label="Work email" error={fieldErrors.email}>
        {(props) => (
          <Input
            {...props}
            type="email"
            autoComplete="username"
            inputMode="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="min-h-11"
          />
        )}
      </Field>
      <Field label="Password" error={fieldErrors.password}>
        {(props) => (
          <PasswordInput
            {...props}
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="min-h-11"
          />
        )}
      </Field>
      <Button type="submit" variant="primary" loading={submitting} className="min-h-11">
        {submitting ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-center text-xs text-muted">
        Forgot your password? Ask your administrator for a reset link.
      </p>
    </form>
  );
}
