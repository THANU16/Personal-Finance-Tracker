"use client";

import { createAuthClient } from "better-auth/react";

// Same-origin: requests go to /api/auth/*.
export const authClient = createAuthClient();
