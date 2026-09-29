import type { Metadata } from "next";
import { PortalAmcBrowser } from "@/features/portal/amc-browser";

export const metadata: Metadata = { title: "AMC contracts" };

export default function PortalAmcPage() {
  return <PortalAmcBrowser />;
}
