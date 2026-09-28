import type { Metadata } from "next";
import { PartnerKeysScreen } from "@/features/partner/partner-keys";

export const metadata: Metadata = { title: "Partner API keys" };

export default function PartnerKeysPage() {
  return <PartnerKeysScreen />;
}
