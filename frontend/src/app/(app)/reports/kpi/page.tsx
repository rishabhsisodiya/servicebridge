import type { Metadata } from "next";
import { KpiMatrixScreen } from "@/features/reports/kpi-matrix";

export const metadata: Metadata = { title: "KPI matrix" };

export default function KpiMatrixPage() {
  return <KpiMatrixScreen />;
}
