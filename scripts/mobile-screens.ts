/**
 * Mobile audit screenshots (docs/08 phase M0, docs/07 §10).
 *
 * Starts an in-memory MongoDB replica set and `next dev` on port 3200 against it (never the Atlas
 * database in .env.local), registers a throwaway user, loads the onboarding demo data (the same
 * 18-month dataset as `npm run seed`), then visits every route in src/app/(app) at each test
 * viewport and writes:
 *   screens/<viewport>/<route>.png   full-page screenshots
 *   screens/report.json              per page: horizontal overflow, tap targets < 44px,
 *                                    inputs with font-size < 16px, console errors
 *
 * Usage (any shell):
 *   npm run screens
 *   npm run screens -- --routes=dashboard,sip/plans/[id] --viewports=iphone-se-375,desktop-1440
 * (Routes without the leading slash: Git Bash rewrites "/dashboard" into a Windows path.)
 *
 * Stop your own `npm run dev` first if Next refuses to start a second dev server in this folder.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { fixtureRows2025, moneyManagerXlsx } from "../tests/helpers/money-manager-fixture";

const PORT = 3200;
const BASE_URL = `http://localhost:${PORT}`;
const OUT_DIR = path.join(process.cwd(), "screens");
const NEXT_BIN = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
const PASSWORD = "correct-horse-battery";
const MIN_TAP_PX = 44;
const MIN_INPUT_FONT_PX = 16;
/** tsx (esbuild keepNames) wraps named functions in __name(); define it in the page for evaluate(). */
const NAME_SHIM = "globalThis.__name = (fn) => fn;";

interface Viewport {
  name: string;
  width: number;
  height: number;
  mobile: boolean;
}

const VIEWPORTS: Viewport[] = [
  { name: "iphone-se-375", width: 375, height: 667, mobile: true },
  { name: "iphone-15-393", width: 393, height: 852, mobile: true },
  { name: "iphone-15-pro-max-430", width: 430, height: 932, mobile: true },
  { name: "android-360", width: 360, height: 800, mobile: true },
  { name: "desktop-1440", width: 1440, height: 900, mobile: false },
];

/** Every page in src/app/(app). Dynamic segments are resolved from links in the seeded data. */
const ROUTES = [
  "/dashboard",
  "/onboarding",
  "/transactions",
  "/transactions/import",
  "/transactions/import/money-manager/[batchId]",
  "/accounts",
  "/accounts/[id]",
  "/assets",
  "/assets/[id]",
  "/assets/update-values",
  "/assets/import-valuations",
  "/sip",
  "/sip/plans/new",
  "/sip/plans/[id]",
  "/sip/execute/[executionId]",
  "/sip/history",
  "/rebalancing",
  "/opportunity-fund",
  "/debts",
  "/debts/[id]",
  "/recurring",
  "/budgets",
  "/goals",
  "/essentials",
  "/forecast",
  "/reports",
  "/notifications",
  "/settings",
  "/more",
  "/dev/mobile-kit",
];

/**
 * Overlays a route screenshot never shows (sheets, dialogs, menus): opened on a route, captured at
 * viewport size. Filter them like routes, e.g. --routes=quick-add.
 */
interface Overlay {
  name: string;
  route: string;
  mobileOnly?: boolean;
  open: (page: Page) => Promise<void>;
}

