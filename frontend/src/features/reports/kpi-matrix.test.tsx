/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { KpiMatrixScreen } from "./kpi-matrix";

const swrState: { hook: (key: string | null) => unknown } = {
  hook: () => ({ data: null, error: undefined, isLoading: true }),
};

vi.mock("swr", () => ({
  default: (key: string | null) => swrState.hook(key),
}));

const sessionState: { allowed: boolean } = { allowed: true };

vi.mock("@/lib/auth/session", () => ({
  useSession: () => ({
    can: (p: string) => (p === "reports.read" ? sessionState.allowed : false),
    me: { id: "u1", name: "A" },
  }),
}));

vi.mock("@/lib/api/client", () => ({
  apiFetch: vi.fn(),
  ApiError: class extends Error {},
}));

const matrix = {
  from: "2026-08-31",
  to: "2026-09-29",
  rows: [
    {
      regionId: null,
      regionName: "All regions",
      kpis: [
        {
          key: "sla-compliance",
          label: "SLA compliance",
          value: 96.5,
          target: 95,
          unit: "%",
          better: "higher",
          met: true,
        },
        {
          key: "avg-resolution-hours",
          label: "Avg resolution time",
          value: 52,
          target: 48,
          unit: "hrs",
          better: "lower",
          met: false,
        },
      ],
    },
  ],
};

describe("KpiMatrixScreen", () => {
  beforeEach(() => {
    sessionState.allowed = true;
    swrState.hook = (key) =>
      String(key).includes("/reports/kpi?")
        ? { data: matrix, error: undefined, isLoading: false }
        : { data: null, error: undefined, isLoading: false };
  });

  it("marks on-target and off-target KPIs", () => {
    render(<KpiMatrixScreen />);

    expect(screen.getByText("All regions")).toBeInTheDocument();
    expect(screen.getByText("On target")).toBeInTheDocument();
    expect(screen.getByText("Off target")).toBeInTheDocument();
    expect(screen.getByText("96.5 %")).toBeInTheDocument();
  });

  it("shows the access notice without reports.read", () => {
    sessionState.allowed = false;
    render(<KpiMatrixScreen />);
    expect(screen.getByText("You don't have access to this")).toBeInTheDocument();
  });
});
