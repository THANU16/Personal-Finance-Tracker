import "server-only";
import type { Auth } from "@/server/auth/auth";

export const OFFLINE_PASSWORD_MIN = 8;
export const OFFLINE_PASSWORD_MAX = 128;

/**
 * Sets a new password without email (scripts/reset-password.ts). Uses Better Auth's own hashing
 * and adapter, never plain text, and signs the user out everywhere.
 */
export async function resetPasswordOffline(
  auth: Auth,
  email: string,
  newPassword: string,
): Promise<{ userId: string }> {
  if (newPassword.length < OFFLINE_PASSWORD_MIN || newPassword.length > OFFLINE_PASSWORD_MAX) {
    throw new Error(
      `Password must be ${OFFLINE_PASSWORD_MIN}–${OFFLINE_PASSWORD_MAX} characters long`,
    );
  }
  const ctx = await auth.$context;
  const found = await ctx.internalAdapter.findUserByEmail(email.trim().toLowerCase(), {
    includeAccounts: true,
  });
  if (!found) throw new Error("No user with that email");
  const hasCredential = found.accounts.some((a) => a.providerId === "credential");
  if (!hasCredential) throw new Error("That user has no email/password login");
  const hash = await ctx.password.hash(newPassword);
  await ctx.internalAdapter.updatePassword(found.user.id, hash);
  await ctx.internalAdapter.deleteUserSessions(found.user.id);
  return { userId: found.user.id };
}
