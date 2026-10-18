import { redirect } from "next/navigation";
import { HideAmountsSync } from "@/components/shared/hide-amounts";
import { UserMenu } from "@/components/layout/user-menu";
import { getCurrentUser } from "@/server/auth/require-user";

/** Session-dependent part of the topbar. Render inside <Suspense> (reads request headers). */
export async function UserArea() {
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  return (
    <>
      <HideAmountsSync hidden={current.settings.hideAmounts} />
      <UserMenu name={current.user.name} email={current.user.email} />
    </>
  );
}
