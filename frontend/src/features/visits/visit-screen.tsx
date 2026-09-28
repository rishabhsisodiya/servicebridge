"use client";

import { AlertTriangle, CheckCircle2, PenLine } from "lucide-react";
import Link from "next/link";
import useSWR from "swr";
import { StatusPill, Tag } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Avatar, PageHeader } from "@/components/ui/misc";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { ApiError, API_BASE } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";
import { formatDate } from "@/features/catalog/shared";
import { getVisit, type VisitDetail } from "./api";
import { VisitForm } from "./visit-form";

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * One field visit: a draft opens the phone-first form, a submitted visit is
 * read-only. The API is the real permission check; the UI only hides buttons.
 */
export function VisitScreen({ visitId, ticketRef }: { visitId: string; ticketRef: string }) {
  const { can } = useSession();
  const {
    data: visit,
    error,
    isLoading,
    mutate,
  } = useSWR<VisitDetail, ApiError>(`/visits/${visitId}`, getVisit);

  if (isLoading) {
    return (
      <>
        <PageHeader title="Field visit" />
        <Skeleton className="h-64" />
      </>
    );
  }
  if (error || !visit) {
    return (
      <ErrorState
        title={error?.status === 404 ? "Visit not found" : "Couldn't load this visit"}
        description={error?.message}
        onRetry={error?.status === 404 ? undefined : () => void mutate()}
      />
    );
  }

  const editable = visit.status === "DRAFT" && can("visits.edit");
  const backHref = `/tickets/${ticketRef}`;

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <Link href={backHref} className="font-mono underline-offset-2 hover:underline">
              {ticketRef}
            </Link>
            <StatusPill tone={visit.status === "DRAFT" ? "prog" : "ok"}>
              {visit.status === "DRAFT" ? "Draft" : "Submitted"}
            </StatusPill>
            {visit.createdBy && (
              <Tag>
                <Avatar name={visit.createdBy.name} size="sm" />
                {visit.createdBy.name}
              </Tag>
            )}
          </>
        }
        title={`Field visit ${visit.visitNumber}`}
        description={`Started ${when(visit.createdAt)}`}
        actions={
          !editable && (
            <Link
              href={backHref}
              className="text-[13px] font-semibold underline-offset-2 hover:underline"
            >
              Back to ticket
            </Link>
          )
        }
      />
      {editable ? (
        <VisitForm
          key={visit.id}
          visit={visit}
          ticketRef={ticketRef}
          onChanged={() => mutate()}
        />
      ) : (
        <VisitReadonly visit={visit} />
      )}
    </>
  );
}

/** A submitted (locked) visit: notes, spares, photos and the sign-off, read-only. */
function VisitReadonly({ visit }: { visit: VisitDetail }) {
  return (
    <div className="flex flex-col gap-4">
      <Card aria-labelledby="ro-notes-title">
        <CardHeader
          titleId="ro-notes-title"
          title="Work notes"
          meta={
            visit.submittedBy
              ? `Submitted by ${visit.submittedBy.name} · ${visit.submittedAt ? when(visit.submittedAt) : ""}`
              : undefined
          }
        />
        <CardBody>
          <p className="whitespace-pre-line [overflow-wrap:anywhere]">
            {visit.workDone ?? <span className="text-muted">No notes recorded.</span>}
          </p>
        </CardBody>
      </Card>

      <Card aria-labelledby="ro-spares-title">
        <CardHeader
          titleId="ro-spares-title"
          title="Spares used"
          meta={visit.spares.length ? `${visit.spares.length}` : undefined}
        />
        <CardBody>
          {visit.spares.length === 0 ? (
            <p className="text-[13px] text-muted">No spares recorded on this visit.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {visit.spares.map((line) => (
                <li
                  key={line.id}
                  className="flex items-center gap-3 rounded-lg border border-line px-3 py-2 text-[13.5px]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{line.item.name}</span>
                    <span className="block text-xs text-muted">
                      {line.item.itemCode}
                      {line.item.uom ? ` · ${line.item.uom}` : ""}
                    </span>
                  </span>
                  <span className="font-semibold tabular-nums">× {line.quantity}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card aria-labelledby="ro-photos-title">
        <CardHeader
          titleId="ro-photos-title"
          title="Photos"
          meta={visit.photos.length ? `${visit.photos.length}` : undefined}
        />
        <CardBody>
          {visit.photos.length === 0 ? (
            <p className="text-[13px] text-muted">No photos on this visit.</p>
          ) : (
            <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3">
              {visit.photos.map((p) => {
                const url = `${API_BASE}/visits/${visit.id}/photos/${p.id}`;
                return (
                  <li key={p.id} className="overflow-hidden rounded-lg border border-line">
                    <a href={url} target="_blank" rel="noreferrer" className="block no-underline">
                      {/* eslint-disable-next-line @next/next/no-img-element -- served by the API with auth cookies */}
                      <img
                        src={url}
                        alt={p.fileName}
                        loading="lazy"
                        className="aspect-[4/3] w-full bg-surface-2 object-cover"
                      />
                      <span className="block truncate px-2.5 py-2 text-xs font-semibold text-text">
                        {p.fileName}
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card aria-labelledby="ro-sign-title">
        <CardHeader titleId="ro-sign-title" title="Customer sign-off" />
        <CardBody>
          {visit.hasSignature ? (
            <div className="flex flex-col gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- served by the API with auth cookies */}
              <img
                src={`${API_BASE}/visits/${visit.id}/signature`}
                alt={`Signature${visit.signatoryName ? ` of ${visit.signatoryName}` : ""}`}
                loading="lazy"
                className="max-h-28 w-auto self-start rounded-lg border border-line bg-white"
              />
              <p className="flex items-center gap-2 text-[13.5px]">
                <CheckCircle2 className="size-4 shrink-0 text-ok" aria-hidden />
                Signed{visit.signatoryName ? ` by ${visit.signatoryName}` : ""}
                <span className="text-muted">({formatDate(visit.updatedAt)})</span>
              </p>
            </div>
          ) : visit.signatureRefused ? (
            <p className="flex items-start gap-2 text-[13.5px]">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
              <span>
                <span className="font-semibold">The customer refused to sign.</span>{" "}
                <span className="text-muted">{visit.refusalReason}</span>
              </span>
            </p>
          ) : (
            <EmptyState
              icon={<PenLine className="size-6" aria-hidden />}
              title="No sign-off recorded"
              description="This visit was submitted without a signature."
            />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
