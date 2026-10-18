import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/require-user";
import { SettingsTabs } from "@/modules/settings/components/settings-tabs";

/** Server part of /settings. Reads the session, so render inside <Suspense>. */
export async function SettingsContent() {
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  return (
    <SettingsTabs
      user={{ name: current.user.name, email: current.user.email }}
      settings={current.settings}
      timezones={Intl.supportedValuesOf("timeZone")}
    />
  );
}