const OVERLAYS: Overlay[] = [
  {
    name: "quick-add",
    route: "/dashboard",
    open: async (page) => {
      // Tab bar "+" on phones, top bar "Add" on desktop.
      await page
        .getByRole("button", { name: /^(Add|Quick add)$/ })
        .filter({ visible: true })
        .first()
        .click();
      const sheet = page.getByRole("dialog", { name: "Quick add" });
      // The form loads lazily behind a skeleton; capture it once the amount field is there.
      await sheet.getByLabel("Amount").first().waitFor({ timeout: 60_000 });
    },
  },
  {
    // The top bar's compact title appears only once the page title has scrolled away.
    name: "scrolled-title",
    route: "/accounts",
    open: async (page) => {
      await page.evaluate(() => window.scrollTo(0, 500));
      await page.waitForTimeout(400);
    },
  },
  ...(
    [
      ["kit-form-sheet", "button", "Open form sheet"],
      ["kit-picker", "combobox", "Account"],
      ["kit-action-sheet", "button", "Actions for Cash wallet"],
      ["kit-confirm", "button", "Void…"],
    ] as const
  ).map(([name, role, label]): Overlay => ({
    name,
    route: "/dev/mobile-kit",
    open: async (page) => {
      await page
        .getByRole(role, { name: label, exact: true })
        .filter({ visible: true })
        .first()
        .click();
      await page.waitForTimeout(500);
    },
  })),
  {
    // Quick add "Debt pay" chip (phones): the list of loans to pay.
    name: "quick-add-debt-pay",
    route: "/dashboard",
    mobileOnly: true,
    open: async (page) => {
      await page.getByRole("button", { name: "Quick add", exact: true }).click();
      const sheet = page.getByRole("dialog", { name: "Quick add" });
      await sheet.getByLabel("Amount").first().waitFor({ timeout: 60_000 });
      await sheet.getByRole("button", { name: "Debt pay" }).click();
      await page.waitForTimeout(500);
    },
  },
  {
    // Activity (phones): tap a transaction for its detail sheet.
    name: "txn-detail",
    route: "/transactions",
    mobileOnly: true,
    open: async (page) => {
      await page
        .locator('section[aria-label] ul li button[aria-haspopup="dialog"]')
        .filter({ visible: true })
        .first()
        .click();
      await page.getByRole("dialog").waitFor();
      await page.waitForTimeout(400);
    },
  },
  {
    // Activity (phones): the filter sheet.
    name: "txn-filters",
    route: "/transactions",
    mobileOnly: true,
    open: async (page) => {
      await page
        .getByRole("button", { name: /^Filter/ })
        .filter({ visible: true })
        .first()
        .click();
      await page.getByRole("dialog", { name: "Filters" }).waitFor();
      await page.waitForTimeout(400);
    },
  },
  {
    name: "add-account-dialog",
    route: "/accounts",
    open: async (page) => {
      await page.getByRole("button", { name: "Add account" }).first().click();
      await page.getByRole("dialog").waitFor();
    },
  },
];

/** Where to look for a link that fills each dynamic route. */
const DYNAMIC: Record<string, { pattern: RegExp; sources: string[] }> = {
  "/accounts/[id]": { pattern: /^\/accounts\/([a-f0-9]{24})$/, sources: ["/accounts"] },
  "/assets/[id]": { pattern: /^\/assets\/([a-f0-9]{24})$/, sources: ["/assets"] },
  "/debts/[id]": { pattern: /^\/debts\/([a-f0-9]{24})$/, sources: ["/debts"] },
  "/sip/plans/[id]": { pattern: /^\/sip\/plans\/([a-f0-9]{24})$/, sources: ["/sip"] },
  "/sip/execute/[executionId]": {
    pattern: /^\/sip\/execute\/([a-f0-9]{24})$/,
    sources: ["/sip", "/dashboard", "/sip/history"],
  },
  "/transactions/import/money-manager/[batchId]": {
    pattern: /^\/transactions\/import\/money-manager\/([a-f0-9]{24})$/,
    sources: ["/transactions/import"],
  },
};

interface Finding {
  el: string;
  w: number;
  h: number;
  detail?: string;
}

interface PageAudit {
  status: number | null;
  finalPath: string;
  screenshot: string;
  scrollWidth: number;
  clientWidth: number;
  horizontalOverflowPx: number;
  overflowOffenders: Finding[];
  smallTapTargets: { count: number; items: Finding[] };
  smallInputs: { count: number; items: Finding[] };
  consoleErrors: string[];
}

function arg(name: string): string[] | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit
    ?.slice(name.length + 3)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const fileName = (route: string) =>
  route.replace(/^\//, "").replace(/[[\]]/g, "").replace(/\//g, "-") || "root";

function killTree(child: ChildProcess | undefined) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}

async function waitForServer(child: ChildProcess, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `next dev exited with code ${child.exitCode}. If your own dev server is running, stop it and retry.`,
      );
    }
    try {
      const res = await fetch(`${BASE_URL}/login`);
      if (res.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`next dev did not answer on ${BASE_URL} within ${timeoutMs / 1000}s`);
}

/** Registers a fresh user and loads the onboarding demo data; returns the signed-in context. */
async function createSeededUser(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(120_000);
  const field = (label: string, exact = false) =>
    page.getByLabel(label, { exact }).filter({ visible: true });

  await page.goto(`${BASE_URL}/register`);
  await field("Name").fill("Mobile Audit");
  await field("Email").fill(`mobile-audit-${Date.now()}@example.com`);
  await field("Password", true).fill(PASSWORD);
  await field("Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/onboarding$/);

  console.log("Loading demo data (18 months)…");
  await page.getByRole("button", { name: "Load demo data" }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 600_000 });
  await page.close();
  return context;
}

