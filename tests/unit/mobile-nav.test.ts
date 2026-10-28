import { describe, expect, it } from "vitest";
import {
  ALL_NAV_ITEMS,
  INVEST_HUB,
  MORE_GROUPS,
  isInvestHubPage,
  mobileParent,
  mobileTabFor,
} from "@/components/layout/nav";

describe("mobile shell navigation (docs/07 §1)", () => {
  it("puts every sidebar page behind exactly one mobile entry: a tab, the Invest hub or More", () => {
    const tabRoots = ["/dashboard", "/transactions"];
    const hub = INVEST_HUB.map((i) => i.href);
    const more = MORE_GROUPS.flatMap((g) => g.items.map((i) => i.href));
    const covered = [...tabRoots, ...hub, ...more];
    expect([...covered].sort()).toEqual(ALL_NAV_ITEMS.map((i) => i.href).sort());
    expect(new Set(covered).size).toBe(covered.length);
  });

  it("maps pages to their tab", () => {
    expect(mobileTabFor("/dashboard")).toBe("home");
    expect(mobileTabFor("/transactions/import/money-manager/abc")).toBe("activity");
    expect(mobileTabFor("/assets/123")).toBe("invest");
    expect(mobileTabFor("/sip/execute/123")).toBe("invest");
    expect(mobileTabFor("/rebalancing")).toBe("invest");
    expect(mobileTabFor("/opportunity-fund")).toBe("invest");
    expect(mobileTabFor("/more")).toBe("more");
    expect(mobileTabFor("/debts/123")).toBe("more");
    expect(mobileTabFor("/settings")).toBe("more");
    expect(mobileTabFor("/onboarding")).toBeNull();
    // prefix match is per segment
    expect(mobileTabFor("/assetsx")).toBeNull();
  });

  it("shows the hub control only on the four hub pages", () => {
    expect(isInvestHubPage("/assets")).toBe(true);
    expect(isInvestHubPage("/opportunity-fund")).toBe(true);
    expect(isInvestHubPage("/assets/update-values")).toBe(false);
    expect(isInvestHubPage("/sip/history")).toBe(false);
  });

  it("gives detail and More pages a back target, tab roots none", () => {
    expect(mobileParent("/accounts/123")).toEqual({ href: "/accounts", label: "Accounts" });
    expect(mobileParent("/assets/update-values")).toEqual({ href: "/assets", label: "Assets" });
    expect(mobileParent("/debts/123")).toEqual({ href: "/debts", label: "Debts" });
    expect(mobileParent("/sip/plans/new")).toEqual({ href: "/sip", label: "SIP" });
    expect(mobileParent("/transactions/import")).toEqual({
      href: "/transactions",
      label: "Activity",
    });
    expect(mobileParent("/transactions/import/money-manager/abc")).toEqual({
      href: "/transactions/import",
      label: "Import",
    });
    expect(mobileParent("/accounts")).toEqual({ href: "/more", label: "More" });
    expect(mobileParent("/notifications")).toEqual({ href: "/more", label: "More" });
    for (const root of [
      "/dashboard",
      "/transactions",
      "/assets",
      "/sip",
      "/more",
      "/rebalancing",
    ]) {
      expect(mobileParent(root)).toBeNull();
    }
  });
});
