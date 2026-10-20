import Link from "next/link";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { unreadCount } from "@/modules/notifications/service";
import { getCurrentUser } from "@/server/auth/require-user";

/** Header bell with the unread count (docs/05 §1). Render inside <Suspense> (reads the session). */
export async function NotificationBell() {
  const current = await getCurrentUser();
  const count = current ? await unreadCount(current.ctx) : 0;
  const label = count ? `Notifications, ${count} unread` : "Notifications";
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      className="relative"
      render={<Link href="/notifications" />}
    >
      <Bell aria-hidden />
      {count ? (
        <span
          aria-hidden
          className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-destructive px-1 text-center text-[10px] leading-4 font-semibold text-white"
        >
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Button>
  );
}

export function NotificationBellFallback() {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Notifications"
      title="Notifications"
      render={<Link href="/notifications" />}
    >
      <Bell aria-hidden />
    </Button>
  );
}
