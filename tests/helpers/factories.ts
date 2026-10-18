import { Types } from "mongoose";
import { getOrCreateSettings } from "@/modules/settings/service";
import type { Ctx } from "@/server/ctx";

/** A user context with settings created through the service (as on first login). */
export async function makeUser(): Promise<Ctx> {
  const userId = new Types.ObjectId().toString();
  const settings = await getOrCreateSettings(userId);
  return { userId, tz: settings.timezone, baseCurrency: settings.baseCurrency };
}
