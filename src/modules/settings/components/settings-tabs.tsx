"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { SettingsDTO } from "@/modules/settings/schemas";
import { PreferencesForm } from "@/modules/settings/components/preferences-form";
import { ProfileForm } from "@/modules/settings/components/profile-form";

// docs/05 §17 — Categories, Asset classes, FX rates and Data tabs arrive with their phases.
export function SettingsTabs({
  user,
  settings,
  timezones,
}: {
  user: { name: string; email: string };
  settings: SettingsDTO;
  timezones: string[];
}) {
  return (
    <Tabs defaultValue="preferences">
      <TabsList>
        <TabsTrigger value="profile">Profile</TabsTrigger>
        <TabsTrigger value="preferences">Preferences</TabsTrigger>
      </TabsList>
      <TabsContent value="profile" className="pt-4">
        <ProfileForm name={user.name} email={user.email} />
      </TabsContent>
      <TabsContent value="preferences" className="pt-4">
        <PreferencesForm settings={settings} timezones={timezones} />
      </TabsContent>
    </Tabs>
  );
}
