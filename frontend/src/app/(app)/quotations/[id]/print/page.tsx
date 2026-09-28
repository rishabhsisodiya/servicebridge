import type { Metadata } from "next";
import { PrintView } from "@/features/quotations/print-view";

export const metadata: Metadata = { title: "Quotation — print" };

export default async function QuotationPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PrintView quotationId={decodeURIComponent(id)} />;
}
