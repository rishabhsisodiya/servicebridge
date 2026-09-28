import type { Metadata } from "next";
import { RolesScreen } from "@/features/roles/roles-screen";

export const metadata: Metadata = { title: "Roles" };

export default function RolesPage() {
  return <RolesScreen />;
}
