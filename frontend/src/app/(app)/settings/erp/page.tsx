import type { Metadata } from "next";
import { ErpScreen } from "@/features/erp/erp-screen";

export const metadata: Metadata = { title: "ERP connections" };

export default function ErpConnectionsPage() {
  return <ErpScreen />;
}
