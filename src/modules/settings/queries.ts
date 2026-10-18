import "server-only";
import type { SettingsDTO } from "@/modules/settings/schemas";
import { getSettings } from "@/modules/settings/service";
import type { Ctx } from "@/server/ctx";

export async function getSettingsForPage(ctx: Ctx): Promise<SettingsDTO> {
  return getSettings(ctx);
}
