import type { Metadata } from "next";
import { MagicLinkForm } from "@/features/portal/magic-link-form";

export const metadata: Metadata = { title: "Sign in to the customer portal" };

export default async function PortalLoginPage(props: PageProps<"/portal/login">) {
  const params = await props.searchParams;
  return (
    <div className="mx-auto w-full max-w-sm pt-8">
      <MagicLinkForm signedOut={params.signedOut === "1"} />
    </div>
  );
}
