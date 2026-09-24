import type { Metadata } from "next";
import { AccountScreen } from "@/features/auth/account-screen";

export const metadata: Metadata = { title: "My account" };

export default function AccountPage() {
  return <AccountScreen />;
}
