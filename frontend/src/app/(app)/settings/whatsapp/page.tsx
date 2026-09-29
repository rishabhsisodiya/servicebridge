import type { Metadata } from "next";
import { WhatsAppSettingsScreen } from "@/features/settings/whatsapp-settings";

export const metadata: Metadata = { title: "WhatsApp" };

export default function WhatsAppPage() {
  return <WhatsAppSettingsScreen />;
}
