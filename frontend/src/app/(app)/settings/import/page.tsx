import type { Metadata } from "next";
import { ImportScreen } from "@/features/import/import-screen";

export const metadata: Metadata = { title: "Bulk import" };

export default function ImportPage() {
  return <ImportScreen />;
}
