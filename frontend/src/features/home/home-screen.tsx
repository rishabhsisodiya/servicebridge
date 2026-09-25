"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  Gauge,
  Inbox,
  Plus,
  Ticket,
  UserRoundX,
} from "lucide-react";
import useSWR from "swr";
import { BarChart, HBars } from "@/components/charts/bar-chart";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi";
import { PageHeader } from "@/components/ui/misc";
import { EmptyState, ErrorState, Skeleton, TableSkeleton } from "@/components/ui/states";
import { useSession } from "@/lib/auth/session";
import {
  AvailabilityPill,
  type DutyStatus,
  EngineersCard,
  MyDutyControl,
} from "@/features/engineers/engineers";
import {
  CHANNEL_LABEL,
  type Channel,
  fetcher,
  type TicketPage,
  useTicketLabels,
} from "@/features/tickets/api";
import type { TicketStage } from "@/features/tickets/display";
import { formatSpan } from "@/features/tickets/format";
import { NeedsAttention } from "@/features/tickets/needs-attention";
import { TicketTable } from "@/features/tickets/ticket-table";

interface Summary {
  counts: {
    open: number;
    atRisk: number;
    breached: number;
    unassigned: number;
    awaitingVerification: number;
    onHold: number;
    mine: number;
    loggedToday: number;
    closedToday: number;
  };
  byStage: { stage: TicketStage; count: number }[];
  channels: { channel: Channel; count: number }[];
  flow: { day: string; logged: number; closed: number }[];
  last30: { resolved: number; avgResolutionMinutes: number | null; slaMetPercent: number | null };
}

const SUMMARY_KEY = "/tickets/summary";
const icon = (Icon: typeof Ticket) => <Icon className="size-3.5" aria-hidden />;

function useSummary() {
  return useSWR<Summary>(SUMMARY_KEY, fetcher, { refreshInterval: 120_000 });
}

function today() {
  return new Date().toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function greeting(name: string) {
  const hour = new Date().getHours();
  const part = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  return `${part}, ${name.split(" ")[0]}`;
}

/**
 * One home page per kind of work, chosen by permission (not role name), so it
 * keeps working when admins create their own roles:
 * assign → manager · work → engineer · create → service desk · view → overview.
 */
export function HomeScreen() {
  const { me, can } = useSession();
  if (!me) return <TableSkeleton label="Loading your home page" />;
  if (can("tickets.assign")) return <ManagerHome />;
  if (can("tickets.work")) return <EngineerHome name={me.user.name} />;
  if (can("tickets.create")) return <DeskHome name={me.user.name} />;
  if (can("tickets.view")) return <OverviewHome />;
  return (
    <>
      <PageHeader title={greeting(me.user.name)} eyebrow={<span>{today()}</span>} />
      <Card>
        <EmptyState
          icon={<Inbox className="size-6" />}
          title="Nothing to show here yet"
          description="Your role doesn't include tickets. Use the menu to open what you have access to."
        />
      </Card>
    </>
  );
}

function LogTicketButton() {
  const { can } = useSession();
  if (!can("tickets.create")) return null;
  return (
    <ButtonLink
      href="/tickets/new"
      variant="primary"
      icon={<Plus className="size-4" aria-hidden />}
    >
      Log a ticket
    </ButtonLink>
  );
}

function KpiRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">{children}</div>;
}

function KpiSkeleton({ count = 5 }: { count?: number }) {
  return (
    <KpiRow>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-24" />
      ))}
    </KpiRow>
  );
}

