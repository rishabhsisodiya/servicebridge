import type { Metadata } from "next";
import { CustomerDetailScreen } from "@/features/catalog/customer-detail";

export const metadata: Metadata = { title: "Customer" };

export default async function CustomerPage(props: PageProps<"/customers/[id]">) {
  const { id } = await props.params;
  return <CustomerDetailScreen id={id} />;
}
