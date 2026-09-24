import type { Metadata } from "next";
import { LoginForm } from "@/features/auth/login-form";
import { safeNext } from "@/lib/auth/next-url";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage(props: PageProps<"/login">) {
  const params = await props.searchParams;
  const next = typeof params.next === "string" ? params.next : null;
  return <LoginForm next={safeNext(next)} signedOut={params.signedOut === "1"} />;
}
