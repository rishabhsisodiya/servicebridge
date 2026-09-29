import type { Metadata } from "next";
import { PortalHeader } from "./PortalHeader";
import { PortalSessionProvider } from "./PortalSessionProvider";

export const metadata: Metadata = { title: "Customer portal" };

/** Portal shell: its own header, no staff AppShell. */
export default function PortalLayout({ children }: LayoutProps<"/portal">) {
  return (
    <PortalSessionProvider>
      <div className="flex min-h-dvh flex-col">
        <PortalHeader />
        <main id="main" className="mx-auto w-full flex-1 px-4 py-6 sm:px-6">
          {children}
        </main>
      </div>
    </PortalSessionProvider>
  );
}
