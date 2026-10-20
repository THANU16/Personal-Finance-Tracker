import { utcToBusinessDate } from "@/domain/dates";
import { NotificationsClient } from "@/modules/notifications/components/notifications-client";
import { listNotifications } from "@/modules/notifications/service";
import { requireUser } from "@/server/auth/require-user";

export async function NotificationsContent() {
  const ctx = await requireUser();
  const items = await listNotifications(ctx);
  return (
    <NotificationsClient
      today={utcToBusinessDate(new Date(), ctx.tz)}
      items={items.map((n) => ({ ...n, day: utcToBusinessDate(new Date(n.createdAt), ctx.tz) }))}
    />
  );
}
