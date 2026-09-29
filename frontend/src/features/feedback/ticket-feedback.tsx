"use client";

import { Copy, MailCheck, MessageSquareHeart } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { Tag } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { apiFetch } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";
import { Stars } from "./csat";

export interface CsatToken {
  id: string;
  createdAt: string;
  usedAt: string | null;
  emailed: boolean;
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
 * Fetches the raw token-bearing survey link on demand (SB-M7). The link is
 * the only credential on the public page, so the API needs tickets.edit and
 * the URL is never rendered from list responses.
 */
function CopySurveyLinkButton({ ticketId }: { ticketId: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  const copy = async () => {
    setState("idle");
    try {
      const { feedbackUrl } = await apiFetch<{ feedbackUrl: string | null }>(
        `/tickets/${encodeURIComponent(ticketId)}/survey-link`,
      );
      if (!feedbackUrl) {
        setState("failed");
        return;
      }
      await navigator.clipboard.writeText(feedbackUrl);
      setState("copied");
    } catch {
      setState("failed");
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        onClick={copy}
        icon={<Copy className="size-4" aria-hidden />}
        aria-live="polite"
      >
        {state === "copied" ? "Copied" : "Copy survey link"}
      </Button>
      {state === "failed" && <span className="text-xs text-bad">Couldn&apos;t load the link.</span>}
    </div>
  );
}

/**
 * The latest feedback token for a ticket. A rating renders stars + comment;
 * otherwise the card shows the email status and — for staff who may edit
 * tickets — a button that fetches the survey link on demand. Renders nothing
 * when no token exists yet.
 */
export function TicketFeedbackCard({ ticketId }: { ticketId: string }) {
  const { can } = useSession();
  const { data, isLoading } = useSWR<CsatToken[]>(
    `/tickets/${encodeURIComponent(ticketId)}/feedback`,
    (key: string) => apiFetch<CsatToken[]>(key),
  );

  if (isLoading || !data || data.length === 0) return null;
  const latest = data[0];

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
            {can("tickets.edit") ? (
              <CopySurveyLinkButton ticketId={ticketId} />
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
