import type { Metadata } from "next";
import { Suspense } from "react";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Forgot password" };

export default function Page() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Forgot your password?</CardTitle>
        <CardDescription>
          Enter your email and we will send you a link to choose a new one.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* reads the query string */}
        <Suspense>
          <ForgotPasswordForm />
        </Suspense>
      </CardContent>
    </Card>
  );
}
