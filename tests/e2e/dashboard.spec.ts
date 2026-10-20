import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "correct-horse-battery";

const field = (page: Page, label: string, exact = false) =>
  page.getByLabel(label, { exact }).filter({ visible: true });

async function register(page: Page) {
  await page.goto("/register");
  await field(page, "Name").fill("Dash Tester");
  await field(page, "Email").fill(
    `dash-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
  );
  await field(page, "Password", true).fill(PASSWORD);
  await field(page, "Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
}

async function addAccount(page: Page, name: string, opening: string) {
  await page.goto("/accounts");
  await page.getByRole("button", { name: "Add account" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Balance on opening date").fill(opening);
  await dialog.getByRole("button", { name: "Add account" }).click();
  await expect(page.getByText(`${name} added`)).toBeVisible();
}

const bar = (page: Page) => page.getByTestId("time-range-bar");

test("time range: presets, granularity and custom range update the charts; reload restores the view", async ({
  page,
}) => {
  await register(page);
  await addAccount(page, "Commercial Bank", "350000");
  await page.locator("body").press("n");
  const sheet = page.getByRole("dialog", { name: "Quick add" });
  await sheet.getByLabel("Amount").fill("12000");
  await field(page, "Category", true).click();
  await page.getByRole("option", { name: /Groceries/ }).click();
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Expense saved")).toBeVisible();

  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  // default 6M → weekly buckets
  await expect(bar(page).getByRole("button", { name: "6M", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(bar(page).getByRole("button", { name: "Week", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText("Net worth trend")).toBeVisible();
  await expect(page.getByText("Top expense categories")).toBeVisible();
  await expect(page.getByRole("link", { name: /Food & Dining/ })).toBeVisible();

  // preset 30D → daily buckets, 30 of them
  await bar(page).getByRole("button", { name: "30D", exact: true }).click();
  await expect(page).toHaveURL(/r=30d/);
  await expect(bar(page).getByRole("button", { name: "Day", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(bar(page)).toContainText("30 days");

  // granularity override → week
  await bar(page).getByRole("button", { name: "Week", exact: true }).click();
  await expect(page).toHaveURL(/g=week/);
  await expect(bar(page)).toContainText(/\d+ weeks?/);

  // compare on
  await bar(page).getByRole("switch").click();
  await expect(page).toHaveURL(/cmp=1/);
  await expect(page.getByText("Previous period").first()).toBeVisible();

  // custom range via the URL-backed popover
  await bar(page).getByRole("button", { name: "Custom", exact: true }).click();
  await page.getByRole("button", { name: "Apply range" }).click();
  await expect(page).toHaveURL(/r=custom/);
  // the popover starts from the range on screen (30D), not the default 6M
  const u = new URL(page.url());
  const days =
    (Date.parse(u.searchParams.get("to")!) - Date.parse(u.searchParams.get("from")!)) / 86_400_000;
  expect(days).toBe(29);

  // reload keeps everything
  const url = page.url();
  await page.reload();
  await expect(page).toHaveURL(url);
  await expect(bar(page).getByRole("button", { name: /–/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(bar(page).getByRole("switch")).toBeChecked();

  // month view from the URL directly
  await page.goto("/dashboard?r=1y&g=month");
  await expect(bar(page).getByRole("button", { name: "Month", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(bar(page)).toContainText("13 months");

  // table view of the net worth chart lists the buckets
  await page.getByRole("button", { name: "Show table" }).first().click();
  await expect(page.getByRole("table", { name: "Net worth trend" })).toBeVisible();
});

test("cash bar and safe to spend follow earmarks", async ({ page }) => {
  await register(page);
  await addAccount(page, "Commercial Bank", "350000");
  await page.getByRole("button", { name: "Actions for Commercial Bank" }).click();
  await page.getByRole("menuitem", { name: "Earmark / move" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: "Opportunity" }).click();
  await dialog.getByLabel("Amount", { exact: true }).fill("300000");
  await dialog.getByRole("button", { name: "Save earmark" }).click();
  await expect(page.getByText("Earmark saved")).toBeVisible();

  await page.goto("/dashboard");
  await expect(
    page.getByRole("img", {
      name: "Emergency LKR 0.00, Opportunity LKR 300,000.00, Free LKR 50,000.00",
    }),
  ).toBeVisible();
  await expect(page.getByText("Safe to spend")).toBeVisible();
  await expect(page.getByText("LKR 50,000.00").first()).toBeVisible();
});
