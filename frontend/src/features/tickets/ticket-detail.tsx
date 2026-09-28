"use client";

import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clock,
  MapPin,
  PauseCircle,
  Phone,
  ShieldCheck,
  Timer,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import useSWR from "swr";
import { Tag } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { Avatar, PageHeader } from "@/components/ui/misc";
import { ErrorState, Skeleton, TableSkeleton } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";
import { formatDate } from "@/features/catalog/shared";
import { TicketFeedbackCard } from "@/features/feedback/ticket-feedback";
import {
  CHANNEL_LABEL,
  COVERAGE_LABEL,
  fetcher,
  type ScheduledTimers,
  type TicketDetail,
  useTicketLabels,
} from "./api";
import { AssignDrawer } from "./assign-drawer";
import {
  type Priority,
  PRIORITY_ORDER,
  PriorityMark,
  StagePill,
  TICKET_FLOW,
  type TicketStage,
} from "./display";
import { formatSpan, formatWhen } from "./format";
import { StageStepper } from "./stage-stepper";
import { TicketActionBar } from "./ticket-action-bar";
import { TicketActivity } from "./ticket-activity";
import { TicketFiles } from "./ticket-files";
import { VisitTimeline } from "@/features/visits/visit-timeline";
import { QuotationTimeline } from "@/features/quotations/quotation-timeline";

