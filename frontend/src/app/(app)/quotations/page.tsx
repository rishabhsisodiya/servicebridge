import type { Metadata } from "next";
import { QuotationsBrowser } from "@/features/quotations/quotations-browser";

export const metadata: Metadata = { title: "Quotations" };

export default async function QuotationsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string }>;
}) {
  const { search } = await searchParams;
  return <QuotationsBrowser initialSearch={typeof search === "string" ? search : ""} />;
}
