/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { SchedulesScreen } from "./schedules";

const swrState: { schedules: unknown[] } = { schedules: [] };

vi.mock("swr", () => ({
  default: (key: string | null) => {
    if (String(key).includes("/report-schedules"))
      return { data: swrState.schedules, error: undefined, isLoading: false, mutate: vi.fn() };
    if (String(key).includes("/reports"))
      return { data: [], error: undefined, isLoading: false };
    return { data: null, error: undefined, isLoading: true };
  },
}));

const sessionState: { allowed: boolean } = { allowed: true };

vi.mock("@/lib/auth/session", () => ({
  useSession: () => ({
    can: (p: string) => (p === "reports.schedule" ? sessionState.allowed : false),
    me: { id: "u1", name: "A" },
  }),
}));

vi.mock("@/lib/api/client", () => ({
  apiFetch: vi.fn(),
  ApiError: class extends Error {},
}));

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

describe("SchedulesScreen", () => {
  beforeEach(() => {
    sessionState.allowed = true;
    swrState.schedules = [];
  });

  it("invites creating the first schedule", () => {
    render(<SchedulesScreen />);
    expect(screen.getByText("No scheduled reports yet")).toBeInTheDocument();
  });

  it("renders schedules with their cron", () => {
    swrState.schedules = [
      {
        id: "s1",
        name: "Weekly SLA digest",
        reportKey: "sla-compliance",
        params: {},
        cron: "0 8 * * 1",
        timezone: "Asia/Kolkata",
        recipients: ["a@example.com"],
        active: true,
        lastRunAt: null,
        createdBy: null,
        version: 1,
        createdAt: "2026-09-29T00:00:00Z",
      },
    ];
    render(<SchedulesScreen />);
    expect(screen.getByText("Weekly SLA digest")).toBeInTheDocument();
    expect(screen.getByText("0 8 * * 1")).toBeInTheDocument();
  });

  it("shows the access notice without reports.schedule", () => {
    sessionState.allowed = false;
    render(<SchedulesScreen />);
    expect(screen.getByText("You don't have access to this")).toBeInTheDocument();
  });
});
