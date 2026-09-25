import type { Metadata } from "next";
import { EquipmentScreen } from "@/features/catalog/equipment-screen";

export const metadata: Metadata = { title: "Equipment" };

export default async function EquipmentPage(props: PageProps<"/equipment">) {
  const { search } = await props.searchParams;
  return <EquipmentScreen initialSearch={typeof search === "string" ? search : ""} />;
}
