import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = new Set(["/login", "/register"]);

/**
 * Optimistic auth redirect: no session cookie → /login?next=…. It only checks that a cookie
 * exists; `requireUser()` validates the session on the server for every page and action.
 * Signed-in users are not bounced away from /login here: a stale cookie would cause a loop.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.has(pathname) || getSessionCookie(request)) return NextResponse.next();

  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except API routes, Next.js internals and files with an extension (icons, images).
  matcher: ["/((?!api/|_next/|.*\\..*).*)"],
};
