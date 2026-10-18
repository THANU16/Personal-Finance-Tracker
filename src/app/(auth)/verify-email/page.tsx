import type { Metadata } from "next";
import { Suspense } from "react";
import { VerifyEmailPanel } from "@/components/auth/verify-email-panel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Verify email" };

export default function Page() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Confirm your email</CardTitle>
        <CardDescription>We need to confirm your email address before you log in.</CardDescription>
      </CardHeader>
      <CardContent>
        {/* reads the query string */}
        <Suspense>
          <VerifyEmailPanel />
        </Suspense>
      </CardContent>
    </Card>
  );
}
