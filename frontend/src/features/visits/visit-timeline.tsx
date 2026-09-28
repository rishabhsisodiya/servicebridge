"use client";

import { AlertTriangle, CheckCircle2, Pencil, Plus, Trash2, Wrench } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import { StatusPill, Tag } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";
import type { TicketDetail } from "@/features/tickets/api";
import { createVisit, deleteVisit, listVisits, VISIT_STAGES, type VisitSummary } from "./api";

const when = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * Field visits on the ticket. Drafts can be edited or deleted; submitted
 * visits are locked and open read-only. Starting a visit needs visits.create
 * and a ticket that is on site or in progress — the API enforces both.
 */
export function VisitTimeline({ ticket }: { ticket: TicketDetail }) {
  const { can } = useSession();
  const toast = useToast();
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [deleting, setDeleting] = useState<VisitSummary | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const readable = can("visits.read");
  const {
    data: visits,
    error,
    isLoading,
    mutate,
  } = useSWR<VisitSummary[], ApiError>(
    readable ? `/visits/ticket/${ticket.id}` : null,
    () => listVisits(ticket.id),
  );

  if (!readable) return null;

  const stageAllows = (VISIT_STAGES as readonly string[]).includes(ticket.stage);
  const canStart = can("visits.create") && stageAllows && !isLoading;

  const start = async () => {
    setStarting(true);
    try {
      const visit = await createVisit(ticket.id);
      // The form page resolves the ticket from the visit; keep the number for the back link.
      router.push(`/tickets/${ticket.number}/visits/${visit.id}`);
    } catch (caught) {
      toast.error(
        caught instanceof ApiError ? caught.message : "Couldn't start the visit. Try again.",
      );
      setStarting(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await deleteVisit(deleting.id);
      setDeleting(null);
      await mutate();
      toast.success(`Draft visit ${deleting.visitNumber} deleted.`);
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "Something went wrong. Try again.");
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <>
      <Card aria-labelledby="visits-title">
        <CardHeader
          titleId="visits-title"
          title="Field visits"
          meta={visits?.length ? `${visits.length}` : undefined}
          actions={
            canStart && (
              <Button
                size="sm"
                icon={<Plus className="size-4" aria-hidden />}
                loading={starting}
                onClick={() => void start()}
              >
                Start visit
              </Button>
            )
          }
        />
        <CardBody>
          {isLoading && <p className="text-[13px] text-muted">Loading visits…</p>}
          {error && (
            <ErrorState
              title="Couldn't load visits"
              description={error.message}
              onRetry={() => void mutate()}
            />
          )}
          {!isLoading && !error && visits && visits.length === 0 && (
            <EmptyState
              icon={<Wrench className="size-6" aria-hidden />}
              title="No visits yet"
              description={
                stageAllows
                  ? "Log what happens on site: notes, spares, photos and the customer's signature."
                  : "Visits can be logged while the ticket is on site or in progress."
              }
            />
          )}
          {visits && visits.length > 0 && (
            <ol className="m-0 flex list-none flex-col gap-2 p-0">
              {visits.map((visit) => (
                <li
                  key={visit.id}
                  className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2">
                    <Wrench className="size-4 text-muted" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[13.5px] font-semibold">Visit {visit.visitNumber}</span>
                      <StatusPill tone={visit.status === "DRAFT" ? "prog" : "ok"}>
                        {visit.status === "DRAFT" ? "Draft" : "Submitted"}
                      </StatusPill>
                      {visit.hasSignature ? (
                        <Tag icon={<CheckCircle2 className="size-3 text-ok" aria-hidden />}>
                          Signed
                        </Tag>
                      ) : visit.signatureRefused ? (
                        <Tag icon={<AlertTriangle className="size-3 text-warn" aria-hidden />}>
                          Refused
                        </Tag>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted">
                      {when(visit.createdAt)}
                      {visit._count.spares > 0 &&
                        ` · ${visit._count.spares} ${visit._count.spares === 1 ? "spare" : "spares"}`}
                      {visit._count.photos > 0 &&
                        ` · ${visit._count.photos} ${visit._count.photos === 1 ? "photo" : "photos"}`}
                      {visit.status === "SUBMITTED" &&
                        visit.submittedBy &&
                        ` · by ${visit.submittedBy.name}`}
                    </span>
                  </span>
                  {visit.status === "DRAFT" ? (
                    <span className="flex shrink-0 items-center gap-1">
                      {can("visits.edit") && (
                        <Link
                          href={`/tickets/${ticket.number}/visits/${visit.id}`}
                          aria-label={`Edit draft visit ${visit.visitNumber}`}
                          className="grid size-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-text"
                        >
                          <Pencil className="size-4" aria-hidden />
                        </Link>
                      )}
                      {can("visits.delete") && (
                        <IconButton
                          label={`Delete draft visit ${visit.visitNumber}`}
                          size="sm"
                          onClick={() => setDeleting(visit)}
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </IconButton>
                      )}
                    </span>
                  ) : (
                    <Link
                      href={`/tickets/${ticket.number}/visits/${visit.id}`}
                      className="shrink-0 text-[13px] font-semibold underline-offset-2 hover:underline"
                    >
                      View
                    </Link>
                  )}
                </li>
              ))}
            </ol>
          )}
          {!canStart && can("visits.create") && !stageAllows && visits && visits.length > 0 && (
            <p className="mt-3 text-xs text-muted">
              New visits can be started while the ticket is on site or in progress.
            </p>
          )}
        </CardBody>
      </Card>

      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={deleting ? `Delete draft visit ${deleting.visitNumber}?` : ""}
        description="The notes, spares, photos and signature on this draft are removed. This can't be undone."
        footer={
          <>
            <Button onClick={() => setDeleting(null)}>Keep it</Button>
            <Button variant="danger" loading={deleteBusy} onClick={() => void confirmDelete()}>
              Delete draft
            </Button>
          </>
        }
      />
    </>
  );
}
