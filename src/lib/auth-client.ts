"use client";

import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// Same-origin: requests go to /api/auth/*. The login form handles the two-factor redirect itself
// (it keeps ?next=), so no onTwoFactorRedirect here.
export const authClient = createAuthClient({ plugins: [twoFactorClient()] });
