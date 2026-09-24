import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const STUB_API_PORT = 4599;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node e2e/stub-api.mjs",
      env: { STUB_API_PORT: String(STUB_API_PORT) },
      port: STUB_API_PORT,
      reuseExistingServer: false,
    },
    {
      // Tests run against a production build, as the Next.js docs recommend.
      command: `npm run build && npx next start -p ${PORT}`,
      env: { API_INTERNAL_URL: `http://127.0.0.1:${STUB_API_PORT}` },
      url: `http://127.0.0.1:${PORT}`,
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
