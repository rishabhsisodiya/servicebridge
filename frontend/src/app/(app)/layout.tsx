import { AppShell } from "@/components/shell/app-shell";
import { SessionProvider } from "@/lib/auth/session";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <SessionProvider>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}
