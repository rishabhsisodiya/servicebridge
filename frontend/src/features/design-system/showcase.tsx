"use client";

import { Plus, RefreshCw, TicketX, Trash2 } from "lucide-react";
import { useState } from "react";
import { StatusPill, Tag, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog, Drawer } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { FilterChip } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/segmented";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/states";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import {
  PriorityMark,
  SlaMark,
  STAGE_DISPLAY,
  StagePill,
  type TicketStage,
} from "@/features/tickets/display";
import type { SlaStatus } from "@/features/tickets/api";

/** Fixed time so the SLA examples read the same on every visit. */
const SAMPLE_NOW = new Date("2026-01-01T12:00:00Z");
const sample = (state: SlaStatus["state"], minutesLeft: number): SlaStatus => ({
  clock: "resolution",
  state,
  dueAt:
    state === "paused" ? null : new Date(SAMPLE_NOW.getTime() + minutesLeft * 60_000).toISOString(),
  metAt: null,
});

const TOKENS: [string, string][] = [
  ["--primary", "Primary (slate)"],
  ["--accent", "Accent (emerald)"],
  ["--accent-strong", "Button fill"],
  ["--bg", "Background"],
  ["--surface", "Surface"],
  ["--surface-2", "Surface 2"],
  ["--text", "Text"],
  ["--muted", "Text secondary"],
  ["--line", "Border"],
  ["--ok", "Success"],
  ["--warn", "Warning"],
  ["--bad", "Error"],
  ["--info", "Info"],
  ["--prog", "In progress"],
  ["--chart-3", "Chart blue"],
  ["--chart-4", "Chart amber"],
];

const TONES: Tone[] = ["info", "prog", "warn", "ok", "bad", "done", "neutral"];

