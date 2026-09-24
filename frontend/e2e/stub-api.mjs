// Minimal stand-in for the ServiceBridge API so the e2e suite can verify the
// Next.js proxy without Postgres or Redis.
import { createServer } from "node:http";

const port = Number(process.env.STUB_API_PORT ?? 4599);

createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  if (req.url === "/api/v1/health/ready") {
    res.end(
      JSON.stringify({
        status: "ok",
        checks: { database: { status: "up", latencyMs: 4 }, redis: { status: "up", latencyMs: 1 } },
      }),
    );
    return;
  }
  if (req.url?.startsWith("/api/v1/echo")) {
    res.end(JSON.stringify({ path: req.url, cookie: req.headers.cookie ?? null }));
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: { code: "NOT_FOUND", message: "Not found" } }));
}).listen(port, "127.0.0.1");
