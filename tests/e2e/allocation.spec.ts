import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "correct-horse-battery";
const field = (page: Page, label: string, exact = false) =>
  page.getByLabel(label, { exact }).filter({ visible: true });

async function register(page: Page) {
  await page.goto("/register");
  await field(page, "Name").fill("Allocation Tester");
  await field(page, "Email").fill(
    `alloc-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
  );
  await field(page, "Password", true).fill(PASSWORD);
  await field(page, "Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function addBank(page: Page) {
  await page.goto("/accounts");
  await page.getByRole("button", { name: "Add account" }).first().click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Name").fill("Sampath Savings");
  await d.getByLabel("Balance on opening date").fill("500000");
  await d.getByRole("button", { name: "Add account" }).click();
  await expect(page.getByText("Sampath Savings added")).toBeVisible();
}

async function addHolding(page: Page, name: string, value: string, first: boolean) {
  await page.goto("/assets");
  await page
    .getByRole("button", { name: first ? "Add your first holding" : "Add holding" })
    .first()
    .click();
  const wizard = page.getByRole("dialog");
  await wizard.getByRole("radio", { name: "Equity" }).click();
  await wizard.getByRole("button", { name: "Next" }).click();
  await wizard.getByRole("radio", { name: "Unit trust" }).click();
  await wizard.getByRole("button", { name: "Next" }).click();
  await wizard.getByLabel("Name").fill(name);
  await wizard.getByRole("button", { name: "Next" }).click();
  await wizard.getByLabel("Amount invested").fill(value);
  await wizard.getByLabel("Current value").fill(value);
  await wizard.getByRole("button", { name: "Add holding" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

async function saveTarget(page: Page, a: string, b: string) {
  await page.goto("/rebalancing");
  if (await page.getByRole("combobox", { name: "Add an asset class" }).isVisible()) {
    const hasEquity = await field(page, "Equity percent").count();
    if (!hasEquity) {
      await page.getByRole("combobox", { name: "Add an asset class" }).click();
      await page.getByRole("option", { name: "Equity" }).click();
      for (const n of ["Fund A", "Fund B"]) {
        await page.getByRole("combobox", { name: "Add a holding to Equity" }).click();
        await page.getByRole("option", { name: n }).click();
      }
    }
  }
  await field(page, "Fund A percent of class").fill(a);
  await field(page, "Fund B percent of class").fill(b);
  await page.getByRole("button", { name: "Save target" }).click();
  await expect(page.getByText("Target allocation saved")).toBeVisible();
}

test("drift table → invest new money → Apply → full rebalance → use for next SIP → history diff", async ({
  page,
}) => {
  await register(page);
  await addBank(page);
  await addHolding(page, "Fund A", "10000", true);
  await addHolding(page, "Fund B", "10000", false);
  await saveTarget(page, "60", "40");

  // Planned vs actual: one class at 100%; inside it Fund A 50% vs target 60%
  await page.getByRole("link", { name: "Planned vs Actual" }).click();
  await expect(page).toHaveURL(/tab=actual/);
  await page.getByText("Equity", { exact: true }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Fund A" })).toContainText(
    "target 60.0%",
  );

  // Invest new money: 10,000 split by the class's holding targets
  await page.getByRole("link", { name: "Rebalance" }).click();
  await field(page, "Amount to invest").fill("10000");
  await page.getByRole("button", { name: "Suggest split" }).click();
  const buys = page.getByRole("list", { name: "Suggested buys" });
  await expect(buys).toContainText("Fund A");
  await expect(buys).toContainText("LKR 6,000.00");
  await expect(buys.getByText(/^Sell/)).toHaveCount(0);
  await buys.getByRole("button", { name: "Apply" }).first().click();
  const sheet = page.getByRole("dialog", { name: "Quick add" });
  await expect(sheet.getByRole("tab", { name: "Invest", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(sheet.getByLabel("Amount invested")).toHaveValue(/6,?000/);
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Invest saved")).toBeVisible();

  // Full rebalance: buys and sells
  await page.goto("/rebalancing?tab=rebalance");
  await page.getByRole("button", { name: "Full rebalance" }).click();
  const trades = page.getByRole("list", { name: "Rebalancing trades" });
  await expect(trades).toContainText("Sell");
  await expect(trades).toContainText("Buy");

  // A SIP plan, then "Use for next SIP" → Execute opens tilted
  await page.goto("/sip/plans/new");
  await field(page, "Name").fill("Monthly funds");
  await field(page, "Amount each period").fill("10000");
  await page.getByRole("button", { name: "Create plan" }).click();
  await expect(page).toHaveURL(/\/sip$/);
  await page.goto("/rebalancing?tab=rebalance");
  await page.getByRole("button", { name: "Tilt next period" }).click();
  await expect(page.getByText(/will open with the drift-tilted split/)).toBeVisible();
  await page.goto("/sip");
  await page
    .getByRole("link", { name: /^Execute Monthly funds/ })
    .first()
    .click();
  await expect(page.getByRole("button", { name: "Drift-tilted split" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // History shows the diff of a second save
  await saveTarget(page, "70", "30");
  await page.goto("/rebalancing?tab=history");
  await expect(page.getByRole("list", { name: "Target allocation history" })).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Target allocation history" }).getByRole("listitem"),
  ).toHaveCount(2);
});
