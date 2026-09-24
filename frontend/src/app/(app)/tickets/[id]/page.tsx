import {
  Building2,
  CheckCircle2,
  Clock,
  FileText,
  MapPin,
  Phone,
  ShieldCheck,
  Users,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { StatusPill, Tag } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Avatar, PageHeader } from "@/components/ui/misc";
import { PriorityMark, StagePill } from "@/features/tickets/display";
import { StageStepper } from "@/features/tickets/stage-stepper";
import { AddNoteForm, TicketActionBar } from "@/features/tickets/ticket-actions";
import { findMockTicket, MOCK_TICKETS } from "@/mocks/tickets";

export function generateStaticParams() {
  return MOCK_TICKETS.map((ticket) => ({ id: ticket.number }));
}

export const dynamicParams = false;

export async function generateMetadata(props: PageProps<"/tickets/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  return { title: id };
}

const TIMELINE = [
  {
    time: "11:20",
    who: "Farhan Qureshi",
    what: "added a note",
    note: "Mantle liner worn to 11 mm (limit 15 mm). Replacing from van stock. Also found loose guard bolts, tightened.",
    accent: true,
  },
  { time: "09:05", who: "Farhan Qureshi", what: "started work" },
  {
    time: "08:58",
    who: "Farhan Qureshi",
    what: "reached site",
    detail: "location matches the Nelamangala plant",
  },
  { time: "08:31", who: "Farhan Qureshi", what: "accepted the ticket" },
  {
    time: "08:22",
    who: "Meera Iyer",
    what: "assigned Farhan Qureshi",
    detail: "skill match: cone crusher · 14 km away",
  },
  {
    time: "08:16",
    who: "ServiceBridge",
    what: "routed the ticket to the Bengaluru Rural area manager",
  },
  { time: "08:15", who: "Ravi Prakash", what: "logged the ticket from a phone call" },
];

