import type { Metadata } from "next";
import { RegionsScreen } from "@/features/service-rules/regions-screen";

export const metadata: Metadata = { title: "Regions" };

export default function RegionsPage() {
  return <RegionsScreen />;
}
