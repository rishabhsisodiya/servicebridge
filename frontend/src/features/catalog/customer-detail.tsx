"use client";

import { Mail, MapPin, Phone, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { StatusPill } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { ErrorState, TableSkeleton } from "@/components/ui/states";
import { Sub, Table, Td, Th, Tr } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { apiFetch, ApiError } from "@/lib/api/client";
import { type Coverage, CoveragePill, SourceTag } from "./shared";

interface CustomerDetail {
  id: string;
  name: string;
  source: "DEMO" | "ERP" | "LOCAL";
  erpName: string | null;
  customerGroup: string | null;
  territory: string | null;
  taxId: string | null;
  mobile: string | null;
  email: string | null;
  active: boolean;
  sites: {
    id: string;
    title: string;
    line1: string | null;
    line2: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
    gstin: string | null;
    active: boolean;
  }[];
  contacts: {
    id: string;
    fullName: string;
    email: string | null;
    mobile: string | null;
    phone: string | null;
    isPrimary: boolean;
    active: boolean;
  }[];
  equipment: {
    id: string;
    serialNo: string;
    itemName: string | null;
    itemCode: string | null;
    active: boolean;
    coverage: Coverage;
    until: string | null;
    amcExpiring: boolean;
  }[];
}

export function CustomerDetailScreen({ id }: { id: string }) {
  const { data, error, isLoading, mutate } = useSWR<CustomerDetail, ApiError>(
    `/customers/${id}`,
    (k: string) => apiFetch<CustomerDetail>(k),
  );
  const [tab, setTab] = useState<"machines" | "sites" | "contacts">("machines");

  if (isLoading) return <TableSkeleton label="Loading customer" />;
  if (error || !data) {
    return (
      <ErrorState
        title="Couldn't load this customer"
        description={error?.message}
        onRetry={() => void mutate()}
      />
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            {data.customerGroup && <span>{data.customerGroup}</span>}
            {data.territory && <span>· {data.territory}</span>}
            {data.taxId && <span className="font-mono">· {data.taxId}</span>}
            <SourceTag source={data.source} />
            {!data.active && <StatusPill tone="done">Inactive in ERP</StatusPill>}
          </>
        }
        title={data.name}
        description={
          <span className="flex flex-wrap gap-x-4 gap-y-1">
            {data.mobile && (
              <span className="inline-flex items-center gap-1">
                <Phone className="size-3.5" aria-hidden />
                {data.mobile}
              </span>
            )}
            {data.email && (
              <span className="inline-flex items-center gap-1">
                <Mail className="size-3.5" aria-hidden />
                {data.email}
              </span>
            )}
          </span>
        }
        actions={
          <ButtonLink
            href="/tickets/new"
            variant="primary"
            icon={<Plus className="size-4" aria-hidden />}
          >
            Log a ticket
          </ButtonLink>
        }
      />
      <Tabs
        label="Customer details"
        value={tab}
        onChange={setTab}
        items={[
          { key: "machines", label: "Machines", count: data.equipment.length },
          { key: "sites", label: "Sites", count: data.sites.length },
          { key: "contacts", label: "Contacts", count: data.contacts.length },
        ]}
      >
        <Card>
          {tab === "machines" &&
            (data.equipment.length ? (
              <Table caption="Machines">
                <thead>
                  <tr>
                    <Th>Serial no.</Th>
                    <Th>Model</Th>
                    <Th>Coverage</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.equipment.map((m) => (
                    <Tr key={m.id}>
                      <Td className="font-mono text-[13px]">
                        <Link
                          href={`/equipment?search=${encodeURIComponent(m.serialNo)}`}
                          className="font-semibold text-text underline-offset-2 hover:underline"
                        >
                          {m.serialNo}
                        </Link>
                        {!m.active && <Sub>inactive</Sub>}
                      </Td>
                      <Td>{m.itemName ?? m.itemCode ?? "—"}</Td>
                      <Td>
                        <CoveragePill
                          coverage={m.coverage}
                          until={m.until}
                          amcExpiring={m.amcExpiring}
                        />
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <p className="px-4 py-6 text-muted">No machines recorded for this customer.</p>
            ))}
          {tab === "sites" &&
            (data.sites.length ? (
              <ul className="m-0 grid list-none grid-cols-1 gap-3 p-4 md:grid-cols-2">
                {data.sites.map((s) => (
                  <li key={s.id} className="flex gap-2.5 rounded-lg border border-line p-3">
                    <MapPin className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
                    <span className="text-[13px]">
                      <span className="block font-semibold">
                        {s.title}{" "}
                        {!s.active && <span className="font-normal text-muted">(inactive)</span>}
                      </span>
                      {[s.line1, s.line2, [s.city, s.state].filter(Boolean).join(", "), s.pincode]
                        .filter(Boolean)
                        .join(" · ")}
                      {s.gstin && (
                        <span className="block font-mono text-xs text-muted">{s.gstin}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-6 text-muted">No sites recorded for this customer.</p>
            ))}
          {tab === "contacts" &&
            (data.contacts.length ? (
              <Table caption="Contacts">
                <thead>
                  <tr>
                    <Th>Name</Th>
                    <Th>Mobile</Th>
                    <Th>Email</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.contacts.map((c) => (
                    <Tr key={c.id}>
                      <Td>
                        <span className="font-semibold">{c.fullName}</span>
                        {c.isPrimary && <Sub>Primary contact</Sub>}
                      </Td>
                      <Td className="whitespace-nowrap">{c.mobile ?? c.phone ?? "—"}</Td>
                      <Td>{c.email ?? "—"}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <p className="px-4 py-6 text-muted">No contacts recorded for this customer.</p>
            ))}
        </Card>
      </Tabs>
    </>
  );
}