export function DesignSystemShowcase() {
  const toast = useToast();
  const [tab, setTab] = useState<"loading" | "empty" | "error">("loading");
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
  const [chip, setChip] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <Card aria-labelledby="ds-tokens">
        <CardHeader
          titleId="ds-tokens"
          title="Colour tokens"
          meta="Switch the theme in the top bar to see dark values"
        />
        <CardBody className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-2.5">
          {TOKENS.map(([token, name]) => (
            <div key={token} className="overflow-hidden rounded-lg border border-line text-xs">
              <div className="h-11" style={{ background: `var(${token})` }} />
              <p className="px-2 py-1.5">
                <span className="block font-semibold">{name}</span>
                <span className="font-mono text-muted">{token}</span>
              </p>
            </div>
          ))}
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card aria-labelledby="ds-buttons">
          <CardHeader titleId="ds-buttons" title="Buttons" />
          <CardBody className="flex flex-wrap gap-2">
            <Button variant="primary" icon={<Plus className="size-4" aria-hidden />}>
              Primary
            </Button>
            <Button variant="strong">Confirm</Button>
            <Button>Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger" icon={<Trash2 className="size-4" aria-hidden />}>
              Delete
            </Button>
            <Button disabled>Disabled</Button>
            <Button
              loading={busy}
              onClick={() => {
                setBusy(true);
                setTimeout(() => setBusy(false), 1500);
              }}
            >
              {busy ? "Saving…" : "Click to see loading"}
            </Button>
          </CardBody>
        </Card>

        <Card aria-labelledby="ds-status">
          <CardHeader
            titleId="ds-status"
            title="Status"
            meta="Shape and colour, never colour alone"
          />
          <CardBody className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(STAGE_DISPLAY) as TicketStage[]).map((stage) => (
                <StagePill key={stage} stage={stage} />
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {TONES.map((tone) => (
                <StatusPill key={tone} tone={tone}>
                  {tone}
                </StatusPill>
              ))}
              <Tag>Tag</Tag>
            </div>
            <div className="flex flex-wrap gap-4">
              <PriorityMark priority="CRITICAL" />
              <PriorityMark priority="HIGH" />
              <PriorityMark priority="MEDIUM" />
              <PriorityMark priority="LOW" />
            </div>
            <div className="flex flex-wrap gap-4">
              <SlaMark sla={sample("ok", 190)} now={SAMPLE_NOW} />
              <SlaMark sla={sample("risk", 42)} now={SAMPLE_NOW} />
              <SlaMark sla={sample("breach", -65)} now={SAMPLE_NOW} />
              <SlaMark sla={sample("paused", 0)} now={SAMPLE_NOW} />
            </div>
          </CardBody>
        </Card>

        <Card aria-labelledby="ds-forms">
          <CardHeader titleId="ds-forms" title="Form fields" />
          <CardBody className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field label="Customer" required help="Synced from your ERP.">
              {(props) => <Input {...props} defaultValue="Northfield Infra" />}
            </Field>
            <Field
              label="Phone"
              required
              error="Enter a 10-digit mobile number, for example 98450 12345."
            >
              {(props) => (
                <Input {...props} type="tel" defaultValue="98450 12" autoComplete="tel" />
              )}
            </Field>
            <Field label="Service type">
              {(props) => (
                <Select {...props} defaultValue="breakdown">
                  <option value="breakdown">Breakdown</option>
                  <option value="pm">Preventive maintenance</option>
                </Select>
              )}
            </Field>
            <Field label="Role" help="Ask an administrator to change your role.">
              {(props) => <Input {...props} readOnly defaultValue="Service manager" />}
            </Field>
          </CardBody>
        </Card>

        <Card aria-labelledby="ds-controls">
          <CardHeader titleId="ds-controls" title="Choices and overlays" />
          <CardBody className="flex flex-col gap-3.5">
            <Segmented
              label="Table density"
              value={density}
              onChange={setDensity}
              options={[
                { value: "comfortable", label: "Comfortable" },
                { value: "compact", label: "Compact" },
              ]}
            />
            <div className="flex flex-wrap gap-1.5">
              <FilterChip pressed={chip} onClick={() => setChip((v) => !v)} count={5}>
                SLA at risk
              </FilterChip>
              <FilterChip pressed={!chip} onClick={() => setChip((v) => !v)}>
                Unassigned
              </FilterChip>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setDialogOpen(true)}>Open dialog</Button>
              <Button onClick={() => setDrawerOpen(true)}>Open drawer</Button>
              <Button onClick={() => toast.success("Settings saved.")}>Success toast</Button>
              <Button
                onClick={() =>
                  toast.error("Couldn't reach the ERP. Check the connection and try again.")
                }
              >
                Error toast
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>

      <Card aria-labelledby="ds-states">
        <CardHeader titleId="ds-states" title="Data states" meta="Every list handles all three" />
        <CardBody>
          <Tabs
            label="Data states"
            value={tab}
            onChange={setTab}
            items={[
              { key: "loading", label: "Loading" },
              { key: "empty", label: "Empty" },
              { key: "error", label: "Error" },
            ]}
          >
            {tab === "loading" && <TableSkeleton label="Loading tickets" />}
            {tab === "empty" && (
              <EmptyState
                icon={<TicketX className="size-6" />}
                title="No tickets match these filters"
                description="Try clearing “SLA at risk”, or widen the date range."
                action={<Button size="sm">Clear filters</Button>}
              />
            )}
            {tab === "error" && (
              <ErrorState
                title="Couldn't load the report"
                description="The ERP didn't respond within 30 seconds. Your filters are kept."
                onRetry={() => toast.success("Retrying…")}
              />
            )}
          </Tabs>
        </CardBody>
      </Card>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="Run the ERP sync now?"
        description="Reads customers, machines and items from ERPNext. Takes about three minutes."
        footer={
          <>
            <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button
              variant="strong"
              icon={<RefreshCw className="size-4" aria-hidden />}
              onClick={() => {
                setDialogOpen(false);
                toast.success("Sync started.");
              }}
            >
              Run sync
            </Button>
          </>
        }
      />

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Invite a user"
        description="They get an email to set their password."
        footer={
          <>
            <Button onClick={() => setDrawerOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                setDrawerOpen(false);
                toast.success("Invite sent.");
              }}
            >
              Send invite
            </Button>
          </>
        }
      >
        <Field label="Full name" required>
          {(props) => <Input {...props} autoComplete="off" />}
        </Field>
        <Field label="Work email" required help="The invite link expires after 48 hours.">
          {(props) => <Input {...props} type="email" autoComplete="off" />}
        </Field>
      </Drawer>
    </div>
  );
}
