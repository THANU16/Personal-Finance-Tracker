import "server-only";
import { headers } from "next/headers";
import { getAuth } from "@/server/auth/auth";
import { AppError } from "@/server/errors";

/** A signed-in device. The session token never leaves the server. */
export interface SessionDTO {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  updatedAt: string;
  current: boolean;
}

export interface SecurityDTO {
  twoFactorEnabled: boolean;
  sessions: SessionDTO[];
}

/** Two-factor status and active sessions of the signed-in user (most recently active first). */
export async function getSecurityOverview(): Promise<SecurityDTO> {
  const h = await headers();
  const auth = getAuth();
  const current = await auth.api.getSession({ headers: h });
  if (!current) throw new AppError("UNAUTHORIZED", "Not signed in");
  const sessions = await auth.api.listSessions({ headers: h });
  return {
    twoFactorEnabled: current.user.twoFactorEnabled === true,
    sessions: sessions
      .map((s) => ({
        id: s.id,
        userAgent: s.userAgent ?? null,
        ipAddress: s.ipAddress ?? null,
        createdAt: new Date(s.createdAt).toISOString(),
        updatedAt: new Date(s.updatedAt).toISOString(),
        current: s.id === current.session.id,
      }))
      .sort(
        (a, b) => Number(b.current) - Number(a.current) || b.updatedAt.localeCompare(a.updatedAt),
      ),
  };
}

/** Signs out one of the user's own sessions by id (Better Auth only revokes the caller's sessions). */
export async function revokeSessionById(sessionId: string): Promise<void> {
  const h = await headers();
  const auth = getAuth();
  const sessions = await auth.api.listSessions({ headers: h });
  const target = sessions.find((s) => s.id === sessionId);
  if (!target) throw new AppError("NOT_FOUND", "That session has already ended");
  await auth.api.revokeSession({ headers: h, body: { token: target.token } });
}

export async function revokeOtherSessions(): Promise<void> {
  await getAuth().api.revokeOtherSessions({ headers: await headers() });
}
