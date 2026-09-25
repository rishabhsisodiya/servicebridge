import type { Metadata } from "next";
import { CustomersScreen } from "@/features/catalog/customers-screen";

export const metadata: Metadata = { title: "Customers" };

export default function CustomersPage() {
  return <CustomersScreen />;
}
