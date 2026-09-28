import type { Metadata } from "next";
import { QuotationScreen } from "@/features/quotations/quotation-screen";

export const metadata: Metadata = { title: "Quotation" };

export default async function QuotationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <QuotationScreen quotationId={decodeURIComponent(id)} />;
}
