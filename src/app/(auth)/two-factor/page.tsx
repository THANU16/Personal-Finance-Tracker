import type { Metadata } from "next";
import { Suspense } from "react";
import { TwoFactorForm } from "@/components/auth/two-factor-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Two-factor check" };

export default function Page() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Two-factor check</CardTitle>
        <CardDescription>Enter the code from your authenticator app.</CardDescription>
      </CardHeader>
      <CardContent>
        {/* reads the query string */}
        <Suspense>
          <TwoFactorForm />
        </Suspense>
      </CardContent>
    </Card>
  );
}
