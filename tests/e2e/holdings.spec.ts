import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "correct-horse-battery";
const field = (page: Page, label: string, exact = false) =>
  page.getByLabel(label, { exact }).filter({ visible: true });

async function register(page: Page) {
  await page.goto("/register");
  await field(page, "Name").fill("Portfolio Tester");
  await field(page, "Email").fill(
    `assets-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
  );
  await field(page, "Password", true).fill(PASSWORD);
  await field(page, "Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
}

async function addBank(page: Page) {
  await page.goto("/accounts");
  await page.getByRole("button", { name: "Add account" }).first().click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Name").fill("Sampath Savings");
  await d.getByLabel("Balance on opening date").fill("100000");
  await d.getByRole("button", { name: "Add account" }).click();
  await expect(page.getByText("Sampath Savings added")).toBeVisible();
}

test("add holding → buy → redeem (docs/04 example) → big value change needs a tick", async ({
  page,
}) => {
  await register(page);
  await addBank(page);

  // Wizard: class → instrument → details → opening values
  await page.goto("/assets");
  await page.getByRole("button", { name: "Add your first holding" }).click();
  const wizard = page.getByRole("dialog");
  await wizard.getByRole("radio", { name: "Equity" }).click();
  await wizard.getByRole("button", { name: "Next" }).click();
  await wizard.getByRole("radio", { name: "Unit trust" }).click();
  await wizard.getByRole("button", { name: "Next" }).click();
  await wizard.getByLabel("Name").fill("Ceylon Equity Fund");
  await wizard.getByRole("button", { name: "Next" }).click();
  await wizard.getByLabel("Amount invested").fill("30000");
  await wizard.getByLabel("Current value").fill("40000");
  await wizard.getByRole("button", { name: "Add holding" }).click();
  await expect(page).toHaveURL(/\/assets\/[a-f0-9]{24}$/);
  await expect(page.getByRole("heading", { level: 1, name: "Ceylon Equity Fund" })).toBeVisible();

  // Buy 10,000 → invested 40,000, value 50,000
  await page.getByRole("button", { name: "Buy" }).click();
  let sheet = page.getByRole("dialog", { name: "Quick add" });
  await sheet.getByLabel("Amount invested").fill("10000");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Invest saved")).toBeVisible();
  await expect(page.getByText("LKR 50,000.00").first()).toBeVisible();

  // Redeem 20,000 with a 100 fee: cost recovery returns the 19,900 as capital (docs/04 §3)
  await page.getByRole("button", { name: "Redeem" }).click();
  sheet = page.getByRole("dialog", { name: "Quick add" });
  await sheet.getByLabel("Amount redeemed (gross)").fill("20000");
  await sheet.getByLabel("Fee").fill("100");
  await expect(sheet.getByText("Cost removed")).toContainText("LKR 19,900.00");
  await expect(sheet.getByText("Realised gain")).toContainText("LKR 0.00");
  await expect(sheet.getByText("Cash to account")).toContainText("LKR 19,900.00");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Redeem saved")).toBeVisible();
  await expect(page.getByText("LKR 30,000.00").first()).toBeVisible(); // value
  await expect(page.getByText("LKR 20,100.00").first()).toBeVisible(); // invested

  // Update value 30,000 → 40,000 (+33%) needs the confirm tick
  await page.getByRole("button", { name: "Update value" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("New value").fill("40000");
  const save = dialog.getByRole("button", { name: "Save value" });
  await expect(save).toBeDisabled();
  await dialog.getByRole("checkbox", { name: /I confirm it is right/ }).click();
  await save.click();
  await expect(page.getByText("Ceylon Equity Fund updated")).toBeVisible();

  // Bank received the redemption cash: 100,000 − 10,000 + 19,900
  await page.goto("/accounts");
  await expect(page.getByText("LKR 109,900.00").first()).toBeVisible();

  // Monthly summary → Investing (owner request): bought, sold, fees and the holding's month.
  const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo" })
    .format(new Date())
    .slice(0, 7);
  await page.goto(`/reports?tab=monthly&month=${month}`);
  const money = page.locator("section").filter({ hasText: "Money in & out" });
  await expect(money).toContainText("LKR 10,000.00");
  await expect(money).toContainText("LKR 20,000.00");
  await expect(money).toContainText("LKR 100.00");
  await expect(
    page.getByRole("table", { name: "Investing by holding" }).getByRole("link", {
      name: "Ceylon Equity Fund",
    }),
  ).toBeVisible();
  if (process.env.E2E_SHOTS)
    await page.screenshot({ path: `${process.env.E2E_SHOTS}/investing.png`, fullPage: true });
});

test("fixed deposit wizard computes the maturity value", async ({ page }) => {
  await register(page);
  await page.goto("/assets");
  await page.getByRole("button", { name: "Add your first holding" }).click();
  const wizard = page.getByRole("dialog");
  await wizard.getByRole("radio", { name: "Fixed Income" }).click();
  await wizard.getByRole("button", { name: "Next" }).click();
  await wizard.getByRole("radio", { name: "Fixed deposit" }).click();
  await wizard.getByRole("button", { name: "Next" }).click();
  await wizard.getByLabel("Name").fill("HNB FD");
  await wizard.getByRole("button", { name: "Next" }).click();
  await wizard.getByLabel("Principal").fill("1000000");
  await wizard.getByLabel("Annual rate").fill("10");
  // Maturity one year out via the calendar: open, go forward 12 months, pick the 1st
  await field(page, "Maturity date", true).click();
  for (let i = 0; i < 12; i++) await page.getByRole("button", { name: /next month/i }).click();
  await page.getByRole("gridcell").filter({ hasText: /^1$/ }).first().click();
  await expect(wizard.getByText("Value at maturity")).toBeVisible();
  await wizard.getByRole("button", { name: "Add holding" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "HNB FD" })).toBeVisible();
  await expect(page.getByText("Value at maturity").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText("Matures in")).toBeVisible();
  await expect(page.getByRole("button", { name: "Withdraw" })).toBeVisible();
});

test("Fixed Income lists money market and FD; an FD without terms uses its current value", async ({
  page,
}) => {
  await register(page);
  await page.goto("/assets");
  await page.getByRole("button", { name: "Add your first holding" }).click();
  const wizard = page.getByRole("dialog");
  await wizard.getByRole("radio", { name: "Fixed Income" }).click();
  await wizard.getByRole("button", { name: "Next" }).click();
  await expect(wizard.getByRole("radio", { name: "Money market" })).toBeVisible();
  await expect(wizard.getByRole("radio", { name: "Stock" })).toHaveCount(0);
  await wizard.getByRole("radio", { name: "Fixed deposit" }).click();
  await wizard.getByRole("button", { name: "Next" }).click();
  await wizard.getByLabel("Name").fill("Sampath FD");
  await wizard.getByRole("button", { name: "Next" }).click();
  await wizard.getByRole("switch", { name: "Enter deposit terms" }).click();
  await wizard.getByLabel("Amount invested").fill("100000");
  await wizard.getByLabel("Current value").fill("102500");
  await wizard.getByRole("button", { name: "Add holding" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Sampath FD" })).toBeVisible();
  await expect(page.getByText("LKR 102,500.00").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Withdraw" })).toHaveCount(0);
});

test("Transfer tab moves money from an account into an asset", async ({ page }) => {
  await register(page);
  await addBank(page);
  await page.goto("/assets");
  await page.getByRole("button", { name: "Add your first holding" }).click();
  const wizard = page.getByRole("dialog");
  await wizard.getByRole("radio", { name: "Fixed Income" }).click();
  await wizard.getByRole("button", { name: "Next" }).click();
  await wizard.getByRole("radio", { name: "Money market" }).click();
  await wizard.getByRole("button", { name: "Next" }).click();
  await wizard.getByLabel("Name").fill("CAL Money Market");
  await wizard.getByRole("button", { name: "Next" }).click();
  await wizard.getByLabel("Amount invested").fill("10000");
  await wizard.getByLabel("Current value").fill("10000");
  await wizard.getByRole("button", { name: "Add holding" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "CAL Money Market" })).toBeVisible();

  await page.goto("/transactions");
  await page.getByRole("button", { name: "Add transaction" }).first().click();
  const sheet = page.getByRole("dialog", { name: "Quick add" });
  await sheet.getByRole("tab", { name: "Transfer", exact: true }).click();
  await sheet.getByLabel("Amount").fill("5000");
  await field(page, "From", true).click();
  await page.getByRole("option", { name: /^Sampath Savings/ }).click();
  await field(page, "To", true).click();
  await page.getByRole("option", { name: /^CAL Money Market/ }).click();
  await expect(sheet.getByText("Recorded as an investment into CAL Money Market.")).toBeVisible();
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/saved/).first()).toBeVisible();

  await page.goto("/assets");
  await expect(page.getByText("LKR 15,000.00").first()).toBeVisible();
});
