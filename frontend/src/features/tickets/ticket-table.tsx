"use client";

import { MapPin } from "lucide-react";
import Link from "next/link";
import { Tag } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/misc";
import { Sub, Table, Td, Th, Tr } from "@/components/ui/table";
import type { TicketRow } from "./api";
import { PriorityMark, SlaMark, StagePill } from "./display";
import { formatWhen } from "./format";

interface TicketTableProps {
  tickets: TicketRow[];
  caption: string;
  /** Fewer columns (no machine, engineer or logged time) for cards beside other panels. */
  compact?: boolean;
}

const place = (t: TicketRow) => t.site?.city ?? t.site?.title ?? t.region?.name ?? "—";

/** Phones get stacked cards (stage and SLA first); wider screens get the table. */
export function TicketTable({ tickets, caption, compact = false }: TicketTableProps) {
  const now = new Date();
  return (
    <>
      <TicketCards tickets={tickets} label={caption} now={now} />
      <TicketRows tickets={tickets} caption={caption} compact={compact} now={now} />
    </>
  );
}

function TicketLink({ ticket }: { ticket: TicketRow }) {
  return (
    <Link
      href={`/tickets/${ticket.number}`}
      className="font-mono text-[13px] font-semibold whitespace-nowrap text-text underline-offset-2 hover:underline"
    >
      {ticket.number}
    </Link>
  );
}

function TicketCards({ tickets, label, now }: { tickets: TicketRow[]; label: string; now: Date }) {
  return (
    <ul aria-label={label} className="m-0 list-none p-0 sm:hidden">
      {tickets.map((ticket) => (
        <li
          key={ticket.id}
          className="flex flex-col gap-1.5 border-b border-line px-4 py-3 last:border-b-0"
        >
          <div className="flex flex-wrap items-center gap-2">
            <TicketLink ticket={ticket} />
            <StagePill stage={ticket.stage} />
          </div>
          <p className="font-semibold">{ticket.title}</p>
          <p className="text-xs text-muted">
            {ticket.customer.name} · {place(ticket)}
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <PriorityMark priority={ticket.priority} />
            <SlaMark sla={ticket.sla} now={now} />
            <span className="text-xs text-muted">{ticket.engineer?.name ?? "Unassigned"}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function TicketRows({ tickets, caption, compact, now }: TicketTableProps & { now: Date }) {
  return (
    <Table caption={caption} className="max-sm:hidden">
      <thead>
        <tr>
          <Th>Ticket</Th>
          <Th>Customer · site</Th>
          {!compact && <Th>Machine</Th>}
          <Th>Priority</Th>
          <Th>Stage</Th>
          {!compact && <Th>Engineer</Th>}
          <Th>SLA</Th>
          {!compact && <Th>Logged</Th>}
        </tr>
      </thead>
      <tbody>
        {tickets.map((ticket) => (
          <Tr key={ticket.id} className="hover:bg-surface-2">
            <Td className="min-w-52">
              <span className="flex flex-wrap items-center gap-2">
                <TicketLink ticket={ticket} />
                {ticket.isDemo && <Tag className="border-info/40 text-info">Demo</Tag>}
              </span>
              <Sub>{ticket.title}</Sub>
            </Td>
            <Td className="min-w-40">
              {ticket.customer.name}
              <Sub>
                <MapPin className="mr-1 inline size-3" aria-hidden />
                {place(ticket)}
              </Sub>
            </Td>
            {!compact && (
              <Td className="min-w-44">
                {ticket.equipment ? (
                  <>
                    {ticket.equipment.itemName ?? ticket.equipment.itemCode}
                    <Sub>
                      <span className="font-mono">{ticket.equipment.serialNo}</span>
                    </Sub>
                  </>
                ) : (
                  <span className="text-muted">No machine</span>
                )}
              </Td>
            )}
            <Td>
              <PriorityMark priority={ticket.priority} />
            </Td>
            <Td>
              <StagePill stage={ticket.stage} />
            </Td>
            {!compact && (
              <Td>
                {ticket.engineer ? (
                  <span className="flex items-center gap-2 whitespace-nowrap">
                    <Avatar name={ticket.engineer.name} size="sm" />
                    {ticket.engineer.name}
                  </span>
                ) : (
                  <span className="text-muted">Unassigned</span>
                )}
              </Td>
            )}
            <Td>
              <SlaMark sla={ticket.sla} now={now} />
            </Td>
            {!compact && (
              <Td className="whitespace-nowrap text-muted">{formatWhen(ticket.createdAt, now)}</Td>
            )}
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}
