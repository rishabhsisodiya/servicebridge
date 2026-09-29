"use client";

import { AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api/client";
import { portalFetch } from "./api";

/**
 * Raise a ticket. The portal contract exposes no equipment or service-type
 * lookup, so v1 collects title + description only (see the session report:
 * a `GET /portal/meta` endpoint would unlock pickers).
 */
export function NewTicketForm() {
  const router = useRouter();
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<{ title?: string; description?: string }>({});
  const [submitting, setSubmitting] = useState(false);
  const alertRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (error) alertRef.current?.focus();
  }, [error]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const missing = {
      title: title.trim() ? undefined : "Give your request a short title.",
      description: description.trim() ? undefined : "Describe the problem.",
    };
    setFieldErrors(missing);
    setError(undefined);
    if (missing.title || missing.description) return;

    setSubmitting(true);
    try {
      const { number } = await portalFetch<{ number: string }>("/portal/tickets", {
        method: "POST",
        json: { title: title.trim(), description: description.trim() },
      });
      toast.success(`Ticket ${number} raised`);
      router.push(`/portal/tickets/${encodeURIComponent(number)}`);
    } catch (caught) {
      setSubmitting(false);
      const apiError = caught instanceof ApiError ? caught : undefined;
      setFieldErrors({
        title: apiError?.fieldMessage("title"),
        description: apiError?.fieldMessage("description"),
      });
      setError(apiError?.message ?? "Something went wrong. Try again.");
    }
  };

  return (
    <>
      <PageHeader
        title="Raise a ticket"
        description="Tell us what's wrong and we'll pick it up."
      />
      <form
        onSubmit={submit}
        noValidate
        className="mx-auto mt-5 flex w-full max-w-xl flex-col gap-5"
      >
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
        <Field label="Title" error={fieldErrors.title} required>
          {(props) => (
            <Input
              {...props}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. Compressor not cooling in Plant 2"
              maxLength={140}
              className="min-h-11"
            />
          )}
        </Field>
        <Field
          label="Description"
          error={fieldErrors.description}
          required
          help="What happened, when it started, and anything you've already tried."
        >
          {(props) => (
            <Textarea
              {...props}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={6}
            />
          )}
        </Field>
        <div>
          <Button type="submit" variant="primary" loading={submitting} className="min-h-11">
            {submitting ? "Raising ticket…" : "Raise ticket"}
          </Button>
        </div>
      </form>
    </>
  );
}
