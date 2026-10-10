import { defineConfig, devices } from "@playwright/test";

/**
 * Real-mouse regression suite for the course board (spec 014 "Testing").
 *
 * No `webServer` block on purpose: whoever runs the suite owns the dev server
 * (`npm run dev`), and the suite points at it through E2E_BASE_URL.
 *
 *   npm run test:e2e                                  # against http://localhost:5173
 *   E2E_BASE_URL=http://localhost:4173 npm run test:e2e
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  // One worker: every test signs in as a fresh anonymous user against the live
  // Firebase project, and parallel runs on Windows collided on test-results/.
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 7_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5173",
    viewport: { width: 1600, height: 1000 },
    trace: "retain-on-first-failure",
    screenshot: "only-on-failure",
    actionTimeout: 15_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1600, height: 1000 } },
    },
  ],
});