function Callout({
  tone,
  icon,
  title,
  children,
}: {
  tone: "warn" | "ok" | "info";
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  const styles = {
    warn: "bg-warn-bg text-warn",
    ok: "bg-ok-bg text-ok",
    info: "bg-info-bg text-info",
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

export default async function TicketDetailPage(props: PageProps<"/tickets/[id]">) {
  const { id } = await props.params;
  const ticket = findMockTicket(id);
  if (!ticket) notFound();

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <span className="font-mono">{ticket.number}</span>
            <StagePill stage={ticket.stage} />
            <PriorityMark priority={ticket.priority} />
            <Tag icon={<ShieldCheck className="size-3" aria-hidden />}>{ticket.coverage}</Tag>
          </>
        }
        title={ticket.issue}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1">
              <Building2 className="size-3.5" aria-hidden />
              {ticket.customer}
            </span>
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3.5" aria-hidden />
              {ticket.site}
            </span>
            <span>
              Logged {ticket.logged} · {ticket.channel}
            </span>
          </span>
        }
        actions={
          <Button
            icon={<Users className="size-4" aria-hidden />}
            disabled
            title="Reassigning arrives in session 8"
          >
            Reassign
          </Button>
        }
      />

      <Card>
        <CardBody className="flex flex-col gap-4">
          <StageStepper
            stage={ticket.stage}
            times={{
              NEW: "08:15",
              TRIAGED: "08:16",
              ASSIGNED: "08:22",
              ACCEPTED: "08:31",
              ON_SITE: "08:58",
              IN_PROGRESS: "09:05",
            }}
          />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Callout
              tone="warn"
              icon={<Clock className="size-4" aria-hidden />}
              title="Resolution due 13:20"
            >
              {ticket.sla.text} · policy “AMC · High · 12 h”
            </Callout>
            <Callout
              tone="ok"
              icon={<CheckCircle2 className="size-4" aria-hidden />}
              title="Response met"
            >
              Accepted in 16 minutes (target 2 hours)
            </Callout>
            <Callout
              tone="info"
              icon={<ShieldCheck className="size-4" aria-hidden />}
              title="Covered by AMC-26-0031"
            >
              Labour included · spares billed at the AMC price list
            </Callout>
          </div>
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card aria-labelledby="problem-title">
            <CardHeader titleId="problem-title" title="Problem reported" />
            <CardBody className="flex flex-col gap-3">
              <p>
                Heavy vibration on the cone crusher since the morning shift. Product size has
                drifted from 20 mm to 28–30 mm. The operator stopped the plant twice to check the
                mantle nut. No alarms on the lube panel.
              </p>
              <div className="flex flex-wrap gap-2">
                <Tag icon={<FileText className="size-3" aria-hidden />}>
                  3 photos from the caller
                </Tag>
                <Tag icon={<Phone className="size-3" aria-hidden />}>
                  Sanjay Gowda · site supervisor
                </Tag>
              </div>
            </CardBody>
          </Card>

          <Card aria-labelledby="activity-title">
            <CardHeader titleId="activity-title" title="Activity" />
            <CardBody className="flex flex-col gap-4">
              <ol className="m-0 list-none p-0">
                {TIMELINE.map((event, index) => (
                  <li
                    key={`${event.time}-${index}`}
                    className="relative grid grid-cols-[48px_18px_1fr] gap-2.5 pb-4 last:pb-0"
                  >
                    {index < TIMELINE.length - 1 && (
                      <span
                        aria-hidden
                        className="absolute top-5 bottom-0 left-[65px] w-0.5 bg-line"
                      />
                    )}
                    <time className="pt-px text-right text-xs text-muted">{event.time}</time>
                    <span
                      aria-hidden
                      className={`z-[1] mt-0.5 size-[18px] rounded-full border-2 ${event.accent ? "border-accent bg-accent-soft" : "border-line-strong bg-surface-2"}`}
                    />
                    <div className="text-[13.5px]">
                      <span className="font-semibold">{event.who}</span> {event.what}
                      {event.detail && <span className="text-muted"> · {event.detail}</span>}
                      {event.note && (
                        <p className="mt-1.5 rounded-lg bg-surface-2 px-3 py-2.5 text-[13px]">
                          {event.note}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
              <AddNoteForm />
            </CardBody>
          </Card>
        </div>

        <aside className="flex flex-col gap-4" aria-label="Ticket details">
          <Card aria-labelledby="engineer-title">
            <CardHeader titleId="engineer-title" title="Engineer" />
            <CardBody className="flex items-center gap-3">
              {ticket.engineer ? (
                <>
                  <Avatar name={ticket.engineer} size="lg" />
                  <span className="flex-1">
                    <span className="block font-semibold">{ticket.engineer}</span>
                    <span className="block text-xs text-muted">
                      Bengaluru Rural · 3 open tickets
                    </span>
                  </span>
                  <StatusPill tone="prog">On visit</StatusPill>
                </>
              ) : (
                <span className="text-muted">No engineer assigned yet.</span>
              )}
            </CardBody>
          </Card>
          <Card aria-labelledby="machine-title">
            <CardHeader titleId="machine-title" title="Machine" />
            <CardBody>
              <Details
                rows={[
                  ["Model", ticket.machine],
                  [
                    "Serial no.",
                    <span key="s" className="font-mono">
                      {ticket.serial}
                    </span>,
                  ],
                  ["Commissioned", "12 Nov 2023"],
                  ["Coverage", "AMC until 31 Mar 2027"],
                  ["AMC visits used", "3 of 4"],
                  ["Last service", "04 Jul 2026"],
                ]}
              />
            </CardBody>
          </Card>
          <Card aria-labelledby="customer-title">
            <CardHeader
              titleId="customer-title"
              title="Customer"
              actions={
                <Link
                  href="/customers"
                  className="text-[13px] font-semibold text-text underline-offset-2 hover:underline"
                >
                  Open
                </Link>
              }
            />
            <CardBody>
              <Details
                rows={[
                  ["Name", ticket.customer],
                  ["Site", ticket.site],
                  ["Contact", "Sanjay Gowda"],
                  ["Open tickets", "1"],
                  ["Rating", "4.6 / 5"],
                ]}
              />
            </CardBody>
          </Card>
        </aside>
      </div>

      <TicketActionBar dueText="Resolution due 13:20" />
    </>
  );
}