/**
 * Uploads the e2e Money Manager fixture (not imported, just a draft batch) so the import wizard
 * at /transactions/import/money-manager/[batchId] has something to show.
 */
async function uploadMoneyManagerFixture(context: BrowserContext) {
  const page = await context.newPage();
  page.setDefaultTimeout(120_000);
  await page.goto(`${BASE_URL}/transactions/import`);
  await page.getByLabel("Money Manager export (.xlsx)").setInputFiles({
    name: "2025.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: await moneyManagerXlsx(fixtureRows2025()),
  });
  await page.getByRole("button", { name: "Upload and continue" }).click();
  await page.waitForURL(/\/transactions\/import\/money-manager\/[a-f0-9]{24}$/);
  await page.close();
}

async function resolveDynamic(context: BrowserContext): Promise<Record<string, string | null>> {
  const page = await context.newPage();
  page.setDefaultTimeout(120_000);
  const hrefsBySource = new Map<string, string[]>();
  const hrefs = async (source: string) => {
    const cached = hrefsBySource.get(source);
    if (cached) return cached;
    await page.goto(`${BASE_URL}${source}`, { waitUntil: "networkidle" }).catch(() => undefined);
    const found = await page.$$eval("a[href]", (as) =>
      as.map((a) => new URL((a as HTMLAnchorElement).href).pathname),
    );
    hrefsBySource.set(source, found);
    return found;
  };

  const resolved: Record<string, string | null> = {};
  for (const [route, { pattern, sources }] of Object.entries(DYNAMIC)) {
    resolved[route] = null;
    for (const source of sources) {
      const hit = (await hrefs(source)).find((h) => pattern.test(h));
      if (hit) {
        resolved[route] = hit;
        break;
      }
    }
  }
  await page.close();
  return resolved;
}

/** Runs in the browser: overflow, tap targets and input font sizes. */
function measure(limits: { minTap: number; minFont: number }) {
  const describe = (el: Element) => {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : "";
    const cls =
      typeof el.className === "string" && el.className
        ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".")
        : "";
    const label =
      el.getAttribute("aria-label") ??
      el.getAttribute("name") ??
      el.getAttribute("placeholder") ??
      (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
    return `${tag}${id}${cls}${label ? ` "${label}"` : ""}`;
  };
  // Visually hidden helpers (sr-only inputs, Base UI's hidden form inputs) are not tap targets.
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 2 || r.height <= 2) return false;
    if (el.getAttribute("aria-hidden") === "true" || el.id.endsWith("-hidden-input")) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0;
  };
  const doc = document.documentElement;
  const clientWidth = doc.clientWidth;

  // Elements sticking out past the right edge, outermost only, ignoring ones inside a scroller.
  const clippedByAncestor = (el: Element) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === "auto" || ox === "scroll" || ox === "hidden" || ox === "clip") return true;
    }
    return false;
  };
  const inFixed = (el: Element) => {
    for (let p: Element | null = el; p && p !== document.body; p = p.parentElement) {
      if (getComputedStyle(p).position === "fixed") return true;
    }
    return false;
  };
  // Invisible elements count too: a hidden chart tooltip still widens the page. Fixed bars only
  // stretch to the widened layout viewport, so they are a symptom, not a cause.
  const sticking = Array.from(document.body.querySelectorAll("*")).filter((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0) return false; // zero-height rows still widen the page
    if (inFixed(el)) return false;
    return r.right > clientWidth + 1 && !clippedByAncestor(el);
  });
  const stickingSet = new Set(sticking);
  const overflowOffenders = sticking
    .filter((el) => !el.parentElement || !stickingSet.has(el.parentElement))
    .slice(0, 15)
    .map((el) => {
      const r = el.getBoundingClientRect();
      return {
        el: describe(el),
        w: Math.round(r.width),
        h: Math.round(r.height),
        detail: `right=${Math.round(r.right)}${visible(el) ? "" : " [hidden]"}`,
      };
    });
  // Nothing obvious: list the rightmost elements unfiltered so the cause is always visible.
  if (overflowOffenders.length === 0 && doc.scrollWidth > clientWidth) {
    const rightmost = Array.from(document.body.querySelectorAll("*"))
      .filter((el) => !inFixed(el))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .sort((a, b) => b.r.right - a.r.right)
      .slice(0, 5);
    for (const { el, r } of rightmost) {
      overflowOffenders.push({
        el: describe(el),
        w: Math.round(r.width),
        h: Math.round(r.height),
        detail: `right=${Math.round(r.right)} [rightmost${clippedByAncestor(el) ? ", clipped" : ""}]`,
      });
    }
  }

  const tappable = Array.from(
    document.querySelectorAll(
      "a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=option], [role=checkbox], [role=switch], [role=radio], [role=menuitem], [role=combobox], [role=link]",
    ),
  ).filter(visible);
  // Small controls (Switch, Radio, Checkbox) reach 44px with an absolutely positioned ::after
  // (negative insets); count that hit area instead of the visible box.
  const hitArea = (el: Element) => {
    const r = el.getBoundingClientRect();
    const a = getComputedStyle(el, "::after");
    if (a.content === "none" || a.position !== "absolute") return r;
    const px = (v: string) => (v.endsWith("px") ? parseFloat(v) : 0);
    const left = Math.min(0, px(a.left));
    const top = Math.min(0, px(a.top));
    const right = Math.min(0, px(a.right));
    const bottom = Math.min(0, px(a.bottom));
    return { width: r.width - left - right, height: r.height - top - bottom };
  };
  const smallTaps = tappable
    .map((el) => ({ el, r: hitArea(el) }))
    .filter(({ r }) => r.width < limits.minTap || r.height < limits.minTap)
    .map(({ el, r }) => ({ el: describe(el), w: Math.round(r.width), h: Math.round(r.height) }));

  const inputs = Array.from(
    document.querySelectorAll(
      "input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=file]), select, textarea, [contenteditable=true]",
    ),
  ).filter(visible);
  const smallInputs = inputs
    .map((el) => ({ el, fs: parseFloat(getComputedStyle(el).fontSize) }))
    .filter(({ fs }) => fs < limits.minFont)
    .map(({ el, fs }) => {
      const r = el.getBoundingClientRect();
      return {
        el: describe(el),
        w: Math.round(r.width),
        h: Math.round(r.height),
        detail: `font-size=${fs}px`,
      };
    });

  return {
    scrollWidth: doc.scrollWidth,
    clientWidth,
    overflowOffenders,
    smallTaps,
    smallInputs,
  };
}

