/**
 * docs/07 §8 performance check: builds the app, runs `next start` on port 3300 against an in-memory
 * MongoDB replica set (never the Atlas database in .env.local), seeds one user with the 18-month
 * demo data and measures on an iPhone-sized page with Lighthouse's mobile throttling
 * (150 ms RTT, 1.6 Mbps down, 4× CPU):
 *   - cold load of /dashboard (empty cache): first byte, LCP, CLS, JS transferred
 *   - tab switches from the tab bar (Activity, Invest, More, Home): time until the page's <h1>
 * Results print as a table and go to screens/perf.json.
 *
 * Usage: npm run perf:mobile            (PERF_SKIP_BUILD=1 reuses the last `next build`)
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { chromium, type BrowserContext, type Page } from "@playwright/test";

const PORT = 3300;
const BASE_URL = `http://localhost:${PORT}`;
const NEXT_BIN = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
const EMAIL = `mobile-perf-${Date.now()}@example.com`;
const PASSWORD = "perf-check-password-1";
const RUNS = 3;
/** tsx (esbuild keepNames) wraps named functions in __name(); define it in the page for evaluate(). */
const NAME_SHIM = "globalThis.__name = (fn) => fn;";

const IPHONE = {
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
};

function runNext(args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  return spawn(process.execPath, [NEXT_BIN, ...args], { stdio: "inherit", env });
}

async function waitForServer(timeoutMs: number) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      if ((await fetch(`${BASE_URL}/login`)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("next start did not come up");
}

async function register(context: BrowserContext) {
  const page = await context.newPage();
  page.setDefaultTimeout(120_000);
  const field = (label: string, exact = false) =>
    page.getByLabel(label, { exact }).filter({ visible: true });
  await page.goto(`${BASE_URL}/register`);
  await field("Name").fill("Mobile Perf");
  await field("Email").fill(EMAIL);
  await field("Password", true).fill(PASSWORD);
  await field("Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/onboarding$/);
  await page.close();
}

/** Demo data is development-only in the app, so the script seeds it directly (like `npm run seed`). */
async function seed(env: NodeJS.ProcessEnv) {
  // The app's env schema needs the .env.local keys; the in-memory database URI wins.
  loadEnvConfig(process.cwd());
  Object.assign(process.env, env);
  const { connectDb, disconnectDb } = await import("../src/server/db/connect");
  const { ensureUserSetup } = await import("../src/server/bootstrap");
  const { utcToBusinessDate } = await import("../src/domain/dates");
  const { findUserIdByEmail, seedDemoData } = await import("../src/server/seed/demo");
  const { completeOnboarding } = await import("../src/modules/settings/onboarding");
  await connectDb();
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const db = mongoose.connection.db;
  if (!db) throw new Error("No database connection");
  const userId = await findUserIdByEmail(db, EMAIL);
  if (!userId) throw new Error("Registered user not found");
  const settings = await ensureUserSetup(userId);
  const ctx = { userId, tz: settings.timezone, baseCurrency: settings.baseCurrency };
  await seedDemoData(ctx, utcToBusinessDate(new Date(), ctx.tz));
  await completeOnboarding(ctx);
  await disconnectDb();
}

async function throttle(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
}

const OBSERVE = `
  window.__perf = { lcp: 0, cls: 0, shifts: [] };
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.lcp = e.startTime; })
    .observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) {
      if (e.hadRecentInput) continue;
      window.__perf.cls += e.value;
      for (const s of e.sources ?? []) {
        const n = s.node;
        const name = n && n.nodeType === 1
          ? n.tagName.toLowerCase() + "." + String(n.className).split(" ").slice(0, 4).join(".")
          : String(n?.nodeName);
        window.__perf.shifts.push({ at: Math.round(e.startTime), value: Number(e.value.toFixed(4)), node: name.slice(0, 90) });
      }
    }
  }).observe({ type: "layout-shift", buffered: true });
`;

interface ColdLoad {
  ttfbMs: number;
  lcpMs: number;
  loadMs: number;
  cls: number;
  jsKb: number;
  shifts: { at: number; value: number; node: string }[];
}

async function coldLoad(context: BrowserContext): Promise<ColdLoad> {
  const page = await context.newPage();
  await throttle(page);
  await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "load", timeout: 120_000 });
  // Let late chunks, charts and shifts settle before reading the numbers.
  await page.waitForLoadState("networkidle", { timeout: 120_000 });
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    const js = performance
      .getEntriesByType("resource")
      .filter((e) => (e as PerformanceResourceTiming).initiatorType === "script")
      .reduce((s, e) => s + (e as PerformanceResourceTiming).transferSize, 0);
    const w = window as unknown as {
      __perf: { lcp: number; cls: number; shifts: { at: number; value: number; node: string }[] };
    };
    return {
      ttfbMs: nav.responseStart,
      loadMs: nav.loadEventEnd,
      lcpMs: w.__perf.lcp,
      cls: w.__perf.cls,
      jsKb: js / 1024,
      shifts: w.__perf.shifts,
    };
  });
  await page.close();
  return r;
}

