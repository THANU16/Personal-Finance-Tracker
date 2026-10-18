import { redirect } from "next/navigation";
import { listAssetClasses } from "@/modules/asset-classes/service";
import { getCategoryTree } from "@/modules/categories/service";
import { listFxRates } from "@/modules/fx/service";
import { utcToBusinessDate } from "@/domain/dates";
import { getSecurityOverview } from "@/modules/settings/security";
import { getCurrentUser } from "@/server/auth/require-user";
import { SettingsTabs } from "@/modules/settings/components/settings-tabs";

/** Server part of /settings. Reads the session, so render inside <Suspense>. */
export async function SettingsContent() {
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  const { listImportHistory } = await import("@/modules/imports/valuation-service");
  const [categories, assetClasses, security, fxRates, imports] = await Promise.all([
    getCategoryTree(current.ctx, { includeArchived: true }),
    listAssetClasses(current.ctx),
    getSecurityOverview(),
    listFxRates(current.ctx),
    listImportHistory(current.ctx),
  ]);
  return (
    <SettingsTabs
      user={{ name: current.user.name, email: current.user.email }}
      settings={current.settings}
      timezones={Intl.supportedValuesOf("timeZone")}
      categories={categories}
      assetClasses={assetClasses}
      security={security}
      fxRates={fxRates}
      todayKey={utcToBusinessDate(new Date(), current.ctx.tz)}
      imports={imports}
    />
  );
}