async function auditPage(
  page: Page,
  url: string,
  shotPath: string,
  open?: (page: Page) => Promise<void>,
): Promise<PageAudit> {
  const consoleErrors: string[] = [];
  const onConsole = (m: { type(): string; text(): string }) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 500));
  };
  const onPageError = (e: Error) => consoleErrors.push(`pageerror: ${e.message.slice(0, 500)}`);
  page.on("console", onConsole);
  page.on("pageerror", onPageError);

  const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts.ready).catch(() => undefined);
  await page.waitForTimeout(800); // chart entry animations
  if (open) {
    await open(page);
    await page.waitForTimeout(400); // sheet/dialog entry animation
  }

  const m = await page.evaluate(measure, { minTap: MIN_TAP_PX, minFont: MIN_INPUT_FONT_PX });
  await page.screenshot({ path: shotPath, fullPage: !open });

  page.off("console", onConsole);
  page.off("pageerror", onPageError);
  return {
    status: res?.status() ?? null,
    finalPath: new URL(page.url()).pathname + new URL(page.url()).search,
    screenshot: path.relative(process.cwd(), shotPath).replace(/\\/g, "/"),
    scrollWidth: m.scrollWidth,
    clientWidth: m.clientWidth,
    horizontalOverflowPx: Math.max(0, m.scrollWidth - m.clientWidth),
    overflowOffenders: m.overflowOffenders,
    smallTapTargets: { count: m.smallTaps.length, items: m.smallTaps.slice(0, 40) },
    smallInputs: { count: m.smallInputs.length, items: m.smallInputs.slice(0, 40) },
    consoleErrors,
  };
}

