import { redirect } from "next/navigation";

/** The ticket list lives on the portal dashboard; keep the plural path working. */
export default function PortalTicketsPage() {
  redirect("/portal");
}
