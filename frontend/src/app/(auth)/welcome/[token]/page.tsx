import type { Metadata } from "next";
import { SetPasswordForm } from "@/features/auth/set-password-form";

export const metadata: Metadata = { title: "Set up your account", referrer: "no-referrer" };

export default async function WelcomePage(props: PageProps<"/welcome/[token]">) {
  const { token } = await props.params;
  return <SetPasswordForm token={token} />;
}
