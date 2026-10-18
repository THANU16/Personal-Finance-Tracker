"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AssetClassesManager } from "@/modules/asset-classes/components/asset-classes-manager";
import type { AssetClassDTO } from "@/modules/asset-classes/schemas";
import { CategoriesManager } from "@/modules/categories/components/categories-manager";
import type { CategoryNode } from "@/modules/categories/schemas";
import type { SettingsDTO } from "@/modules/settings/schemas";
import { PreferencesForm } from "@/modules/settings/components/preferences-form";
import { ProfileForm } from "@/modules/settings/components/profile-form";

// docs/05 §17 — FX rates (Phase 4) and Data (Phase 11) tabs arrive with their phases.
export function SettingsTabs({
  user,
  settings,
  timezones,
  categories,
  assetClasses,
}: {
  user: { name: string; email: string };
  settings: SettingsDTO;
  timezones: string[];
  categories: CategoryNode[];
  assetClasses: AssetClassDTO[];
}) {
  return (
    <Tabs defaultValue="preferences">
      <TabsList className="max-w-full overflow-x-auto">
        <TabsTrigger value="profile">Profile</TabsTrigger>
        <TabsTrigger value="preferences">Preferences</TabsTrigger>
        <TabsTrigger value="categories">Categories</TabsTrigger>
        <TabsTrigger value="asset-classes">Asset classes</TabsTrigger>
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
    </Tabs>
  );
}
