import type { Metadata } from "next";
import { AmcNewScreen } from "@/features/amc/amc-new";

export const metadata: Metadata = { title: "New contract" };

export default function AmcNewPage() {
  return <AmcNewScreen />;
}
