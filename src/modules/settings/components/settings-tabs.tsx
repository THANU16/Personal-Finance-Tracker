"use client";

import { ImportHistoryList } from "@/modules/imports/components/import-history-list";
import type { ImportHistoryItem } from "@/modules/imports/valuation-service";
import Link from "next/link";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AssetClassesManager } from "@/modules/asset-classes/components/asset-classes-manager";
import type { AssetClassDTO } from "@/modules/asset-classes/schemas";
import { CategoriesManager } from "@/modules/categories/components/categories-manager";
import { CategoryRulesManager } from "@/modules/categories/components/category-rules-manager";
import type { RuleDTO } from "@/modules/categories/rules-service";
import { DataPanel } from "@/modules/backup/components/data-panel";
import type { CategoryNode } from "@/modules/categories/schemas";
import type { SettingsDTO } from "@/modules/settings/schemas";
import { PreferencesForm } from "@/modules/settings/components/preferences-form";
import { ProfileForm } from "@/modules/settings/components/profile-form";
import { SecurityTab } from "@/modules/settings/components/security/security-tab";
import type { SecurityDTO } from "@/modules/settings/security";
import { FxRatesManager } from "@/modules/fx/components/fx-rates-manager";
import type { FxRateDTO } from "@/modules/fx/schemas";

// docs/05 §17 — Data tab: backup/restore, CSV export, maintenance and imports (Phase 11).
export function SettingsTabs({
  user,
  settings,
  timezones,
  categories,
  assetClasses,
  security,
  fxRates,
  todayKey,
  imports,
  rules,
  accountEmpty,
}: {
  user: { name: string; email: string };
  settings: SettingsDTO;
  timezones: string[];
  categories: CategoryNode[];
  assetClasses: AssetClassDTO[];
  security: SecurityDTO;
  fxRates: FxRateDTO[];
  todayKey: string;
  imports: ImportHistoryItem[];
  rules: RuleDTO[];
  accountEmpty: boolean;
}) {
  const ruleCategories = categories.flatMap((c) =>
    c.archived || (c.kind !== "income" && c.kind !== "expense")
      ? []
      : [
          { id: c.id, label: c.name, kind: c.kind },
          ...c.children
            .filter((k) => !k.archived)
            .map((k) => ({ id: k.id, label: `${c.name} › ${k.name}`, kind: c.kind })),
        ],
  );
  return (
    <Tabs defaultValue="preferences">
      <TabsList className="max-w-full overflow-x-auto">
        <TabsTrigger value="profile">Profile</TabsTrigger>
        <TabsTrigger value="preferences">Preferences</TabsTrigger>
        <TabsTrigger value="categories">Categories</TabsTrigger>
        <TabsTrigger value="asset-classes">Asset classes</TabsTrigger>
        <TabsTrigger value="fx">FX rates</TabsTrigger>
        <TabsTrigger value="security">Security</TabsTrigger>
        <TabsTrigger value="data">Data</TabsTrigger>
      </TabsList>
      <TabsContent value="profile" className="pt-4">
        <ProfileForm name={user.name} email={user.email} />
      </TabsContent>
      <TabsContent value="preferences" className="pt-4">
        <PreferencesForm settings={settings} timezones={timezones} />
      </TabsContent>
      <TabsContent value="categories" className="pt-4">
        <div className="space-y-8">
          <CategoriesManager tree={categories} />
          <CategoryRulesManager rules={rules} categories={ruleCategories} />
        </div>
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
      <TabsContent value="data" className="space-y-3 pt-4">
        <DataPanel accountEmpty={accountEmpty} />
        <div className="max-w-xl rounded-lg border p-4">
          <h2 className="font-medium">Import transactions</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            A bank statement (CSV) or the Excel export of the Money Manager app: map it, preview it
            and import it in one step. Every import can be undone.
          </p>
          <Button className="mt-3" variant="outline" render={<Link href="/transactions/import" />}>
            <Upload aria-hidden /> Import data
          </Button>
        </div>
        <div className="max-w-xl rounded-lg border p-4">
          <h2 className="font-medium">Import valuation history</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Past values of a holding from a CSV (one file per asset), with deposits and withdrawals
            marked from the jumps.
          </p>
          <Button
            className="mt-3"
            variant="outline"
            render={<Link href="/assets/import-valuations" />}
          >
            <Upload aria-hidden /> Import values
          </Button>
        </div>
        <div className="max-w-3xl space-y-2">
          <h2 className="font-medium">Import history</h2>
          <ImportHistoryList items={imports} />
        </div>
      </TabsContent>
    </Tabs>
  );
}
