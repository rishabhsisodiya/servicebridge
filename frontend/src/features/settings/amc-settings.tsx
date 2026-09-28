"use client";

import { useState, type FormEvent } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { TableSkeleton } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { useStepUp } from "@/features/auth/use-step-up";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";

const AMC_SETTINGS_KEY = "/settings/app/amc";

interface AmcSettings {
  pmLeadTimeDays: number;
}

/**
 * PM lead time: how many days before a planned visit its ticket is created.
 * Lives with the automations because it drives the AMC ticket scheduler.
 */
export function AmcSettingsCard() {
  const toast = useToast();
  const { can } = useSession();
  const stepUp = useStepUp();
  const canEdit = can("company.edit");
  const { data, error, isLoading, mutate } = useSWR<AmcSettings>(AMC_SETTINGS_KEY, (key: string) =>
    apiFetch<AmcSettings>(key),
  );
  const [days, setDays] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string>();
  const [saving, setSaving] = useState(false);

  if (!can("company.read")) return null;

  const value = days ?? String(data?.pmLeadTimeDays ?? 3);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 30) {
      setFieldError("Use 1 to 30 days.");
      return;
    }
    setSaving(true);
    try {
      await stepUp.run(() =>
        apiFetch(AMC_SETTINGS_KEY, { method: "PATCH", json: { pmLeadTimeDays: parsed } }),
      );
      toast.success("Maintenance contract settings saved.");
      setFieldError(undefined);
      setDays(null);
      await mutate();
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "STEP_UP_CANCELLED") {
        /* user changed their mind */
      } else if (caught instanceof ApiError) {
        setFieldError(caught.fieldMessage("pmLeadTimeDays") ?? caught.message);
      } else {
        setFieldError("Something went wrong. Try again.");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Maintenance contracts"
        meta="Planned visits turn into tickets this many days before they're due"
      />
      {isLoading && !data && <TableSkeleton rows={2} label="Loading AMC settings" />}
      {error && !data && (
        <p className="px-4 py-4 text-[13px] text-bad">Couldn&apos;t load maintenance settings.</p>
      )}
      {data && (
        <CardBody>
          {canEdit ? (
            <form onSubmit={save} noValidate className="flex max-w-md flex-wrap items-end gap-2.5">
              <div className="max-w-44 flex-1">
                <Field label="PM lead time" error={fieldError} help="1 to 30 days.">
                  {(p) => (
                    <Input
                      {...p}
                      type="number"
                      min={1}
                      max={30}
                      step={1}
                      inputMode="numeric"
                      value={value}
                      onChange={(e) => setDays(e.target.value)}
                    />
                  )}
                </Field>
              </div>
              <Button type="submit" variant="primary" loading={saving}>
                Save
              </Button>
            </form>
          ) : (
            <p className="text-[13px]">
              PM tickets are created{" "}
              <strong>
                {data.pmLeadTimeDays} {data.pmLeadTimeDays === 1 ? "day" : "days"}
              </strong>{" "}
              before a planned visit.
            </p>
          )}
        </CardBody>
      )}
      {stepUp.dialog}
    </Card>
  );
}
