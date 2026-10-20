import { redirect } from "next/navigation";
import { utcToBusinessDate } from "@/domain/dates";
import { listAccounts } from "@/modules/accounts/service";
import { addHoldingOptions } from "@/modules/holdings/components/portfolio-view";
import { getPortfolio } from "@/modules/holdings/queries";
import { OnboardingWizard } from "@/modules/settings/components/onboarding-wizard";
import { demoDataAllowed } from "@/modules/settings/onboarding";
import { getCurrentUser } from "@/server/auth/require-user";

/** docs/05 §18 — server part of /onboarding (reads the session; render inside <Suspense>). */
export async function OnboardingContent() {
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  const { ctx, settings } = current;
  const [accounts, portfolio, holdingOptions] = await Promise.all([
    listAccounts(ctx),
    getPortfolio(ctx),
    addHoldingOptions(ctx),
  ]);
  return (
    <OnboardingWizard
      settings={{
        baseCurrency: settings.baseCurrency,
        timezone: settings.timezone,
        emergencyMonths: settings.emergencyMonths,
      }}
      timezones={Intl.supportedValuesOf("timeZone")}
      todayKey={utcToBusinessDate(new Date(), ctx.tz)}
      accounts={accounts.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        currency: a.currency,
        balanceMinor: a.balanceMinor,
      }))}
      holdings={portfolio.holdings.map((h) => ({
        id: h.id,
        name: h.name,
        currency: h.currency,
        valueMinor: h.currentValueMinor,
      }))}
      holdingOptions={holdingOptions}
      demoAllowed={demoDataAllowed()}
    />
  );
}
