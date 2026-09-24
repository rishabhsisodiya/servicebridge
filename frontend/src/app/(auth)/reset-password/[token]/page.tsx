import type { Metadata } from "next";
import { SetPasswordForm } from "@/features/auth/set-password-form";

// no-referrer: the token in this URL must never leak to other sites.
export const metadata: Metadata = { title: "Reset your password", referrer: "no-referrer" };

export default async function ResetPasswordPage(props: PageProps<"/reset-password/[token]">) {
  const { token } = await props.params;
  return <SetPasswordForm token={token} />;
}
