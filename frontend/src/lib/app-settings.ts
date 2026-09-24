"use client";

import useSWR from "swr";
import { apiFetch } from "@/lib/api/client";

export interface CompanySettings {
  name: string;
  timezone: string;
  currency: string;
  gstRatePercent: number;
}

export interface AppSettings {
  company: CompanySettings;
  demo: { active: boolean };
}

export const APP_SETTINGS_KEY = "/settings/app";

/** Company name/settings and whether demo data is loaded (shown in the shell). */
export function useAppSettings() {
  return useSWR<AppSettings>(APP_SETTINGS_KEY, (key: string) => apiFetch<AppSettings>(key), {
    revalidateOnFocus: false,
  });
}
