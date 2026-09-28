"use client";

import { Printer } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { ErrorState, Skeleton } from "@/components/ui/states";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { ApiError } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";
import { getQuotation, type QuotationDetail } from "./api";
import { formatDate, money, QuotationStatusPill, totalsCurrency } from "./display";
import { QuotationActionBar } from "./quotation-actions";
import { QuotationForm, QuotationReadonlyHint } from "./quotation-form";
import { TotalsTable } from "./totals-table";

/**
 * One quotation: a draft opens the editor, anything else is read-only with
 * the actions its status allows. The API is the real permission check; the UI
 * only hides buttons.
 */
export function QuotationScreen({ quotationId }: { quotationId: string }) {
  const { can } = useSession();
  const router = useRouter();
  const {
    data: quotation,
    error,
    isLoading,
    mutate,
  } = useSWR<QuotationDetail, ApiError>(`/quotations/${quotationId}`, () =>
    getQuotation(quotationId),
  );

  if (isLoading) {
    return (
      <>
        <PageHeader title="Quotation" />
        <Skeleton className="h-64" />
      </>
    );
  }
  if (error || !quotation) {
    return (
      <ErrorState
        title={error?.status === 404 ? "Quotation not found" : "Couldn't load this quotation"}
        description={error?.message}
        onRetry={error?.status === 404 ? undefined : () => void mutate()}
      />
    );
  }

  const editable = quotation.status === "DRAFT" && can("quotations.edit");
  const refresh = () => mutate();

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <Link
              href={`/tickets/${quotation.ticket.number}`}
              className="font-mono underline-offset-2 hover:underline"
            >
              {quotation.ticket.number}
            </Link>
            <QuotationStatusPill status={quotation.status} />
            {quotation.revises && (
              <span className="text-muted">
                revises{" "}
                <Link href={`/quotations/${quotation.revises.id}`} className="underline underline-offset-2">
                  {quotation.revises.number}
                </Link>
              </span>
            )}
          </>
        }
        title={quotation.number}
        description={quotation.ticket.title}
        actions={
          <ButtonLink href={`/quotations/${quotation.id}/print`} icon={<Printer className="size-4" aria-hidden />}>
            Print view
          </ButtonLink>
        }
      />

      {editable ? (
        <QuotationForm
          quotation={quotation}
          onChanged={refresh}
          onDeleted={() => router.push("/quotations")}
          onRevised={(next) => router.push(`/quotations/${next.id}`)}
        />
      ) : (
        <ReadonlyQuotation
          quotation={quotation}
          onChanged={refresh}
          onRevised={(next) => router.push(`/quotations/${next.id}`)}
        />
      )}
    </>
  );
}

function ReadonlyQuotation({
  quotation,
  onChanged,
  onRevised,
}: {
  quotation: QuotationDetail;
  onChanged: () => Promise<unknown>;
  onRevised: (next: QuotationDetail) => void;
}) {
  const currency = totalsCurrency(quotation.totals);
  return (
    <div className="flex flex-col gap-4">
      <QuotationReadonlyHint
        locked={quotation.status === "DRAFT"}
      />

      <Card aria-labelledby="ro-lines-title">
        <CardHeader
          titleId="ro-lines-title"
          title="Line items"
          meta={`${quotation.totals.lineCount}`}
        />
        <CardBody className="p-0!">
          <Table>
            <thead>
              <Tr>
                <Th>Item</Th>
                <Th align="right">Qty</Th>
                <Th align="right">Rate ({currency})</Th>
                <Th align="right">Amount</Th>
              </Tr>
            </thead>
            <tbody>
              {quotation.lines.map((line) => (
                <Tr key={line.id}>
                  <Td>
                    <span className="block font-semibold">{line.item.name}</span>
                    <span className="block text-xs text-muted">
                      {line.item.itemCode}
                      {line.item.uom ? ` · ${line.item.uom}` : ""}
                    </span>
                  </Td>
                  <Td align="right" className="tabular-nums">
                    {Number(line.quantity)}
                  </Td>
                  <Td align="right" className="tabular-nums">
                    {money(line.rate, currency)}
                  </Td>
                  <Td align="right" className="font-semibold tabular-nums">
                    {money(Number(line.quantity) * Number(line.rate), currency)}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card aria-labelledby="ro-totals-title">
          <CardHeader titleId="ro-totals-title" title="Totals" />
          <CardBody>
            <TotalsTable totals={quotation.totals} />
          </CardBody>
        </Card>
        <Card aria-labelledby="ro-meta-title">
          <CardHeader titleId="ro-meta-title" title="Details" />
          <CardBody>
            <dl className="m-0 flex flex-col gap-1.5 p-0 text-[13.5px]">
              <MetaRow label="Valid until" value={formatDate(quotation.validUntil)} />
              {quotation.discountPercent != null && (
                <MetaRow label="Discount" value={`${Number(quotation.discountPercent)}%`} />
              )}
              {quotation.sentAt && (
                <MetaRow
                  label="Sent"
                  value={`${formatDate(quotation.sentAt)}${quotation.sentBy ? ` by ${quotation.sentBy.name}` : ""}`}
                />
              )}
              {quotation.poNumber && (
                <MetaRow
                  label="PO"
                  value={`${quotation.poNumber}${quotation.poDate ? ` · dated ${formatDate(quotation.poDate)}` : ""}`}
                />
              )}
              {quotation.notes && <MetaRow label="Notes" value={quotation.notes} />}
              {quotation.createdBy && (
                <MetaRow label="Created by" value={quotation.createdBy.name} />
              )}
            </dl>
          </CardBody>
        </Card>
      </div>

      <QuotationActionBar quotation={quotation} onChanged={onChanged} onRevised={onRevised} />
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="m-0 text-right font-medium whitespace-pre-line [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}
