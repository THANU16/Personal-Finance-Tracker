import { redirect } from "next/navigation";
import { MoreList } from "@/components/layout/more-list";
import { unreadCount } from "@/modules/notifications/service";
import { getCurrentUser } from "@/server/auth/require-user";

/** Session-dependent More list. Render inside <Suspense> (reads request headers). */
export async function MoreContent() {
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  const unread = await unreadCount(current.ctx);
  return <MoreList name={current.user.name} email={current.user.email} unread={unread} />;
}