async function main() {
  const onlyRoutes = arg("routes");
  const onlyViewports = arg("viewports");
  const routes = onlyRoutes
    ? ROUTES.filter((r) => onlyRoutes.some((o) => o.replace(/^\//, "") === r.slice(1)))
    : ROUTES;
  const overlays = onlyRoutes ? OVERLAYS.filter((o) => onlyRoutes.includes(o.name)) : OVERLAYS;
  const viewports = onlyViewports
    ? VIEWPORTS.filter((v) => onlyViewports.includes(v.name))
    : VIEWPORTS;
  if (routes.length + overlays.length === 0 || viewports.length === 0) {
    console.error("No route or viewport matches the filters. Routes:", ROUTES.join(" "));
    process.exit(1);
  }

  console.log("Starting in-memory MongoDB replica set…");
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ launchTimeout: 60_000 }],
  });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MONGODB_URI: replSet.getUri("wealthtrack-screens"),
    BETTER_AUTH_URL: BASE_URL,
    APP_URL: BASE_URL,
    DISABLE_SIGNUP: "false",
    AUTH_RATE_LIMIT: "off",
    RESEND_API_KEY: "",
    REQUIRE_EMAIL_VERIFICATION: "false",
  };

  let server: ChildProcess | undefined;
  let browser: Browser | undefined;
  const cleanup = async () => {
    await browser?.close().catch(() => undefined);
    killTree(server);
    await replSet.stop().catch(() => undefined);
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => void cleanup().then(() => process.exit(130)));
  }

  try {
    console.log(`Starting next dev on ${BASE_URL} (log: screens/next-dev.log)…`);
    // A full run replaces the previous one; a filtered run only overwrites what it covers.
    if (!onlyRoutes && !onlyViewports) rmSync(OUT_DIR, { recursive: true, force: true });
    mkdirSync(OUT_DIR, { recursive: true });
    const devLog = createWriteStream(path.join(OUT_DIR, "next-dev.log"));
    server = spawn(process.execPath, [NEXT_BIN, "dev", "--port", String(PORT)], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout?.pipe(devLog);
    server.stderr?.pipe(devLog);
    await waitForServer(server, 300_000);

    browser = await chromium.launch();
    const authContext = await createSeededUser(browser);
    const storageState = await authContext.storageState();
    await uploadMoneyManagerFixture(authContext);
    const dynamic = await resolveDynamic(authContext);
    await authContext.close();

    const report: {
      generatedAt: string;
      baseUrl: string;
      thresholds: { minTapPx: number; minInputFontPx: number };
      dynamicRoutes: Record<string, string | null>;
      viewports: Viewport[];
      pages: Record<string, Record<string, PageAudit | { skipped: string }>>;
    } = {
      generatedAt: new Date().toISOString(),
      baseUrl: BASE_URL,
      thresholds: { minTapPx: MIN_TAP_PX, minInputFontPx: MIN_INPUT_FONT_PX },
      dynamicRoutes: dynamic,
      viewports,
      pages: {},
    };

    for (const vp of viewports) {
      const dir = path.join(OUT_DIR, vp.name);
      mkdirSync(dir, { recursive: true });
      const context = await browser.newContext({
        storageState,
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: vp.mobile ? 2 : 1,
        isMobile: vp.mobile,
        hasTouch: vp.mobile,
      });
      await context.addInitScript(NAME_SHIM);
      const page = await context.newPage();
      report.pages[vp.name] = {};
      const jobs = [
        ...routes.map((route) => ({
          key: route,
          target: route in DYNAMIC ? dynamic[route] : route,
          file: fileName(route),
          open: undefined as Overlay["open"] | undefined,
        })),
        ...overlays
          .filter((o) => vp.mobile || !o.mobileOnly)
          .map((o) => ({ key: `@${o.name}`, target: o.route, file: `@${o.name}`, open: o.open })),
      ];
      for (const { key: route, target, file, open } of jobs) {
        if (!target) {
          report.pages[vp.name][route] = { skipped: "no seeded record links to this route" };
          continue;
        }
        process.stdout.write(`${vp.name} ${route} … `);
        try {
          const audit = await auditPage(
            page,
            `${BASE_URL}${target}`,
            path.join(dir, `${file}.png`),
            open,
          );
          report.pages[vp.name][route] = audit;
          console.log(
            `overflow ${audit.horizontalOverflowPx}px · small taps ${audit.smallTapTargets.count} · small inputs ${audit.smallInputs.count} · errors ${audit.consoleErrors.length}`,
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          report.pages[vp.name][route] = { skipped: `failed: ${message.slice(0, 300)}` };
          console.log(`FAILED (${message.split("\n")[0]})`);
        }
      }
      await context.close();
    }

    const reportPath = path.join(OUT_DIR, "report.json");
    // A filtered run updates its pages in the previous report instead of replacing it.
    if ((onlyRoutes || onlyViewports) && existsSync(reportPath)) {
      const previous = JSON.parse(readFileSync(reportPath, "utf8")) as typeof report;
      for (const [vp, pages] of Object.entries(report.pages)) {
        previous.pages[vp] = { ...previous.pages[vp], ...pages };
      }
      previous.generatedAt = report.generatedAt;
      report.pages = previous.pages;
      report.viewports = previous.viewports;
    }
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\nDone: ${path.join(OUT_DIR, "report.json")}`);
  } finally {
    await cleanup();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
