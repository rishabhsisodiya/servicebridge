"use client";

import { CalendarDays, Plus, Trash2, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import useSWR from "swr";
import { StatusPill } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog, Drawer } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { ErrorState, TableSkeleton } from "@/components/ui/states";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { apiFetch, ApiError } from "@/lib/api/client";
import type { CalendarRow, Holiday, OpeningWindow, SlaData } from "./api";
import { DAY_NAMES, errorsFrom, FormAlert, type FormErrors, WEEK_ORDER } from "./shared";

const fetcher = <T,>(key: string) => apiFetch<T>(key);

/** "Mon–Sat 09:00–18:00", or one entry per distinct pattern. */
function summariseHours(hours: OpeningWindow[]): string {
  if (!hours.length) return "Closed";
  const byDay = new Map<number, string>();
  for (const day of WEEK_ORDER) {
    const windows = hours
      .filter((w) => w.day === day)
      .sort((a, b) => a.open.localeCompare(b.open))
      .map((w) => `${w.open}–${w.close}`);
    if (windows.length) byDay.set(day, windows.join(", "));
  }
  const groups: { days: number[]; text: string }[] = [];
  for (const day of WEEK_ORDER) {
    const text = byDay.get(day);
    const last = groups[groups.length - 1];
    const prevDay = last?.days[last.days.length - 1];
    const adjacent =
      prevDay !== undefined && WEEK_ORDER.indexOf(day) === WEEK_ORDER.indexOf(prevDay) + 1;
    if (text && last && last.text === text && adjacent) last.days.push(day);
    else if (text) groups.push({ days: [day], text });
  }
  const short = (d: number) => DAY_NAMES[d].slice(0, 3);
  return groups
    .map((g) =>
      g.days.length > 1
        ? `${short(g.days[0])}–${short(g.days[g.days.length - 1])} ${g.text}`
        : `${short(g.days[0])} ${g.text}`,
    )
    .join(" · ");
}

