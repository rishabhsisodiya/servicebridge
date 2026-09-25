import type { Metadata } from "next";
import { ItemsScreen } from "@/features/catalog/items-screen";

export const metadata: Metadata = { title: "Spares & items" };

export default function ItemsPage() {
  return <ItemsScreen />;
}