function Callout({
  tone,
  icon,
  title,
  children,
}: {
  tone: "warn" | "ok" | "info" | "bad" | "neutral";
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  const styles = {
    warn: "bg-warn-bg text-warn",
    ok: "bg-ok-bg text-ok",
    info: "bg-info-bg text-info",
    bad: "bg-bad-bg text-bad",
    neutral: "bg-surface-2 text-muted",
  }[tone];
  return (
    <div className={`flex items-start gap-2.5 rounded-lg px-3.5 py-3 ${styles}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div>
        <p className="font-semibold">{title}</p>
        <p className="text-[13px] text-text">{children}</p>
      </div>
    </div>
  );
}

function Details({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13.5px]">
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-muted">{term}</dt>
          <dd className="m-0 min-w-0 text-right font-semibold [overflow-wrap:anywhere]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

const time = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/** When each stage was last entered, for the progress bar. */
function stageTimes(ticket: TicketDetail): Partial<Record<TicketStage, string>> {
  const times: Partial<Record<TicketStage, string>> = {};
  const now = new Date();
  for (const e of ticket.events) if (e.toStage) times[e.toStage] = formatWhen(e.createdAt, now);
  return times;
}

/** The main-flow stage to highlight: on hold and cancelled show where the ticket stopped. */
function progressStage(ticket: TicketDetail): TicketStage {
  if (ticket.stage === "ON_HOLD") return ticket.stageBeforeHold ?? "ASSIGNED";
  if (ticket.stage === "CANCELLED") {
    const cancel = [...ticket.events].reverse().find((e) => e.toStage === "CANCELLED");
    return cancel?.fromStage ?? "NEW";
  }
  return (TICKET_FLOW as readonly string[]).includes(ticket.stage) ? ticket.stage : "NEW";
}

function SlaCallouts({ ticket }: { ticket: TicketDetail }) {
  const { dates, targets, breached } = ticket;
  const logged = new Date(ticket.createdAt).getTime();
  const target = (minutes: number) => formatSpan(minutes * 60_000);
  const paused = ticket.stage === "ON_HOLD";
  const cancelled = ticket.stage === "CANCELLED";

  const response = dates.respondedAt ? (
    <Callout
      tone={breached.response ? "bad" : "ok"}
      icon={
        breached.response ? (
          <AlertTriangle className="size-4" aria-hidden />
        ) : (
          <CheckCircle2 className="size-4" aria-hidden />
        )
      }
      title={breached.response ? "Response missed" : "Response met"}
    >
      Accepted after {formatSpan(new Date(dates.respondedAt).getTime() - logged)} (target{" "}
      {target(targets.responseMinutes)})
    </Callout>
  ) : cancelled ? null : (
    <Callout
      tone={
        paused
          ? "neutral"
          : ticket.sla.state === "breach"
            ? "bad"
            : ticket.sla.state === "risk"
              ? "warn"
              : "info"
      }
      icon={
        paused ? (
          <PauseCircle className="size-4" aria-hidden />
        ) : (
          <Clock className="size-4" aria-hidden />
        )
      }
      title={paused ? "Response paused" : `Response due ${time(dates.responseDueAt)}`}
    >
      Target {target(targets.responseMinutes)} · an engineer must accept
    </Callout>
  );

  const resolution = dates.resolvedAt ? (
    <Callout
      tone={breached.resolution ? "bad" : "ok"}
      icon={
        breached.resolution ? (
          <AlertTriangle className="size-4" aria-hidden />
        ) : (
          <CheckCircle2 className="size-4" aria-hidden />
        )
      }
      title={breached.resolution ? "Resolution missed" : "Resolution met"}
    >
      Resolved after {formatSpan(new Date(dates.resolvedAt).getTime() - logged)} (target{" "}
      {target(targets.resolutionMinutes)})
    </Callout>
  ) : cancelled ? null : (
    <Callout
      tone={
        paused
          ? "neutral"
          : dates.respondedAt && ticket.sla.state === "breach"
            ? "bad"
            : dates.respondedAt && ticket.sla.state === "risk"
              ? "warn"
              : "info"
      }
      icon={
        paused ? (
          <PauseCircle className="size-4" aria-hidden />
        ) : (
          <Clock className="size-4" aria-hidden />
        )
      }
      title={paused ? "Resolution paused" : `Resolution due ${time(dates.resolutionDueAt)}`}
    >
      {paused
        ? `On hold since ${time(dates.pausedAt!)}. The clock restarts when work resumes.`
        : `Target ${target(targets.resolutionMinutes)}`}
    </Callout>
  );

  const coverage = (
    <Callout
      tone={ticket.coverage === "CHARGEABLE" ? "warn" : "info"}
      icon={<ShieldCheck className="size-4" aria-hidden />}
      title={
        ticket.coverage === "AMC"
          ? `Covered by AMC${ticket.coverageUntil ? ` until ${formatDate(ticket.coverageUntil)}` : ""}`
          : ticket.coverage === "WARRANTY"
            ? `In warranty${ticket.coverageUntil ? ` until ${formatDate(ticket.coverageUntil)}` : ""}`
            : "Chargeable"
      }
    >
      {ticket.coverage === "CHARGEABLE"
        ? "Not under warranty or AMC. A quotation is recommended before work starts."
        : "Labour included. Spares follow the contract terms."}
    </Callout>
  );

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {response ?? <span className="max-md:hidden" />}
      {resolution ?? <span className="max-md:hidden" />}
      {coverage}
    </div>
  );
}

function ScheduledCard({ ticket }: { ticket: TicketDetail }) {
  const running = !!ticket.sla.dueAt;
  const { data, error } = useSWR<ScheduledTimers>(
    running ? `/tickets/${ticket.id}/scheduled?v=${ticket.version}` : null,
    fetcher,
  );
  if (!running) return null;
  const pending = data?.timers.filter((t) => t.state === "delayed" || t.state === "waiting") ?? [];
  return (
    <Card aria-labelledby="scheduled-title">
      <CardHeader titleId="scheduled-title" title="Scheduled" meta="SLA alerts for this ticket" />
      <CardBody>
        {!data && !error && <Skeleton className="h-10" />}
        {(error || data?.available === false) && (
          <p className="text-[13px] text-muted">Couldn&apos;t read the job queue right now.</p>
        )}
        {data?.available && pending.length === 0 && (
          <p className="text-[13px] text-muted">
            No alerts pending. The due time has passed or the alert already ran.
          </p>
        )}
        {pending.length > 0 && (
          <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[13px]">
            {pending.map((t) => (
              <li key={t.kind} className="flex items-start gap-2">
                <Timer className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
                <span>
                  <span className="font-semibold">
                    {t.kind === "risk" ? "Flag as at risk" : "Record a breach"}
                  </span>{" "}
                  <span className="text-muted">({t.clock})</span>
                  <span className="block text-xs text-muted">{time(t.runAt)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function PrioritySelect({
  ticket,
  onChanged,
}: {
  ticket: TicketDetail;
  onChanged: (t: TicketDetail) => void;
}) {
  const labels = useTicketLabels();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const change = async (priority: Priority) => {
    setSaving(true);
    try {
      onChanged(
        await apiFetch<TicketDetail>(`/tickets/${ticket.id}`, {
          method: "PATCH",
          json: { priority, version: ticket.version },
        }),
      );
      toast.success(`Priority changed to ${labels.priority(priority)}. SLA targets updated.`);
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "Something went wrong. Try again.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Select
      aria-label="Priority"
      value={ticket.priority}
      disabled={saving}
      onChange={(e) => void change(e.target.value as Priority)}
      className="min-h-8 w-auto! py-1 text-right text-[13px]"
    >
      {PRIORITY_ORDER.map((p) => (
        <option key={p} value={p}>
          {labels.priority(p)}
        </option>
      ))}
    </Select>
  );
}

export function TicketDetailScreen({ id }: { id: string }) {
  const { can } = useSession();
  const {
    data: ticket,
    error,
    isLoading,
    mutate,
  } = useSWR<TicketDetail, ApiError>(`/tickets/${id}`, fetcher);
  const [assigning, setAssigning] = useState(false);

  if (isLoading) return <TableSkeleton label="Loading ticket" />;
  if (error || !ticket) {
    return (
      <ErrorState
        title={error?.status === 404 ? "Ticket not found" : "Couldn't load this ticket"}
        description={error?.message}
        onRetry={error?.status === 404 ? undefined : () => void mutate()}
      />
    );
  }

  const onChanged = (next: TicketDetail) => void mutate(next, { revalidate: false });
  const canAssign = ticket.actions.includes("assign");
  // The API needs both: editing the ticket, and the manager action for priority.
  const editablePriority =
    can("tickets.edit") &&
    can("tickets.assign") &&
    !ticket.dates.resolvedAt &&
    !["ON_HOLD", "CLOSED", "CANCELLED"].includes(ticket.stage);

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <span className="font-mono">{ticket.number}</span>
            <StagePill stage={ticket.stage} />
            <PriorityMark priority={ticket.priority} />
            <Tag icon={<ShieldCheck className="size-3" aria-hidden />}>
              {COVERAGE_LABEL[ticket.coverage]}
            </Tag>
            {ticket.isDemo && <Tag className="border-info/40 text-info">Demo</Tag>}
            {ticket.reopenCount > 0 && <Tag>Reopened {ticket.reopenCount}×</Tag>}
          </>
        }
        title={ticket.title}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1">
              <Building2 className="size-3.5" aria-hidden />
              {ticket.customer.name}
            </span>
            {ticket.site && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" aria-hidden />
                {ticket.site.city ?? ticket.site.title}
              </span>
            )}
            <span>
              Logged {formatWhen(ticket.createdAt)} · {CHANNEL_LABEL[ticket.channel]}
            </span>
          </span>
        }
        actions={
          canAssign && (
            <Button
              icon={<Users className="size-4" aria-hidden />}
              onClick={() => setAssigning(true)}
            >
              {ticket.engineer ? "Reassign" : "Assign engineer"}
            </Button>
          )
        }
      />

      <Card>
        <CardBody className="flex flex-col gap-4">
          <StageStepper stage={progressStage(ticket)} times={stageTimes(ticket)} />
          {ticket.stage === "ON_HOLD" && (
            <Callout
              tone="warn"
              icon={<PauseCircle className="size-4" aria-hidden />}
              title="On hold"
            >
              {ticket.holdReason ?? "No reason given."}
            </Callout>
          )}
          {ticket.stage === "CANCELLED" && (
            <Callout
              tone="neutral"
              icon={<AlertTriangle className="size-4" aria-hidden />}
              title="Cancelled"
            >
              {[...ticket.events].reverse().find((e) => e.toStage === "CANCELLED")?.note ??
                "No reason given."}
            </Callout>
          )}
          <SlaCallouts ticket={ticket} />
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card aria-labelledby="problem-title">
            <CardHeader
              titleId="problem-title"
              title="Problem reported"
              meta={ticket.serviceType.name}
            />
            <CardBody className="flex flex-col gap-3">
              <p className="whitespace-pre-line [overflow-wrap:anywhere]">
                {ticket.description ?? (
                  <span className="text-muted">No further details were given.</span>
                )}
              </p>
              {ticket.contact && (
                <div className="flex flex-wrap gap-2">
                  <Tag icon={<Phone className="size-3" aria-hidden />}>
                    {ticket.contact.fullName}
                    {ticket.contact.mobile || ticket.contact.phone
                      ? ` · ${ticket.contact.mobile ?? ticket.contact.phone}`
                      : ""}
                  </Tag>
                </div>
              )}
            </CardBody>
          </Card>
          <TicketFiles ticket={ticket} onUploaded={() => mutate()} />
          <VisitTimeline ticket={ticket} />
          <QuotationTimeline ticket={ticket} />
          <TicketActivity ticket={ticket} onChanged={onChanged} />
        </div>

        <aside className="flex flex-col gap-4" aria-label="Ticket details">
          <Card aria-labelledby="engineer-title">
            <CardHeader
              titleId="engineer-title"
              title="Engineer"
              actions={
                canAssign && (
                  <Button size="sm" variant="ghost" onClick={() => setAssigning(true)}>
                    {ticket.engineer ? "Change" : "Assign"}
                  </Button>
                )
              }
            />
            <CardBody className="flex items-center gap-3">
              {ticket.engineer ? (
                <>
                  <Avatar name={ticket.engineer.name} size="lg" />
                  <span className="flex-1">
                    <span className="block font-semibold">{ticket.engineer.name}</span>
                    <span className="block text-xs text-muted">
                      {ticket.areaManager
                        ? `Area manager: ${ticket.areaManager.name}`
                        : "No area manager"}
                    </span>
                  </span>
                </>
              ) : (
                <span className="text-muted">
                  No engineer assigned yet.
                  {ticket.areaManager &&
                    ` ${ticket.areaManager.name} (area manager) has been notified.`}
                </span>
              )}
            </CardBody>
          </Card>

          <Card aria-labelledby="machine-title">
            <CardHeader titleId="machine-title" title="Machine" />
            <CardBody>
              {ticket.equipment ? (
                <Details
                  rows={[
                    ["Model", ticket.equipment.itemName ?? ticket.equipment.itemCode ?? "—"],
                    [
                      "Serial no.",
                      <Link
                        key="s"
                        href={`/equipment?search=${encodeURIComponent(ticket.equipment.serialNo)}`}
                        className="font-mono text-text underline-offset-2 hover:underline"
                      >
                        {ticket.equipment.serialNo}
                      </Link>,
                    ],
                    ["Warranty until", formatDate(ticket.equipment.warrantyExpiresOn)],
                    ["AMC until", formatDate(ticket.equipment.amcExpiresOn)],
                    ["Other open tickets", String(ticket.openForMachine)],
                  ]}
                />
              ) : (
                <p className="text-[13px] text-muted">No machine on this ticket.</p>
              )}
            </CardBody>
          </Card>

          <Card aria-labelledby="customer-title">
            <CardHeader
              titleId="customer-title"
              title="Customer"
              actions={
                <Link
                  href={`/customers/${ticket.customer.id}`}
                  className="text-[13px] font-semibold text-text underline-offset-2 hover:underline"
                >
                  Open
                </Link>
              }
            />
            <CardBody>
              <Details
                rows={[
                  ["Name", ticket.customer.name],
                  [
                    "Site",
                    ticket.site
                      ? [ticket.site.title, ticket.site.city, ticket.site.pincode]
                          .filter(Boolean)
                          .join(" · ")
                      : "—",
                  ],
                  ["Phone", ticket.customer.mobile ?? "—"],
                  ["Open tickets", String(ticket.openForCustomer)],
                ]}
              />
            </CardBody>
          </Card>

          <Card aria-labelledby="details-title">
            <CardHeader titleId="details-title" title="Details" />
            <CardBody>
              <Details
                rows={[
                  [
                    "Priority",
                    editablePriority ? (
                      <PrioritySelect key="p" ticket={ticket} onChanged={onChanged} />
                    ) : (
                      <PriorityMark key="p" priority={ticket.priority} />
                    ),
                  ],
                  ["Service type", ticket.serviceType.name],
                  ["Came in by", CHANNEL_LABEL[ticket.channel]],
                  ["Region", ticket.region?.name ?? "Not matched"],
                  ["Logged by", ticket.createdBy?.name ?? "—"],
                  ...(ticket.duplicateOf
                    ? ([
                        [
                          "Duplicate of",
                          <Link
                            key="d"
                            href={`/tickets/${ticket.duplicateOf.number}`}
                            className="font-mono"
                          >
                            {ticket.duplicateOf.number}
                          </Link>,
                        ],
                      ] as [string, ReactNode][])
                    : []),
                ]}
              />
            </CardBody>
          </Card>

          <ScheduledCard ticket={ticket} />
          <TicketFeedbackCard ticketId={ticket.id} />
        </aside>
      </div>

      <TicketActionBar ticket={ticket} onChanged={onChanged} />
      {canAssign && (
        <AssignDrawer
          ticket={ticket}
          open={assigning}
          onClose={() => setAssigning(false)}
          onChanged={onChanged}
        />
      )}
    </>
  );
}