export function CalendarsTab() {
  const sla = useSWR<SlaData>("/service-rules/sla", fetcher);
  const toast = useToast();
  const [editing, setEditing] = useState<CalendarRow | "new" | null>(null);
  const [deleting, setDeleting] = useState<CalendarRow | null>(null);
  const [deleteError, setDeleteError] = useState<string>();

  if (sla.error)
    return <ErrorState title="Couldn't load calendars" onRetry={() => void sla.mutate()} />;
  if (!sla.data) return <TableSkeleton label="Loading calendars" />;

  const remove = async () => {
    if (!deleting) return;
    try {
      await apiFetch(`/service-rules/calendars/${deleting.id}`, { method: "DELETE" });
      toast.success(`${deleting.name} deleted.`);
      setDeleting(null);
      await sla.mutate();
    } catch (caught) {
      setDeleteError(
        caught instanceof ApiError ? caught.message : "Something went wrong. Try again.",
      );
    }
  };

  return (
    <Card>
      <CardHeader
        title="Business calendars"
        meta={`When SLA clocks run. Times are in the company time zone (${sla.data.timezone}).`}
        actions={
          <Button
            variant="primary"
            size="sm"
            icon={<Plus className="size-4" aria-hidden />}
            onClick={() => setEditing("new")}
          >
            Add calendar
          </Button>
        }
      />
      <Table caption="Business calendars">
        <thead>
          <tr>
            <Th>Calendar</Th>
            <Th>Open</Th>
            <Th align="right">Holidays</Th>
            <Th align="right">Used by</Th>
            <Th>
              <span className="sr-only">Actions</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {sla.data.calendars.map((c) => (
            <Tr key={c.id}>
              <Td className="min-w-40">
                <button
                  type="button"
                  onClick={() => setEditing(c)}
                  className="cursor-pointer font-semibold text-text underline-offset-2 hover:underline"
                >
                  {c.name}
                </button>
              </Td>
              <Td className="min-w-56">
                {c.alwaysOpen ? <StatusPill tone="info">24×7</StatusPill> : summariseHours(c.hours)}
              </Td>
              <Td align="right">{c.alwaysOpen ? "—" : c.holidays.length}</Td>
              <Td align="right" className="whitespace-nowrap">
                {c.policyCount} {c.policyCount === 1 ? "policy" : "policies"}
              </Td>
              <Td align="right">
                <IconButton
                  label={`Delete ${c.name}`}
                  size="sm"
                  onClick={() => {
                    setDeleteError(undefined);
                    setDeleting(c);
                  }}
                >
                  <Trash2 className="size-4" aria-hidden />
                </IconButton>
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      <CalendarDrawer
        key={editing === "new" ? "new" : (editing?.id ?? "closed")}
        calendar={editing}
        onClose={() => setEditing(null)}
        onSaved={async (message) => {
          toast.success(message);
          setEditing(null);
          await sla.mutate();
        }}
      />
      <Dialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting?.name ?? "calendar"}?`}
        description="SLA policies must use another calendar first."
        footer={
          <>
            <Button onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => void remove()}>
              Delete
            </Button>
          </>
        }
      >
        <FormAlert message={deleteError} />
      </Dialog>
    </Card>
  );
}

function CalendarDrawer({
  calendar,
  onClose,
  onSaved,
}: {
  calendar: CalendarRow | "new" | null;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const existing = calendar && calendar !== "new" ? calendar : null;
  const [name, setName] = useState(existing?.name ?? "");
  const [alwaysOpen, setAlwaysOpen] = useState(existing?.alwaysOpen ?? false);
  const [hours, setHours] = useState<OpeningWindow[]>(
    existing?.hours.length
      ? existing.hours
      : [1, 2, 3, 4, 5, 6].map((day) => ({ day, open: "09:00", close: "18:00" })),
  );
  const [holidays, setHolidays] = useState<Holiday[]>(existing?.holidays ?? []);
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);

  const updateWindow = (index: number, patch: Partial<OpeningWindow>) =>
    setHours((all) => all.map((w, i) => (i === index ? { ...w, ...patch } : w)));
  const updateHoliday = (index: number, patch: Partial<Holiday>) =>
    setHolidays((all) => all.map((h, i) => (i === index ? { ...h, ...patch } : h)));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (name.trim().length < 2) {
      setErrors({ name: "Enter a name." });
      return;
    }
    setSaving(true);
    setErrors({});
    try {
      const json = { name, alwaysOpen, hours: alwaysOpen ? [] : hours, holidays };
      if (existing) {
        await apiFetch(`/service-rules/calendars/${existing.id}`, {
          method: "PATCH",
          json: { ...json, version: existing.version },
        });
      } else {
        await apiFetch("/service-rules/calendars", { method: "POST", json });
      }
      await onSaved(existing ? "Calendar saved." : "Calendar added.");
    } catch (caught) {
      const apiError = caught instanceof ApiError ? caught : undefined;
      // Row-level messages (hours.3, holidays.1.date) are shown as one list.
      const rowMessages = apiError?.fields
        .filter((f) => f.field.startsWith("hours") || f.field.startsWith("holidays"))
        .map((f) => f.message);
      const next = errorsFrom(caught, ["name"]);
      if (rowMessages?.length) {
        delete next.form;
        next.rows = [...new Set(rowMessages)].join(" ");
      }
      setErrors(next);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={!!calendar}
      onClose={onClose}
      title={existing ? `Edit ${existing.name}` : "Add a calendar"}
      description="Changes apply to tickets logged after you save."
      className="w-[min(560px,100vw)]!"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="calendar-form" variant="primary" loading={saving}>
            {existing ? "Save" : "Add calendar"}
          </Button>
        </>
      }
    >
      <form id="calendar-form" onSubmit={submit} noValidate className="flex flex-col gap-5">
        <FormAlert message={errors.form} />
        <Field label="Name" required error={errors.name}>
          {(p) => (
            <Input
              {...p}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
            />
          )}
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold">Open</span>
          <Segmented
            label="When the clock runs"
            value={alwaysOpen ? "always" : "hours"}
            onChange={(v) => setAlwaysOpen(v === "always")}
            options={[
              { value: "hours", label: "Set hours" },
              { value: "always", label: "24×7" },
            ]}
          />
        </div>
        {errors.rows && <FormAlert message={errors.rows} />}
        {!alwaysOpen && (
          <>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1.5 text-[13px] font-semibold">Weekly hours</legend>
              {WEEK_ORDER.map((day) => {
                const windows = hours.map((w, i) => ({ w, i })).filter(({ w }) => w.day === day);
                return (
                  <div
                    key={day}
                    className="flex flex-wrap items-start gap-x-3 gap-y-1.5 border-b border-line pb-2 last:border-b-0"
                  >
                    <span className="w-24 pt-2 text-[13px]">{DAY_NAMES[day]}</span>
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      {windows.length === 0 && (
                        <span className="pt-2 text-[13px] text-muted">Closed</span>
                      )}
                      {windows.map(({ w, i }) => (
                        <div key={i} className="flex items-center gap-1.5">
                          <Input
                            type="time"
                            aria-label={`${DAY_NAMES[day]} opens`}
                            value={w.open}
                            onChange={(e) => updateWindow(i, { open: e.target.value })}
                            className="min-h-9 w-32!"
                          />
                          <span aria-hidden className="text-muted">
                            –
                          </span>
                          <Input
                            type="time"
                            aria-label={`${DAY_NAMES[day]} closes`}
                            value={w.close}
                            onChange={(e) => updateWindow(i, { close: e.target.value })}
                            className="min-h-9 w-32!"
                          />
                          <IconButton
                            label={`Remove ${DAY_NAMES[day]} ${w.open}–${w.close}`}
                            size="sm"
                            onClick={() => setHours((all) => all.filter((_, j) => j !== i))}
                          >
                            <X className="size-4" aria-hidden />
                          </IconButton>
                        </div>
                      ))}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setHours((all) => [
                          ...all,
                          windows.length
                            ? { day, open: "14:00", close: "18:00" }
                            : { day, open: "09:00", close: "18:00" },
                        ])
                      }
                    >
                      {windows.length ? "Add hours" : "Open"}
                    </Button>
                  </div>
                );
              })}
            </fieldset>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1.5 text-[13px] font-semibold">Holidays</legend>
              <p className="text-xs text-muted">The clock does not run on these dates.</p>
              {holidays.map((h, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <Input
                    type="date"
                    aria-label={`Holiday ${i + 1} date`}
                    value={h.date}
                    onChange={(e) => updateHoliday(i, { date: e.target.value })}
                    className="min-h-9 w-40!"
                  />
                  <Input
                    aria-label={`Holiday ${i + 1} name`}
                    placeholder="Name, e.g. Diwali"
                    value={h.name}
                    onChange={(e) => updateHoliday(i, { name: e.target.value })}
                    className="min-h-9 min-w-0 flex-1"
                  />
                  <IconButton
                    label={`Remove holiday ${h.name || i + 1}`}
                    size="sm"
                    onClick={() => setHolidays((all) => all.filter((_, j) => j !== i))}
                  >
                    <X className="size-4" aria-hidden />
                  </IconButton>
                </div>
              ))}
              <div>
                <Button
                  size="sm"
                  icon={<CalendarDays className="size-4" aria-hidden />}
                  onClick={() => setHolidays((all) => [...all, { date: "", name: "" }])}
                >
                  Add holiday
                </Button>
              </div>
            </fieldset>
          </>
        )}
      </form>
    </Drawer>
  );
}
