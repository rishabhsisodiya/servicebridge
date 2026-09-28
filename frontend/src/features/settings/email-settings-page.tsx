"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { EmailSettingsScreen, type EmailTab } from "./email-settings";

export function EmailSettingsPage({ initialTab }: { initialTab: EmailTab }) {
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTab] = useState<EmailTab>(initialTab);

  const change = (next: EmailTab) => {
    setTab(next);
    router.replace(`${pathname}?tab=${next}`, { scroll: false });
  };

  return <EmailSettingsScreen tab={tab} onTab={change} />;
}
