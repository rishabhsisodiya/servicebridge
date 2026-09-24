import { render, screen } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as health from "@/lib/api/health";
import { SystemStatus } from "./system-status";

// Fresh SWR cache per test so results don't leak between cases.
const renderStatus = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <SystemStatus />
    </SWRConfig>,
  );

afterEach(() => vi.restoreAllMocks());

describe("SystemStatus", () => {
  it("shows each dependency's state", async () => {
    vi.spyOn(health, "getReadiness").mockResolvedValue({
      status: "error",
      checks: {
        database: { status: "up", latencyMs: 3 },
        redis: { status: "down", latencyMs: 2000 },
      },
    });
    renderStatus();
    expect(await screen.findByText("Up · 3 ms")).toBeInTheDocument();
    expect(screen.getByText("Down")).toBeInTheDocument();
  });

  it("explains what to do when the API can't be reached", async () => {
    vi.spyOn(health, "getReadiness").mockRejectedValue(new Error("offline"));
    renderStatus();
    expect(await screen.findByRole("alert")).toHaveTextContent("API_INTERNAL_URL");
  });
});
