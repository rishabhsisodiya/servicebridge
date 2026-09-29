"use client";

import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/states";
import { formatDate } from "@/features/catalog/shared";
import { ApiError } from "@/lib/api/client";
import { usePortalAmcList } from "./api";
import { PortalAmcStatusPill } from "./display";

/** The customer's AMC contracts: numbers, statuses and dates. Values stay hidden. */
export function PortalAmcBrowser() {
  const { data, error, isLoading, mutate } = usePortalAmcList();

  const items = data?.items ?? [];

  return (
    <>
      <PageHeader
        title="AMC contracts"
        description={
          data
            ? `${items.length} ${items.length === 1 ? "contract" : "contracts"}`
            : "Your annual maintenance contracts."
        }
      />
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {[0, 1].map((i) => (
            <Card key={i}>
              <TableSkeleton rows={3} label="Loading contracts" />
            </Card>
          ))}
        </div>
      ) : error || !data ? (
        <Card className="mt-4">
          <ErrorState
            title="Couldn't load your contracts"
            description={error instanceof ApiError ? error.message : undefined}
            onRetry={() => void mutate()}
          />
        </Card>
      ) : items.length === 0 ? (
        <Card className="mt-4">
          <EmptyState
            icon={<ShieldCheck className="size-6" aria-hidden />}
            title="No AMC contracts"
            description="Active maintenance contracts will appear here with their planned visits."
          />
        </Card>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          {items.map((contract) => (
            <Card key={contract.id}>
              <CardBody>
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/portal/amc/${encodeURIComponent(contract.id)}`}
                    className="font-mono text-[14px] font-semibold"
                  >
                    {contract.number}
                  </Link>
                  <PortalAmcStatusPill status={contract.status} />
                </div>
                <dl className="mt-3 grid grid-cols-1 gap-1.5 text-[13px] sm:grid-cols-2">
                  <div>
                    <dt className="text-muted">Starts</dt>
                    <dd className="font-medium">{formatDate(contract.startsOn)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Ends</dt>
                    <dd className="font-medium">{formatDate(contract.endsOn)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Equipment covered</dt>
                    <dd className="font-medium tabular-nums">{contract.equipmentCount}</dd>
                  </div>
                </dl>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
