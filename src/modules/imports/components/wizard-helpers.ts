import type { AccountChoice, CategoryChoice } from "@/modules/imports/schemas";

export function accountResolved(c: AccountChoice | undefined): boolean {
  if (!c) return false;
  if (c.treatAs === "ignore") return true;
  if (c.treatAs === "merge") return Boolean(c.into);
  return Boolean(c.existingId) || Boolean(c.create?.name.trim());
}

export function categoryResolved(c: CategoryChoice | undefined): boolean {
  if (!c || c.action === "unset") return false;
  if (c.action === "create") return Boolean(c.name.trim());
  if (c.action === "merge") return Boolean(c.into);
  return true;
}
