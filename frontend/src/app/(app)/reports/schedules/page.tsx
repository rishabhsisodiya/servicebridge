import type { Metadata } from "next";
import { SchedulesScreen } from "@/features/reports/schedules";

export const metadata: Metadata = { title: "Scheduled reports" };

export default function ReportSchedulesPage() {
  return <SchedulesScreen />;
}
