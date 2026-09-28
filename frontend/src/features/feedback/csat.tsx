"use client";

import { CheckCircle2, Star } from "lucide-react";
import { useState, type FormEvent } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/misc";
import { ErrorState, TableSkeleton } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { apiFetch, ApiError } from "@/lib/api/client";
import { cn } from "@/lib/cn";

export interface CsatDescribe {
  ticketNumber: string;
  ticketTitle: string;
  customerName: string;
  answered: boolean;
}

const fetchPublic = <T,>(key: string, init?: Omit<Parameters<typeof apiFetch>[1], "noAuthRedirect">) =>
  apiFetch<T>(key, { noAuthRedirect: true, ...init });

/** The public page a customer lands on from a feedback link. No sign-in. */
export function CsatPage({ token }: { token: string }) {
  const key = `/public/csat/${encodeURIComponent(token)}`;
  const { data, error, isLoading, mutate } = useSWR<CsatDescribe, ApiError>(key, fetchPublic);

  if (isLoading) {
    return (
      <Center>
        <PageHeader title="Service feedback" />
        <Card>
          <TableSkeleton rows={4} label="Loading the feedback form" />
        </Card>
      </Center>
    );
  }

  if (error || !data) {
    const code = error instanceof ApiError ? error.code : undefined;
    const gone = code === "CSAT_TOKEN_NOT_FOUND";
    return (
      <Center>
        <PageHeader title="Service feedback" />
        <Card>
          <ErrorState
            title={gone ? "This feedback link is no longer valid" : "Couldn't load this page"}
            description={
              gone
                ? "The link may have expired or already been used. Ask the service team for a fresh one."
                : (error instanceof ApiError ? error.message : undefined)
            }
            onRetry={gone ? undefined : () => void mutate()}
          />
        </Card>
      </Center>
    );
  }

  if (data.answered) {
    return (
      <Center>
        <PageHeader title="Service feedback" />
        <Card>
          <CardBody className="flex flex-col items-center gap-3 py-10 text-center">
            <CheckCircle2 className="size-10 text-ok" aria-hidden />
            <p className="text-lg font-semibold">Thanks — this feedback was already recorded.</p>
            <p className="max-w-md text-[13px] text-muted">
              Each link works once. If something else needs attention, reply to the service
              team&apos;s email.
            </p>
          </CardBody>
        </Card>
      </Center>
    );
  }

  return (
    <Center>
      <PageHeader
        title="How was our service?"
        description={`Ticket ${data.ticketNumber} — ${data.ticketTitle}`}
      />
      <CsatForm token={token} customerName={data.customerName} />
    </Center>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-10">{children}</div>;
}

function CsatForm({ token, customerName }: { token: string; customerName: string }) {
  const toast = useToast();
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [already, setAlready] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!rating) {
      setError("Tap a star to rate the service.");
      return;
    }
    setSaving(true);
    try {
      await fetchPublic(`/public/csat/${encodeURIComponent(token)}`, {
        method: "POST",
        json: { rating, comment: comment.trim() || undefined },
      });
      setDone(true);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "CSAT_ALREADY_ANSWERED") {
        setAlready(true);
      } else {
        const message =
          caught instanceof ApiError ? caught.message : "Something went wrong. Try again.";
        setError(message);
        toast.error(message);
      }
    } finally {
      setSaving(false);
    }
  };

  if (done) {
    return (
      <Card>
        <CardBody className="flex flex-col items-center gap-3 py-10 text-center">
          <CheckCircle2 className="size-10 text-ok" aria-hidden />
          <p className="text-lg font-semibold">Thanks for the feedback!</p>
          <p className="max-w-md text-[13px] text-muted">
            It helps the service team do better next time.
          </p>
        </CardBody>
      </Card>
    );
  }

  if (already) {
    return (
      <Card>
        <CardBody className="flex flex-col items-center gap-3 py-10 text-center">
          <CheckCircle2 className="size-10 text-ok" aria-hidden />
          <p className="text-lg font-semibold">Thanks — this feedback was already recorded.</p>
        </CardBody>
      </Card>
    );
  }

  const labels = ["", "Very poor", "Poor", "Okay", "Good", "Excellent"];

  return (
    <Card>
      <CardHeader title="Rate the service" meta={`For ${customerName}`} />
      <CardBody>
        <form onSubmit={submit} noValidate className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <span id="csat-rating-label" className="text-[13px] font-semibold">
              Your rating <span className="text-bad" aria-hidden>*</span>
            </span>
            <div
              role="radiogroup"
              aria-labelledby="csat-rating-label"
              className="flex items-center gap-1"
            >
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={rating === value}
                  aria-label={`${value} star${value === 1 ? "" : "s"} — ${labels[value]}`}
                  onClick={() => {
                    setRating(value);
                    setError(undefined);
                  }}
                  className="cursor-pointer rounded-lg p-1.5 focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <Star
                    className={cn(
                      "size-9 transition-colors",
                      rating !== null && value <= rating
                        ? "fill-warn text-warn"
                        : "text-faint hover:text-warn",
                    )}
                    aria-hidden
                  />
                </button>
              ))}
            </div>
            {rating !== null && (
              <p className="text-[13px] font-semibold text-muted" aria-live="polite">
                {labels[rating]}
              </p>
            )}
            {error && <p className="text-xs font-semibold text-bad">{error}</p>}
          </div>

          <Field
            label="Tell us more (optional)"
            help="What went well, or what we should fix next time."
          >
            {(p) => (
              <Textarea
                {...p}
                rows={4}
                maxLength={2000}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Anything you'd like the service team to know…"
              />
            )}
          </Field>

          <div>
            <Button type="submit" variant="primary" loading={saving} disabled={rating === null}>
              Submit feedback
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

/** Stars + comment as shown on the ticket page once a customer has answered. */
export function Stars({ rating, className }: { rating: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((value) => (
        <Star
          key={value}
          aria-hidden
          className={cn(
            "size-4",
            value <= rating ? "fill-warn text-warn" : "text-faint",
          )}
        />
      ))}
    </span>
  );
}