function ServiceKpis({ summary }: { summary: Summary }) {
  const { counts, last30 } = summary;
  return (
    <KpiRow>
      <KpiCard
        label="Open tickets"
        value={counts.open}
        icon={icon(Ticket)}
        detail={`${counts.loggedToday} logged today`}
      />
      <KpiCard
        label="SLA at risk"
        value={counts.atRisk}
        alert={counts.atRisk > 0}
        icon={icon(Clock)}
        detail={`${counts.breached} already past due`}
      />
      <KpiCard
        label="Unassigned"
        value={counts.unassigned}
        icon={icon(UserRoundX)}
        detail={`${counts.onHold} on hold`}
      />
      <KpiCard
        label="Avg. resolution"
        value={
          last30.avgResolutionMinutes === null
            ? "—"
            : formatSpan(last30.avgResolutionMinutes * 60_000)
        }
        icon={icon(Gauge)}
        detail={`${last30.resolved} resolved · 30 days`}
      />
      <KpiCard
        label="SLA met"
        value={last30.slaMetPercent === null ? "—" : `${last30.slaMetPercent}%`}
        icon={icon(CheckCircle2)}
        detail="Resolution target · 30 days"
      />
    </KpiRow>
  );
}

function Charts({ summary }: { summary: Summary }) {
  const labels = useTicketLabels();
  const dayLabel = (day: string) =>
    new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { day: "numeric" });
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card aria-labelledby="flow-title">
        <CardHeader titleId="flow-title" title="Ticket flow" meta="Last 7 days" />
        <CardBody>
          <BarChart
            title="Tickets logged and closed per day, last 7 days"
            labels={summary.flow.map((f) => dayLabel(f.day))}
            series={[
              {
                name: "Logged",
                values: summary.flow.map((f) => f.logged),
                color: "var(--chart-1)",
              },
              {
                name: "Closed",
                values: summary.flow.map((f) => f.closed),
                color: "var(--chart-2)",
              },
            ]}
            width={380}
            height={210}
          />
        </CardBody>
      </Card>
      <Card aria-labelledby="stage-title">
        <CardHeader titleId="stage-title" title="Open by stage" />
        <CardBody>
          {summary.byStage.length ? (
            <HBars
              label="Open tickets by stage"
              rows={summary.byStage.map((s) => ({
                label: labels.stage(s.stage),
                value: s.count,
                color: s.stage === "ON_HOLD" ? "var(--chart-4)" : undefined,
              }))}
            />
          ) : (
            <p className="text-[13px] text-muted">No open tickets.</p>
          )}
        </CardBody>
      </Card>
      <Card aria-labelledby="channel-title">
        <CardHeader titleId="channel-title" title="Intake by channel" meta="Last 7 days" />
        <CardBody>
          {summary.channels.length ? (
            <HBars
              label="Tickets logged in the last 7 days by channel"
              rows={summary.channels
                .slice()
                .sort((a, b) => b.count - a.count)
                .map((c) => ({ label: CHANNEL_LABEL[c.channel], value: c.count }))}
            />
          ) : (
            <p className="text-[13px] text-muted">Nothing logged in the last 7 days.</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function TicketListCard({
  id,
  title,
  query,
  empty,
  viewAll,
}: {
  id: string;
  title: string;
  query: string;
  empty: string;
  viewAll: string;
}) {
  const { data, error, mutate } = useSWR<TicketPage>(`/tickets?${query}`, fetcher);
  return (
    <Card aria-labelledby={id}>
      <CardHeader
        titleId={id}
        title={title}
        meta={data ? `${data.meta.total}` : undefined}
        actions={
          <ButtonLink href={viewAll} variant="ghost" size="sm">
            View all
          </ButtonLink>
        }
      />
      {!data && !error && <TableSkeleton rows={4} label={`Loading ${title.toLowerCase()}`} />}
      {error && !data && <ErrorState title="Couldn't load tickets" onRetry={() => void mutate()} />}
      {data?.data.length === 0 && (
        <p className="px-4 py-6 text-center text-[13px] text-muted">{empty}</p>
      )}
      {data && data.data.length > 0 && <TicketTable tickets={data.data} caption={title} compact />}
    </Card>
  );
}

function ManagerHome() {
  const { data, error, mutate } = useSummary();
  return (
    <>
      <PageHeader
        title="Service overview"
        eyebrow={<span>{today()}</span>}
        actions={
          <>
            <ButtonLink href="/reports" icon={<FileText className="size-4" aria-hidden />}>
              Reports
            </ButtonLink>
            <LogTicketButton />
          </>
        }
      />
      {error && !data && (
        <ErrorState title="Couldn't load the overview" onRetry={() => void mutate()} />
      )}
      {!data && !error && <KpiSkeleton />}
      {data && <ServiceKpis summary={data} />}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <NeedsAttention />
          <TicketListCard
            id="unassigned-title"
            title="Waiting for an engineer"
            query="quick=unassigned&sort=due&pageSize=6"
            empty="Every open ticket has an engineer."
            viewAll="/tickets?quick=unassigned"
          />
        </div>
        <EngineersCard />
      </div>
      {data && <Charts summary={data} />}
    </>
  );
}

interface MyAvailability {
  dutyStatus: DutyStatus;
  openTickets: number;
  onVisit: boolean;
}

function EngineerHome({ name }: { name: string }) {
  const availability = useSWR<MyAvailability>("/engineers/me", fetcher);
  const { data: summary } = useSummary();
  return (
    <>
      <PageHeader title={greeting(name)} eyebrow={<span>{today()}</span>} />
      <Card aria-labelledby="duty-title">
        <CardHeader
          titleId="duty-title"
          title="My availability"
          meta="Managers see this when choosing an engineer"
          actions={
            availability.data && (
              <AvailabilityPill
                duty={availability.data.dutyStatus}
                onVisit={availability.data.onVisit}
              />
            )
          }
        />
        <CardBody>
          {availability.error && (
            <ErrorState
              title="Couldn't load your availability"
              onRetry={() => void availability.mutate()}
            />
          )}
          {!availability.data && !availability.error && <Skeleton className="h-10 w-72" />}
          {availability.data && (
            <MyDutyControl
              value={availability.data.dutyStatus}
              onChanged={() => void availability.mutate()}
            />
          )}
        </CardBody>
      </Card>
      {summary && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard label="My open tickets" value={summary.counts.mine} icon={icon(Ticket)} />
          <KpiCard
            label="SLA at risk"
            value={summary.counts.atRisk}
            alert={summary.counts.atRisk > 0}
            icon={icon(Clock)}
            detail={`${summary.counts.breached} past due`}
          />
          <KpiCard label="On hold" value={summary.counts.onHold} icon={icon(AlertTriangle)} />
          <KpiCard
            label="Waiting for verification"
            value={summary.counts.awaitingVerification}
            icon={icon(CheckCircle2)}
          />
        </div>
      )}
      <TicketListCard
        id="my-tickets-title"
        title="My tickets"
        query="quick=mine&sort=due&pageSize=10"
        empty="No tickets assigned to you right now."
        viewAll="/my-tickets"
      />
    </>
  );
}

function DeskHome({ name }: { name: string }) {
  const { data } = useSummary();
  return (
    <>
      <PageHeader
        title={greeting(name)}
        eyebrow={<span>{today()}</span>}
        actions={<LogTicketButton />}
      />
      {data && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard label="Logged today" value={data.counts.loggedToday} icon={icon(Plus)} />
          <KpiCard label="Open tickets" value={data.counts.open} icon={icon(Ticket)} />
          <KpiCard label="Unassigned" value={data.counts.unassigned} icon={icon(UserRoundX)} />
          <KpiCard
            label="SLA at risk"
            value={data.counts.atRisk}
            alert={data.counts.atRisk > 0}
            icon={icon(Clock)}
          />
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <TicketListCard
          id="recent-title"
          title="Recently logged"
          query="quick=all&sort=newest&pageSize=8"
          empty="No tickets yet."
          viewAll="/tickets?quick=all"
        />
        <NeedsAttention />
      </div>
    </>
  );
}

function OverviewHome() {
  const { data, error, mutate } = useSummary();
  return (
    <>
      <PageHeader title="Service overview" eyebrow={<span>{today()}</span>} />
      {error && !data && (
        <ErrorState title="Couldn't load the overview" onRetry={() => void mutate()} />
      )}
      {!data && !error && <KpiSkeleton />}
      {data && (
        <>
          <ServiceKpis summary={data} />
          <Charts summary={data} />
        </>
      )}
      <NeedsAttention />
    </>
  );
}
