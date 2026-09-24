import { MapPin } from "lucide-react";
import Link from "next/link";
import { Avatar } from "@/components/ui/misc";
import { Sub, Table, Td, Th, Tr } from "@/components/ui/table";
import type { MockTicket } from "@/mocks/tickets";
import { PriorityMark, SlaMark, StagePill } from "./display";

interface TicketTableProps {
  tickets: MockTicket[];
  caption: string;
  /** Fewer columns (no machine, engineer or logged time) for cards beside other panels. */
  compact?: boolean;
}

/** Phones get stacked cards (stage and SLA first); wider screens get the table. */
export function TicketTable({ tickets, caption, compact = false }: TicketTableProps) {
  return (
    <>
      <TicketCards tickets={tickets} label={caption} />
      <TicketRows tickets={tickets} caption={caption} compact={compact} />
    </>
  );
}

function TicketCards({ tickets, label }: { tickets: MockTicket[]; label: string }) {
  return (
    <ul aria-label={label} className="m-0 list-none p-0 sm:hidden">
      {tickets.map((ticket) => (
        <li
          key={ticket.number}
          className="flex flex-col gap-1.5 border-b border-line px-4 py-3 last:border-b-0"
        >
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/tickets/${ticket.number}`}
              className="font-mono text-[13px] font-semibold text-text underline-offset-2 hover:underline"
            >
              {ticket.number}
            </Link>
            <StagePill stage={ticket.stage} />
          </div>
          <p className="font-semibold">{ticket.issue}</p>
          <p className="text-xs text-muted">
            {ticket.customer} · {ticket.site}
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <PriorityMark priority={ticket.priority} />
            <SlaMark state={ticket.sla.state} text={ticket.sla.text} kind={ticket.sla.kind} />
            <span className="text-xs text-muted">{ticket.engineer ?? "Unassigned"}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function TicketRows({ tickets, caption, compact }: TicketTableProps) {
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
          <Tr key={ticket.number} className="hover:bg-surface-2">
            <Td className="min-w-52">
              <Link
                href={`/tickets/${ticket.number}`}
                className="font-mono text-[13px] font-semibold whitespace-nowrap text-text underline-offset-2 hover:underline"
              >
                {ticket.number}
              </Link>
              <Sub>{ticket.issue}</Sub>
            </Td>
            <Td className="min-w-40">
              {ticket.customer}
              <Sub>
                <MapPin className="mr-1 inline size-3" aria-hidden />
                {ticket.site}
              </Sub>
            </Td>
            {!compact && (
              <Td className="min-w-44">
                {ticket.machine}
                <Sub>
                  <span className="font-mono">{ticket.serial}</span>
                </Sub>
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
                    <Avatar name={ticket.engineer} size="sm" />
                    {ticket.engineer}
                  </span>
                ) : (
                  <span className="text-muted">Unassigned</span>
                )}
              </Td>
            )}
            <Td>
              <SlaMark state={ticket.sla.state} text={ticket.sla.text} kind={ticket.sla.kind} />
            </Td>
            {!compact && <Td className="whitespace-nowrap text-muted">{ticket.logged}</Td>}
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}
