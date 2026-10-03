import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch, ApiError, setSignedOutHandler } from "./client";

const respond = (status: number, body: unknown) =>
  vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(
      new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
    );

afterEach(() => vi.restoreAllMocks());

describe("apiFetch", () => {
  it("calls the same-origin API and returns the parsed body", async () => {
    const fetchSpy = respond(200, { status: "ok" });
    await expect(apiFetch("/health/live")).resolves.toEqual({ status: "ok" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/v1/health/live",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("serialises json bodies", async () => {
    const fetchSpy = respond(201, { id: "c1" });
    await apiFetch("/erp/connections", { method: "POST", json: { name: "Main" } });
    const [, init] = fetchSpy.mock.calls[0];
    expect(init?.body).toBe('{"name":"Main"}');
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("turns the API error envelope into an ApiError", async () => {
    respond(400, {
      error: {
        code: "VALIDATION_FAILED",
        message: "Some fields need attention.",
        fields: [{ field: "baseUrl", message: "must use https" }],
        requestId: "req-1",
      },
    });
    const error = await apiFetch("/x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.code).toBe("VALIDATION_FAILED");
    expect(apiError.fieldMessage("baseUrl")).toBe("must use https");
    expect(apiError.requestId).toBe("req-1");
  });

  it("treats a non-API 5xx page as the service being unavailable", async () => {
    respond(502, "<html>Bad gateway</html>");
    await expect(apiFetch("/x")).rejects.toMatchObject({
      status: 502,
      code: "SERVICE_UNAVAILABLE",
    });
  });

  it("reports network failures with a plain message", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(apiFetch("/x")).rejects.toMatchObject({
      status: 0,
      code: "NETWORK_ERROR",
      message: expect.stringContaining("Can't reach ERPTick"),
    });
  });

  it("lets aborts propagate unchanged", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new DOMException("aborted", "AbortError"));
    await expect(apiFetch("/x")).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("apiFetch session handling", () => {
  const envelope = (status: number, code: string) =>
    new Response(JSON.stringify({ error: { code, message: code } }), { status });
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  it("refreshes once and retries when the access token expired", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(envelope(401, "TOKEN_EXPIRED"))
      .mockResolvedValueOnce(ok({}))
      .mockResolvedValueOnce(ok({ user: "me" }));
    await expect(apiFetch("/auth/me")).resolves.toEqual({ user: "me" });
    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/auth/me",
      "/api/v1/auth/refresh",
      "/api/v1/auth/me",
    ]);
  });

  it("shares one refresh between requests that expire together", async () => {
    let refreshes = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/refresh")) {
        refreshes += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return ok({});
      }
      return refreshes === 0 ? envelope(401, "TOKEN_EXPIRED") : ok({ url });
    });
    await Promise.all([apiFetch("/a"), apiFetch("/b"), apiFetch("/c")]);
    expect(refreshes).toBe(1);
  });

  it("sends the user to sign in when the refresh fails, without looping", async () => {
    const signedOut = vi.fn();
    setSignedOutHandler(signedOut);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(envelope(401, "TOKEN_EXPIRED"))
      .mockResolvedValueOnce(envelope(401, "SESSION_ENDED"));
    await expect(apiFetch("/tickets")).rejects.toMatchObject({ code: "TOKEN_EXPIRED" });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(signedOut).toHaveBeenCalledTimes(1);
  });

  it("leaves 401s alone on the sign-in pages", async () => {
    const signedOut = vi.fn();
    setSignedOutHandler(signedOut);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(envelope(401, "INVALID_CREDENTIALS"));
    await expect(
      apiFetch("/auth/login", { method: "POST", noAuthRedirect: true }),
    ).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
    expect(signedOut).not.toHaveBeenCalled();
  });
});
