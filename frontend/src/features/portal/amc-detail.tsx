"use client";

import { CalendarDays, ShieldCheck, Wrench } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { ErrorState, TableSkeleton } from "@/components/ui/states";
import { formatDate } from "@/features/catalog/shared";
import { ApiError } from "@/lib/api/client";
import { usePortalAmc } from "./api";
import { PortalAmcStatusPill } from "./display";

export function PortalAmcDetail({ id }: { id: string }) {
  const { data: contract, error, isLoading, mutate } = usePortalAmc(id);

  if (isLoading) {
    return (
      <>
        <PageHeader title="AMC contract" />
        <Card className="mt-4">
          <TableSkeleton rows={5} label="Loading the contract" />
        </Card>
      </>
    );
  }

  if (error || !contract) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <>
        <PageHeader title="AMC contract" />
        <Card className="mt-4">
          <ErrorState
            title={notFound ? "Contract not found" : "Couldn't load this contract"}
            description={
              notFound
                ? "It may belong to another customer."
                : (error instanceof ApiError ? error.message : undefined)
            }
            onRetry={() => void mutate()}
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={contract.number}
        eyebrow={<PortalAmcStatusPill status={contract.status} />}
        description={`${formatDate(contract.startsOn)} – ${formatDate(contract.endsOn)}`}
      />
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader title="Covered equipment" />
            <CardBody>
              {contract.equipment.length === 0 ? (
                <p className="text-muted">No equipment listed on this contract.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {contract.equipment.map((item) => (
                    <li key={item.id} className="flex items-center gap-2 text-[13.5px]">
                      <Wrench className="size-4 shrink-0 text-muted" aria-hidden />
                      <span className="truncate font-medium">{item.name}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader
              title="Planned visits"
              meta={`${contract.plannedVisits.length}`}
            />
            <CardBody>
              {contract.plannedVisits.length === 0 ? (
                <p className="text-muted">No visits scheduled yet.</p>
              ) : (
                <ol className="flex flex-col gap-3">
                  {contract.plannedVisits.map((visit) => (
                    <li key={visit.id} className="flex gap-3">
                      <CalendarDays
                        className="mt-0.5 size-4 shrink-0 text-muted"
                        aria-hidden
                      />
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold">
                          {visit.summary ?? "Preventive maintenance visit"}
                        </p>
                        <p className="text-xs text-muted">
                          {visit.scheduledOn ? formatDate(visit.scheduledOn) : "Date to be confirmed"}
                          {visit.status ? ` · ${visit.status}` : ""}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Contract terms" />
            <CardBody>
              <p className="flex items-start gap-2 text-[13px] text-muted">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
                Contract values are handled between your account team and your service
                provider — they aren&apos;t shown in the portal.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
