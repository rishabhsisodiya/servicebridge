import type { Metadata } from "next";
import { ReportsBrowser } from "@/features/reports/reports-browser";

export const metadata: Metadata = { title: "Reports" };

export default function ReportsPage() {
  return <ReportsBrowser />;
}
