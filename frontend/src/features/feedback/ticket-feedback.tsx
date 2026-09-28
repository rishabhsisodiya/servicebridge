"use client";

import { Copy, MailCheck, MessageSquareHeart } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { Tag } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { apiFetch } from "@/lib/api/client";
import { Stars } from "./csat";

export interface CsatToken {
  id: string;
  createdAt: string;
  usedAt: string | null;
  emailed: boolean;
  feedbackUrl: string | null;
  rating: number | null;
  comment: string | null;
  answeredAt: string | null;
}

const answeredOn = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString(undefined, {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : null;

/**
 * The latest feedback token for a ticket. A rating renders stars + comment;
 * otherwise the link is shown with a Copy button (when there is one) and an
 * "emailed" badge. Renders nothing when no token exists yet.
 */
export function TicketFeedbackCard({ ticketId }: { ticketId: string }) {
  const { data, isLoading } = useSWR<CsatToken[]>(
    `/tickets/${encodeURIComponent(ticketId)}/feedback`,
    (key: string) => apiFetch<CsatToken[]>(key),
  );
  const [copied, setCopied] = useState(false);

  if (isLoading || !data || data.length === 0) return null;
  const latest = data[0];

  const copy = async () => {
    if (!latest.feedbackUrl) return;
    try {
      await navigator.clipboard.writeText(latest.feedbackUrl);
      setCopied(true);
    } catch {
      /* the read-only input below stays selectable */
    }
  };

  return (
    <Card aria-labelledby="feedback-title">
      <CardHeader titleId="feedback-title" title="Customer feedback" />
      <CardBody className="flex flex-col gap-2.5">
        {latest.rating !== null ? (
          <>
            <Stars rating={latest.rating} />
            {latest.comment && <p className="text-[13px] whitespace-pre-wrap">{latest.comment}</p>}
            {answeredOn(latest.answeredAt) && (
              <p className="text-xs text-muted">Answered {answeredOn(latest.answeredAt)}</p>
            )}
          </>
        ) : (
          <>
            {latest.emailed && (
              <span className="flex items-center gap-1.5">
                <Tag icon={<MailCheck className="size-3" aria-hidden />}>Emailed</Tag>
              </span>
            )}
            {latest.feedbackUrl ? (
              <Field label="Feedback link">
                {(props) => (
                  <div className="flex gap-2">
                    <Input
                      {...props}
                      readOnly
                      value={latest.feedbackUrl ?? ""}
                      className="font-mono text-xs"
                      onFocus={(e) => e.target.select()}
                    />
                    <Button
                      size="sm"
                      onClick={copy}
                      icon={<Copy className="size-4" aria-hidden />}
                      aria-live="polite"
                    >
                      {copied ? "Copied" : "Copy"}
                    </Button>
                  </div>
                )}
              </Field>
            ) : (
              <p className="flex items-start gap-2 text-[13px] text-muted">
                <MessageSquareHeart className="mt-0.5 size-4 shrink-0" aria-hidden />
                Waiting for the customer&apos;s answer.
              </p>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}