const TABS: { name: string; heading: RegExp }[] = [
  { name: "Activity", heading: /^Transactions$/ },
  { name: "Invest", heading: /^Assets$/ },
  { name: "More", heading: /^More$/ },
  { name: "Home", heading: /^Dashboard$/ },
];

async function tabSwitches(context: BrowserContext): Promise<Record<string, number>> {
  const page = await context.newPage();
  await throttle(page);
  await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "load", timeout: 120_000 });
  await page.waitForLoadState("networkidle", { timeout: 120_000 });
  const out: Record<string, number> = {};
  const nav = page.getByRole("navigation", { name: "Primary" }).filter({ visible: true });
  for (const tab of TABS) {
    const start = Date.now();
    await nav.getByRole("link", { name: tab.name, exact: true }).click();
    await page
      .getByRole("heading", { level: 1, name: tab.heading })
      .first()
      .waitFor({ timeout: 60_000 });
    out[tab.name] = Date.now() - start;
    await page.waitForLoadState("networkidle", { timeout: 60_000 });
  }
  await page.close();
  return out;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function main() {
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ launchTimeout: 60_000 }],
  });
  const uri = replSet.getUri("wealthtrack-perf");
  const env = {
    ...process.env,
    MONGODB_URI: uri,
    BETTER_AUTH_URL: BASE_URL,
    APP_URL: BASE_URL,
    DISABLE_SIGNUP: "false",
    AUTH_RATE_LIMIT: "off",
    RESEND_API_KEY: "",
    REQUIRE_EMAIL_VERIFICATION: "false",
  };
  let server: ChildProcess | undefined;
  const browser = await chromium.launch();
  try {
    if (process.env.PERF_SKIP_BUILD !== "1") {
      const build = runNext(["build"], env);
      const code = await new Promise<number>((r) => build.on("exit", (c) => r(c ?? 1)));
      if (code !== 0) throw new Error(`next build failed (${code})`);
    }
    server = runNext(["start", "--port", String(PORT)], env);
    await waitForServer(120_000);

    const context = await browser.newContext(IPHONE);
    await context.addInitScript(NAME_SHIM);
    await register(context);
    console.log("Seeding demo data (18 months)…");
    await seed(env);
    const { cookies } = await context.storageState();

    const loads: ColdLoad[] = [];
    for (let i = 0; i < RUNS; i++) {
      // A fresh context per run: empty HTTP cache and no service worker, only the session cookie.
      const cold = await browser.newContext(IPHONE);
      await cold.addInitScript(NAME_SHIM);
      await cold.addInitScript(OBSERVE);
      await cold.addCookies(cookies);
      loads.push(await coldLoad(cold));
      await cold.close();
    }
    await context.addInitScript(OBSERVE);
    const tabs = await tabSwitches(context);

    const summary = {
      measuredAt: new Date().toISOString(),
      throttling: "150 ms RTT, 1.6 Mbps down, 750 Kbps up, 4x CPU, 393x852 @3x",
      dashboardColdLoad: {
        ttfbMs: Math.round(median(loads.map((l) => l.ttfbMs))),
        lcpMs: Math.round(median(loads.map((l) => l.lcpMs))),
        loadMs: Math.round(median(loads.map((l) => l.loadMs))),
        cls: Number(median(loads.map((l) => l.cls)).toFixed(3)),
        jsKb: Math.round(median(loads.map((l) => l.jsKb))),
        runs: loads,
      },
      tabSwitchMs: tabs,
    };
    mkdirSync("screens", { recursive: true });
    writeFileSync("screens/perf.json", JSON.stringify(summary, null, 2));
    console.table({ ...summary.dashboardColdLoad, runs: undefined });
    console.table(tabs);
  } finally {
    await browser.close();
    server?.kill();
    await replSet.stop();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
