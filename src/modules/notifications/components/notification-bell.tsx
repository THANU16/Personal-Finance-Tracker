import Link from "next/link";
import { Bell } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { unreadCount } from "@/modules/notifications/service";
import { getCurrentUser } from "@/server/auth/require-user";

// A link styled as an icon button (Base UI's Button expects a native <button>).
const bellClass = (className?: string) =>
  cn(buttonVariants({ variant: "ghost", size: "icon" }), "relative", className);

/** Header bell with the unread count (docs/05 §1). Render inside <Suspense> (reads the session). */
export async function NotificationBell({ className }: { className?: string }) {
  const current = await getCurrentUser();
  const count = current ? await unreadCount(current.ctx) : 0;
  const label = count ? `Notifications, ${count} unread` : "Notifications";
  return (
    <Link href="/notifications" aria-label={label} title={label} className={bellClass(className)}>
      <Bell aria-hidden />
      {count ? (
        <span
          aria-hidden
          className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-destructive px-1 text-center text-[10px] leading-4 font-semibold text-white"
        >
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Link>
  );
}

export function NotificationBellFallback({ className }: { className?: string }) {
  return (
    <Link
      href="/notifications"
      aria-label="Notifications"
      title="Notifications"
      className={bellClass(className)}
    >
      <Bell aria-hidden />
    </Link>
  );
}
