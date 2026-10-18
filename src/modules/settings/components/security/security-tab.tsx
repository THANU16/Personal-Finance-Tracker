"use client";

import type { SecurityDTO } from "@/modules/settings/security";
import { PasswordCard } from "@/modules/settings/components/security/password-card";
import { SessionsCard } from "@/modules/settings/components/security/sessions-card";
import { TwoFactorCard } from "@/modules/settings/components/security/two-factor-card";

// docs/05 §17 — Security tab: password, two-factor, sessions.
export function SecurityTab({
  security,
  locale,
  timeZone,
}: {
  security: SecurityDTO;
  locale: string;
  timeZone: string;
}) {
  return (
    <div className="grid gap-6">
      <PasswordCard />
      <TwoFactorCard enabled={security.twoFactorEnabled} />
      <SessionsCard sessions={security.sessions} locale={locale} timeZone={timeZone} />
    </div>
  );
}
