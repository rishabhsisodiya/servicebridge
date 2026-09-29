"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileText,
  MailCheck,
  Paperclip,
  Wrench,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { StatusPill } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/misc";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/states";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { formatDate, money } from "@/features/catalog/shared";
import { ApiError } from "@/lib/api/client";
import {
  approveQuotation,
  rejectQuotation,
  usePortalQuotations,
  usePortalTicket,
} from "./api";
import { isQuotationActionable, type PortalQuotation } from "./types";
import { PortalPriorityPill, PortalStagePill } from "./display";

export function PortalTicketDetail({ number }: { number: string }) {
  const {
    data: ticket,
    error,
    isLoading,
    mutate,
  } = usePortalTicket(number);

  if (isLoading) {
    return (
      <>
        <PageHeader title={`Ticket ${number}`} />
        <Card className="mt-4">
          <TableSkeleton rows={6} label="Loading the ticket" />
        </Card>
      </>
    );
  }

  if (error || !ticket) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <>
        <PageHeader title={`Ticket ${number}`} />
        <Card className="mt-4">
          <ErrorState
            title={notFound ? "Ticket not found" : "Couldn't load this ticket"}
            description={
              notFound
                ? "It may belong to another customer, or the number is wrong."
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
        title={ticket.title}
        eyebrow={
          <>
            <span className="font-mono">{ticket.number}</span>
            <PortalStagePill stage={ticket.stage} />
            <PortalPriorityPill priority={ticket.priority} />
          </>
        }
        description={
          <>
            Raised {formatDate(ticket.createdAt)}
            {" · "}
            {ticket.slaDueAt ? (
              <span className="inline-flex items-center gap-1">
                <Clock3 className="size-3.5" aria-hidden />
                SLA due {formatDate(ticket.slaDueAt)}
              </span>
            ) : (
              "No SLA target set"
            )}
          </>
        }
      />

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader title="Description" />
            <CardBody>
              <p className="whitespace-pre-wrap">{ticket.description}</p>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Timeline" />
            <CardBody>
              {ticket.timeline.length === 0 ? (
                <p className="text-muted">No updates yet.</p>
              ) : (
                <ol className="flex flex-col gap-3">
                  {ticket.timeline.map((event, index) => (
                    <li key={`${event.at}-${index}`} className="flex gap-3">
                      <span
                        aria-hidden
                        className="mt-1.5 size-2 shrink-0 rounded-full bg-accent"
                      />
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold">{event.summary}</p>
                        <p className="text-xs text-muted">
                          {event.type} · {formatDate(event.at)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Attachments" />
            <CardBody>
              {ticket.attachments.length === 0 ? (
                <p className="text-muted">No attachments.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {ticket.attachments.map((file) => (
                    <li
                      key={file.id}
                      className="flex items-center gap-2 text-[13.5px]"
                    >
                      <Paperclip className="size-4 shrink-0 text-muted" aria-hidden />
                      <span className="truncate">{file.filename}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader title="Equipment" />
            <CardBody>
              {ticket.equipment ? (
                <p className="flex items-center gap-2 text-[13.5px] font-medium">
                  <Wrench className="size-4 shrink-0 text-muted" aria-hidden />
                  {ticket.equipment.name}
                </p>
              ) : (
                <p className="text-muted">Not specified.</p>
              )}
            </CardBody>
          </Card>
          <CsatCard state={ticket.csat.state} />
        </div>
      </div>

      <QuotationsSection ticketNumber={ticket.number} />
    </>
  );
}

function CsatCard({ state }: { state: "none" | "pending" | "answered" }) {
  if (state === "none") return null;
  return (
    <Card>
      <CardHeader title="Service feedback" />
      <CardBody>
        {state === "pending" ? (
          <p className="flex items-start gap-2 text-[13.5px] text-muted">
            <MailCheck className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
            <span>
              How did we do? <span className="font-medium text-text">We&apos;ll email you the survey link</span> for
              this ticket — it takes under a minute.
            </span>
          </p>
        ) : (
          <p className="flex items-start gap-2 text-[13.5px] text-muted">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
            Thanks — you&apos;ve already rated this ticket.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

function QuotationsSection({ ticketNumber }: { ticketNumber: string }) {
  const toast = useToast();
  const { data, isLoading, mutate } = usePortalQuotations(ticketNumber);
  const [dialog, setDialog] = useState<{
    mode: "approve" | "reject";
    quotation: PortalQuotation;
  } | null>(null);

  const quotations = data?.items ?? [];

  return (
    <Card className="mt-4">
      <CardHeader
        title="Quotations"
        meta={`${quotations.length} ${quotations.length === 1 ? "quotation" : "quotations"}`}
      />
      <CardBody>
        {isLoading ? (
          <TableSkeleton rows={3} label="Loading quotations" />
        ) : quotations.length === 0 ? (
          <EmptyState
            icon={<FileText className="size-6" aria-hidden />}
            title="No quotations yet"
            description="If chargeable work is needed, the quotation will appear here for your approval."
          />
        ) : (
          <div className="flex flex-col gap-4">
            {quotations.map((quotation) => (
              <QuotationCard
                key={quotation.id}
                quotation={quotation}
                onDecide={(mode) => setDialog({ mode, quotation })}
              />
            ))}
          </div>
        )}
      </CardBody>
      {dialog && (
        <QuotationDialog
          mode={dialog.mode}
          quotation={dialog.quotation}
          onClose={() => setDialog(null)}
          onDone={(message) => {
            setDialog(null);
            void mutate();
            toast.success(message);
          }}
        />
      )}
    </Card>
  );
}

function QuotationCard({
  quotation,
  onDecide,
}: {
  quotation: PortalQuotation;
  onDecide: (mode: "approve" | "reject") => void;
}) {
  const actionable = isQuotationActionable(quotation);
  const total = quotation.lines.reduce(
    (sum, line) => sum + Number(line.quantity) * Number(line.rate),
    0,
  );
  return (
    <div className="rounded-xl border border-line">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <span className="font-mono text-[13.5px] font-semibold">{quotation.number}</span>
        <StatusPill tone={actionable ? "warn" : "neutral"}>{quotation.status}</StatusPill>
        {quotation.validUntil && (
          <span className="text-xs text-muted">Valid until {formatDate(quotation.validUntil)}</span>
        )}
        {quotation.approvedByCustomerAt && (
          <span className="inline-flex items-center gap-1 text-xs text-ok">
            <CheckCircle2 className="size-3.5" aria-hidden />
            Approved by you on {formatDate(quotation.approvedByCustomerAt)}
          </span>
        )}
        {actionable && (
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => onDecide("reject")}>
              Reject
            </Button>
            <Button size="sm" variant="primary" onClick={() => onDecide("approve")}>
              Approve
            </Button>
          </div>
        )}
      </div>
      <Table caption={`Lines for quotation ${quotation.number}`}>
        <thead>
          <Tr>
            <Th align="right">Qty</Th>
            <Th align="right">Rate</Th>
            <Th align="right">Amount</Th>
          </Tr>
        </thead>
        <tbody>
          {quotation.lines.map((line, index) => (
            <Tr key={index}>
              <Td align="right" className="tabular-nums">
                {line.quantity}
              </Td>
              <Td align="right" className="tabular-nums">
                {money(Number(line.rate))}
              </Td>
              <Td align="right" className="font-semibold tabular-nums">
                {money(Number(line.quantity) * Number(line.rate))}
              </Td>
            </Tr>
          ))}
          <Tr>
            <Td colSpan={2} align="right" className="font-semibold">
              Total
            </Td>
            <Td align="right" className="font-semibold tabular-nums">
              {money(total)}
            </Td>
          </Tr>
        </tbody>
      </Table>
    </div>
  );
}

function QuotationDialog({
  mode,
  quotation,
  onClose,
  onDone,
}: {
  mode: "approve" | "reject";
  quotation: PortalQuotation;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const alertRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (error) alertRef.current?.focus();
  }, [error]);

  const approve = mode === "approve";
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    try {
      if (approve) {
        await approveQuotation(quotation.id, value);
        onDone(`Quotation ${quotation.number} approved`);
      } else {
        await rejectQuotation(quotation.id, value);
        onDone(`Quotation ${quotation.number} rejected`);
      }
    } catch (caught) {
      setSubmitting(false);
      setError(
        caught instanceof ApiError ? caught.message : "Something went wrong. Try again.",
      );
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      dirty={value.trim() !== ""}
      title={approve ? `Approve ${quotation.number}` : `Reject ${quotation.number}`}
      description={
        approve
          ? "Approving tells the service team to go ahead with this work."
          : "Let the service team know why this doesn't work for you."
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant={approve ? "primary" : "danger"}
            type="submit"
            form="portal-quotation-decision"
            loading={submitting}
          >
            {approve ? "Approve quotation" : "Reject quotation"}
          </Button>
        </>
      }
    >
      <form id="portal-quotation-decision" onSubmit={submit} noValidate className="flex flex-col gap-3">
        {error && (
          <div
            ref={alertRef}
            tabIndex={-1}
            role="alert"
            className="flex items-start gap-2 rounded-lg bg-bad-bg px-3.5 py-2.5 text-[13px] text-bad"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        )}
        <Field
          label={approve ? "PO number (optional)" : "Reason (optional)"}
          help={
            approve
              ? "Your purchase order reference, if you have one."
              : "Optional, but it helps the service team revise the quote."
          }
        >
          {(props) =>
            approve ? (
              <Input
                {...props}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder="e.g. PO-2026-1842"
                maxLength={60}
              />
            ) : (
              <Textarea
                {...props}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                rows={4}
                placeholder="e.g. The visit charges look too high for a 2-hour job."
              />
            )
          }
        </Field>
      </form>
    </Dialog>
  );
}
