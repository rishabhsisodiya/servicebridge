import { AlertTriangle, Clock, FileText, Gauge, Plus, Star, Ticket } from "lucide-react";
import type { Metadata } from "next";
import { BarChart, HBars } from "@/components/charts/bar-chart";
import { StatusPill, Tag } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi";
import { Avatar, PageHeader } from "@/components/ui/misc";
import { NeedsAttention } from "@/features/tickets/needs-attention";
import { MOCK_ENGINEERS } from "@/mocks/engineers";

export const metadata: Metadata = { title: "Home" };

const ENGINEER_TONE = { Available: "ok", "On visit": "prog", "Off duty": "done" } as const;

export default function HomePage() {
  return (
    <>
      <PageHeader
        title="Service overview"
        eyebrow={
          <>
            <span>Thursday, 24 September 2026</span>
            <Tag>All regions</Tag>
            <StatusPill tone="neutral" plain>
              Sample data
            </StatusPill>
          </>
        }
        actions={
          <>
            <ButtonLink href="/reports" icon={<FileText className="size-4" aria-hidden />}>
              Reports
            </ButtonLink>
            <ButtonLink
              href="/tickets/new"
              variant="primary"
              icon={<Plus className="size-4" aria-hidden />}
            >
              Log a ticket
            </ButtonLink>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <KpiCard
          label="Open tickets"
          value="38"
          icon={<Ticket className="size-3.5" aria-hidden />}
          detail={
            <>
              <span className="font-semibold text-bad">▲ 5</span> vs yesterday
            </>
          }
          trend={[31, 33, 32, 36, 34, 33, 38]}
        />
        <KpiCard
          label="SLA at risk"
          value="3"
          alert
          icon={<Clock className="size-3.5" aria-hidden />}
          detail="Due in the next 2 hours"
        />
        <KpiCard
          label="Breached today"
          value="1"
          icon={<AlertTriangle className="size-3.5" aria-hidden />}
          detail="SB-26-000402 · Mandya"
        />
        <KpiCard
          label="Avg. resolution"
          value="6h 50m"
          icon={<Gauge className="size-3.5" aria-hidden />}
          detail={
            <>
              <span className="font-semibold text-ok">▼ 35m</span> 30-day average
            </>
          }
          trend={[8.4, 8.1, 7.9, 7.6, 7.4, 7.1, 6.8]}
        />
        <KpiCard
          label="Customer rating"
          value={
            <>
              4.5<span className="text-sm font-normal text-muted"> / 5</span>
            </>
          }
          icon={<Star className="size-3.5" aria-hidden />}
          detail="94 responses · 30 days"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]">
        <NeedsAttention />

        <Card aria-labelledby="engineers-title">
          <CardHeader titleId="engineers-title" title="Engineers" meta="3 on visit · 2 available" />
          <ul className="m-0 list-none p-0">
            {MOCK_ENGINEERS.map((engineer) => (
              <li
                key={engineer.name}
                className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0"
              >
                <Avatar name={engineer.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{engineer.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {engineer.region} · {engineer.skills}
                  </span>
                </span>
                <StatusPill tone={ENGINEER_TONE[engineer.status]}>{engineer.status}</StatusPill>
                <span className="w-14 text-right text-xs text-muted">{engineer.open} open</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card aria-labelledby="flow-title">
          <CardHeader titleId="flow-title" title="Ticket flow" meta="Last 7 days" />
          <CardBody>
            <BarChart
              title="Tickets logged and closed per day, last 7 days"
              labels={["18", "19", "20", "21", "22", "23", "24"]}
              series={[
                { name: "Logged", values: [11, 9, 14, 8, 12, 15, 10], color: "var(--chart-1)" },
                { name: "Closed", values: [10, 12, 9, 10, 13, 11, 5], color: "var(--chart-2)" },
              ]}
              width={380}
              height={210}
            />
          </CardBody>
        </Card>
        <Card aria-labelledby="stage-title">
          <CardHeader titleId="stage-title" title="Open by stage" />
          <CardBody>
            <HBars
              label="Open tickets by stage"
              rows={[
                { label: "New / triage", value: 7 },
                { label: "Engineer assigned", value: 6 },
                { label: "Accepted", value: 5 },
                { label: "On site / in progress", value: 11 },
                { label: "On hold", value: 5, color: "var(--chart-4)" },
                { label: "Awaiting verification", value: 4, color: "var(--chart-2)" },
              ]}
            />
          </CardBody>
        </Card>
        <Card aria-labelledby="channel-title">
          <CardHeader titleId="channel-title" title="Intake by channel" meta="This week" />
          <CardBody>
            <HBars
              label="Tickets logged this week by channel"
              rows={[
                { label: "Phone", value: 34 },
                { label: "WhatsApp", value: 19 },
                { label: "AMC visit", value: 9 },
                { label: "Email", value: 8 },
                { label: "Portal", value: 5 },
              ]}
            />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
