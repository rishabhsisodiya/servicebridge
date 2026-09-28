import type { Metadata } from "next";
import { EmailSettingsPage } from "@/features/settings/email-settings-page";

export const metadata: Metadata = { title: "Email" };

const isTab = (value: unknown) => value === "templates";

export default async function EmailPage(props: PageProps<"/settings/email">) {
  const { tab } = await props.searchParams;
  return <EmailSettingsPage initialTab={isTab(tab) ? "templates" : "smtp"} />;
}
