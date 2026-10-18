import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { ensureUserSetup } from "@/server/bootstrap";
import type { SettingsDTO } from "@/modules/settings/schemas";
import { getAuth } from "@/server/auth/auth";
import type { Ctx } from "@/server/ctx";

export interface CurrentUser {
  ctx: Ctx;
  user: { id: string; name: string; email: string };
  settings: SettingsDTO;
}

/**
 * Reads the session once per request. First request after login runs one-time setup (settings, seeded categories/asset classes).
 * Reads request headers, so callers must render inside a <Suspense> boundary (cacheComponents).
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return null;
  const { id, name, email } = session.user;
  const settings = await ensureUserSetup(id);
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
