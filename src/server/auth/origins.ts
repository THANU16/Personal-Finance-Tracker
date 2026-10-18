// Origins Better Auth accepts for sign-in/up requests ("Invalid origin" otherwise). Pure, unit tested.

/** `https://host[:port]` of a URL, or null when it is not a valid http(s) URL. */
function originOf(value: string | undefined): string | null {
  if (!value) return null;
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const u = new URL(withScheme);
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

/**
 * The app URL and auth URL, Vercel's deployment, branch and production hostnames (system
 * environment variables, set automatically on Vercel) and any extra comma-separated origins.
 */
export function trustedOrigins(env: {
  APP_URL?: string;
  BETTER_AUTH_URL?: string;
  BETTER_AUTH_TRUSTED_ORIGINS?: string;
  VERCEL_URL?: string;
  VERCEL_BRANCH_URL?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
}): string[] {
  const values = [
    env.APP_URL,
    env.BETTER_AUTH_URL,
    env.VERCEL_URL,
    env.VERCEL_BRANCH_URL,
    env.VERCEL_PROJECT_PRODUCTION_URL,
    ...(env.BETTER_AUTH_TRUSTED_ORIGINS ?? "").split(","),
  ];
  return [
    ...new Set(values.map((v) => originOf(v?.trim())).filter((v): v is string => v !== null)),
  ];
}
