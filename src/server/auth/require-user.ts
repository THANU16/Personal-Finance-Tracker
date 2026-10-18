import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getOrCreateSettings } from "@/modules/settings/service";
import type { SettingsDTO } from "@/modules/settings/schemas";
import { getAuth } from "@/server/auth/auth";
import type { Ctx } from "@/server/ctx";

export interface CurrentUser {
  ctx: Ctx;
  user: { id: string; name: string; email: string };
  settings: SettingsDTO;
}

/**
 * Reads the session once per request. Creates the user's settings on first use (first login).
 * Reads request headers, so callers must render inside a <Suspense> boundary (cacheComponents).
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return null;
  const { id, name, email } = session.user;
  const settings = await getOrCreateSettings(id);
  return {
    ctx: { userId: id, tz: settings.timezone, baseCurrency: settings.baseCurrency },
    user: { id, name, email },
    settings,
  };
});

/** Ctx for the signed-in user; redirects to /login otherwise. Use in pages and server actions. */
export async function requireUser(): Promise<Ctx> {
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  return current.ctx;
}
