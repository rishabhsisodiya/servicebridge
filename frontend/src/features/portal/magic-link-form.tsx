"use client";

import { AlertTriangle, CheckCircle2, MailCheck } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/misc";
import { ApiError } from "@/lib/api/client";
import { portalFetch } from "./api";

/** Passwordless sign-in: the customer gets a one-time link by email. */
export function MagicLinkForm({ signedOut }: { signedOut: boolean }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string>();
  const [fieldError, setFieldError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const alertRef = useRef<HTMLDivElement>(null);

  // Move focus to the error once it has rendered, so screen readers announce it.
  useEffect(() => {
    if (error) alertRef.current?.focus();
  }, [error]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const missing = email.trim() ? undefined : "Enter your email address.";
    setFieldError(missing);
    setError(undefined);
    if (missing) return;

    setSubmitting(true);
    try {
      await portalFetch<{ ok: boolean }>("/portal/auth/request-link", {
        method: "POST",
        json: { email: email.trim() },
      });
      setSent(true);
    } catch (caught) {
      const apiError = caught instanceof ApiError ? caught : undefined;
      setFieldError(apiError?.fieldMessage("email"));
      setError(apiError?.message ?? "Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <>
        <PageHeader title="Check your inbox" />
        <div
          role="status"
          className="mt-4 flex items-start gap-2.5 rounded-xl border border-line bg-surface px-4 py-5"
        >
          <MailCheck className="mt-0.5 size-5 shrink-0 text-ok" aria-hidden />
          <div className="flex flex-col gap-1">
            <p className="font-semibold">We sent you a sign-in link</p>
            <p className="text-muted">
              If <span className="font-medium text-text">{email.trim()}</span> belongs to a
              customer contact, a one-time link is on its way. It expires soon — open it on
              this device.
            </p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Customer portal"
        description="Sign in with your work email — we'll send you a one-time link."
      />
      <form onSubmit={submit} noValidate className="mt-5 flex flex-col gap-5">
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
        <Field label="Work email" error={fieldError}>
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
        <Button type="submit" variant="primary" loading={submitting} className="min-h-11">
          {submitting ? "Sending link…" : "Email me a sign-in link"}
        </Button>
        <p className="text-center text-xs text-muted">
          No account? Ask your service provider to add you as a customer contact.
        </p>
      </form>
    </>
  );
}
