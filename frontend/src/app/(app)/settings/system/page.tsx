import type { Metadata } from "next";
import { SystemScreen } from "@/features/system/system-screen";

export const metadata: Metadata = { title: "System monitor" };

export default function SystemMonitorPage() {
  return <SystemScreen />;
}
