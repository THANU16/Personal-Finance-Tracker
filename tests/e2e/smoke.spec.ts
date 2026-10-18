import { expect, test, type Page } from "@playwright/test";

// Sidebar routes (docs/05 §1) and the page heading each one renders.
const ROUTES: [string, string][] = [
  ["/dashboard", "Dashboard"],
  ["/forecast", "Forecast"],
  ["/reports", "Reports"],
  ["/accounts", "Accounts"],
  ["/transactions", "Transactions"],
  ["/recurring", "Recurring"],
  ["/budgets", "Budgets"],
  ["/assets", "Assets"],
  ["/sip", "SIP planner"],
  ["/rebalancing", "Rebalancing"],
  ["/opportunity-fund", "Opportunity Fund"],
  ["/goals", "Goals"],
  ["/debts", "Debts"],
  ["/essentials", "Essentials"],
  ["/notifications", "Notifications"],
  ["/settings", "Settings"],
];

const PASSWORD = "correct-horse-battery";

// Next 16 keeps previously visited pages mounted but hidden (<Activity>), so match visible fields only.
function field(page: Page, label: string, exact = false) {
  return page.getByLabel(label, { exact }).filter({ visible: true });
}

function uniqueEmail() {
  return `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

async function register(page: Page, email: string) {
  await page.goto("/register");
  await field(page, "Name").fill("Nimal Perera");
  await field(page, "Email").fill(email);
  await field(page, "Password", true).fill(PASSWORD);
  await field(page, "Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function logOut(page: Page) {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

test("unauthenticated visits redirect to login and keep the destination", async ({ page }) => {
  await page.goto("/accounts");
  await expect(page).toHaveURL(/\/login\?next=%2Faccounts$/);
  // "/" redirects to /dashboard (next.config) before the proxy sends it to login
  await page.goto("/");
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
});

test("register → every sidebar route renders → log out → log in", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message));

  const email = uniqueEmail();
  await register(page, email);
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible();

  for (const [path, heading] of ROUTES) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  }
  expect(consoleErrors).toEqual([]);

  await logOut(page);
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/login\?next=%2Fsettings$/);

  await field(page, "Email").fill(email);
  await field(page, "Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
});

test("rejects a wrong password and a duplicate registration", async ({ page }) => {
  const email = uniqueEmail();
  await register(page, email);
  await logOut(page);

  await field(page, "Email").fill(email);
  await field(page, "Password").fill("not-the-password");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Incorrect email or password." }),
  ).toBeVisible();

  await page.goto("/register");
  await field(page, "Name").fill("Someone Else");
  await field(page, "Email").fill(email);
  await field(page, "Password", true).fill(PASSWORD);
  await field(page, "Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "already exists" })).toBeVisible();
});

test("settings are created on first login and preferences save", async ({ page }) => {
  await register(page, uniqueEmail());
  await page.goto("/settings");
  const staleDays = field(page, "Stale after (days)");
  await expect(staleDays).toHaveValue("30"); // default created on first login
  await staleDays.fill("45");
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.getByText("Preferences saved")).toBeVisible();
  await page.reload();
  await expect(field(page, "Stale after (days)")).toHaveValue("45");
});

test("hide amounts toggle persists across reloads", async ({ page }) => {
  await register(page, uniqueEmail());
  const html = page.locator("html");
  await expect(html).not.toHaveAttribute("data-hide-amounts", "");
  await page.getByRole("button", { name: "Hide amounts" }).click();
  await expect(html).toHaveAttribute("data-hide-amounts", "");
  await page.reload();
  await expect(html).toHaveAttribute("data-hide-amounts", "");
  await page.getByRole("button", { name: "Show amounts" }).click();
  await expect(html).not.toHaveAttribute("data-hide-amounts", "");
});

test("emergency fund card: manual basis needs an amount and saves with an override", async ({
  page,
}) => {
  await register(page, uniqueEmail());
  await page.goto("/settings");
  await expect(page.getByRole("radio", { name: /Essential expenses/ })).toBeChecked();
  await page.getByRole("radio", { name: /A fixed monthly amount/ }).click();
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Enter a monthly amount" })).toBeVisible();

  await field(page, "Monthly amount", true).fill("150000");
  await field(page, "Fixed target (optional)").fill("1000000");
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.getByText("Preferences saved")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("radio", { name: /A fixed monthly amount/ })).toBeChecked();
  await expect(field(page, "Monthly amount", true)).toHaveValue(/150,?000/);
  await expect(field(page, "Fixed target (optional)")).toHaveValue(/1,?000,?000/);
});
