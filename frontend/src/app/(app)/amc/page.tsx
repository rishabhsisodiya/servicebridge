import type { Metadata } from "next";
import { AmcBrowser } from "@/features/amc/amc-browser";

export const metadata: Metadata = { title: "AMC contracts" };

export default function AmcPage() {
  return <AmcBrowser />;
}
