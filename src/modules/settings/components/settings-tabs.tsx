"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AssetClassesManager } from "@/modules/asset-classes/components/asset-classes-manager";
import type { AssetClassDTO } from "@/modules/asset-classes/schemas";
import { CategoriesManager } from "@/modules/categories/components/categories-manager";
import type { CategoryNode } from "@/modules/categories/schemas";
import type { SettingsDTO } from "@/modules/settings/schemas";
import { PreferencesForm } from "@/modules/settings/components/preferences-form";
import { ProfileForm } from "@/modules/settings/components/profile-form";
import { SecurityTab } from "@/modules/settings/components/security/security-tab";
import type { SecurityDTO } from "@/modules/settings/security";
import { FxRatesManager } from "@/modules/fx/components/fx-rates-manager";
import type { FxRateDTO } from "@/modules/fx/schemas";

// docs/05 §17 — the Data tab arrives with Phase 11.
export function SettingsTabs({
  user,
  settings,
  timezones,
  categories,
  assetClasses,
  security,
  fxRates,
  todayKey,
}: {
  user: { name: string; email: string };
  settings: SettingsDTO;
  timezones: string[];
  categories: CategoryNode[];
  assetClasses: AssetClassDTO[];
  security: SecurityDTO;
  fxRates: FxRateDTO[];
  todayKey: string;
}) {
  return (
    <Tabs defaultValue="preferences">
      <TabsList className="max-w-full overflow-x-auto">
        <TabsTrigger value="profile">Profile</TabsTrigger>
        <TabsTrigger value="preferences">Preferences</TabsTrigger>
        <TabsTrigger value="categories">Categories</TabsTrigger>
        <TabsTrigger value="asset-classes">Asset classes</TabsTrigger>
        <TabsTrigger value="fx">FX rates</TabsTrigger>
        <TabsTrigger value="security">Security</TabsTrigger>
      </TabsList>
      <TabsContent value="profile" className="pt-4">
        <ProfileForm name={user.name} email={user.email} />
      </TabsContent>
      <TabsContent value="preferences" className="pt-4">
        <PreferencesForm settings={settings} timezones={timezones} />
      </TabsContent>
      <TabsContent value="categories" className="pt-4">
        <CategoriesManager tree={categories} />
      </TabsContent>
      <TabsContent value="asset-classes" className="pt-4">
        <AssetClassesManager classes={assetClasses} />
      </TabsContent>
      <TabsContent value="fx" className="pt-4">
        <FxRatesManager rates={fxRates} baseCurrency={settings.baseCurrency} todayKey={todayKey} />
      </TabsContent>
      <TabsContent value="security" className="pt-4">
        <SecurityTab security={security} locale={settings.locale} timeZone={settings.timezone} />
      </TabsContent>
    </Tabs>
  );
}
