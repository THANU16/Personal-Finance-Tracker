import { defineConfig, devices } from "@playwright/test";

// e2e runs its own dev server on 3100 against an in-memory MongoDB (scripts/e2e-server.ts).
const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  timeout: 60_000,
  // First login seeds the account and renders the whole dashboard on a production build; 5 s was
  // too tight on a busy dev machine.
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npx tsx scripts/e2e-server.ts",
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    timeout: 300_000, // includes `next build`
    stdout: "ignore",
    stderr: "pipe",
  },
});
