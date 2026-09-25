import { defineConfig, devices } from "@playwright/test";

/**
 * E2E against the real stack: dev DB (seeded), API and web.
 * Start them yourself (`pnpm dev` at the repo root) or let Playwright start them.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Call the binaries directly, not via `pnpm dev`: pnpm doesn't forward the shutdown signal,
  // which left orphaned dev servers that broke the next run.
  webServer: [
    {
      command: "node_modules/.bin/dotenv -e ../../.env -- node_modules/.bin/nest start --watch",
      cwd: "../api",
      url: "http://localhost:4000/api/health",
      reuseExistingServer: true,
      timeout: 120_000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    },
    {
      command: "node_modules/.bin/dotenv -e ../../.env -- node_modules/.bin/next dev --port 3000",
      url: "http://localhost:3000",
      reuseExistingServer: true,
      timeout: 120_000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    },
  ],
});
