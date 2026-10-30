import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Phase 12 accessibility pass: axe (WCAG 2.1 A/AA) on the main pages; serious and critical
// violations fail the test.
const PASSWORD = "correct-horse-battery";
const field = (page: Page, label: string, exact = false) =>
  page.getByLabel(label, { exact }).filter({ visible: true });

const PAGES = [
  "/onboarding",
  "/dashboard",
  "/accounts",
  "/transactions",
  "/transactions/import",
  "/assets",
  "/sip",
  "/rebalancing",
  "/budgets",
  "/goals",
  "/essentials",
  "/forecast",
  "/reports",
  "/reports?tab=categories",
  "/notifications",
  "/settings",
];

async function audit(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return result.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({
      path,
      id: v.id,
      impact: v.impact,
      help: v.help,
      targets: v.nodes.slice(0, 3).map((n) => `${n.target.join(" ")} :: ${n.html.slice(0, 160)}`),
    }));
}

async function registerWithAccount(page: Page) {
  await page.goto("/register");
  await field(page, "Name").fill("A11y Tester");
  await field(page, "Email").fill(
    `a11y-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
  );
  await field(page, "Password", true).fill(PASSWORD);
  await field(page, "Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.goto("/accounts");
  await page.getByRole("button", { name: "Add account" }).first().click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Name").fill("Bank");
  await d.getByLabel("Balance on opening date").fill("100000");
  await d.getByRole("button", { name: "Add account" }).click();
  await expect(page.getByText("Bank added")).toBeVisible();
}

test("main pages have no serious or critical axe violations", async ({ page }) => {
  test.setTimeout(300_000);
  // Logged-out pages first
  const found = [...(await audit(page, "/login")), ...(await audit(page, "/register"))];
  await registerWithAccount(page);
  for (const path of PAGES) found.push(...(await audit(page, path)));
  expect(found, JSON.stringify(found, null, 2)).toEqual([]);
});

// docs/07 §9 (mobile phase M8): the same audit on a phone, where the tab bar, More page, bottom
// sheets and stacked tables replace the desktop layout.
for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`phone, ${colorScheme}`, () => {
    test.use({
      viewport: { width: 393, height: 852 },
      isMobile: true,
      hasTouch: true,
      colorScheme,
    });

    test("main pages on a phone have no serious or critical axe violations", async ({ page }) => {
      test.setTimeout(400_000);
      const found = [...(await audit(page, "/login"))];
      await registerWithAccount(page);
      for (const path of [...PAGES, "/more"]) found.push(...(await audit(page, path)));

      // Quick add as a full-height sheet from the tab bar's +
      await page.goto("/dashboard");
      await page.getByRole("button", { name: "Quick add", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Quick add" })).toBeVisible();
      const sheet = await new AxeBuilder({ page })
        .include('[role="dialog"]')
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      found.push(
        ...sheet.violations
          .filter((v) => v.impact === "serious" || v.impact === "critical")
          .map((v) => ({
            path: "@quick-add",
            id: v.id,
            impact: v.impact,
            help: v.help,
            targets: [],
          })),
      );
      expect(found, JSON.stringify(found, null, 2)).toEqual([]);
    });
  });
}
