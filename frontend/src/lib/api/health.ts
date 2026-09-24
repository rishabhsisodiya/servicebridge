import { API_BASE, ApiError } from "./client";

export type DependencyStatus = "up" | "down";

export interface Readiness {
  status: "ok" | "error";
  checks: Record<"database" | "redis", { status: DependencyStatus; latencyMs: number }>;
}

/**
 * Readiness answers 200 or 503 with the same report shape, so it can't go
 * through apiFetch (which treats any non-2xx as an error).
 */
export async function getReadiness(): Promise<Readiness> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/health/ready`, { cache: "no-store" });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "Can't reach ServiceBridge.");
  }
  const body: unknown = await response.json().catch(() => undefined);
  if (typeof body === "object" && body !== null && "checks" in body) {
    return body as Readiness;
  }
  throw new ApiError(response.status, "SERVICE_UNAVAILABLE", "The API is not responding.");
}
