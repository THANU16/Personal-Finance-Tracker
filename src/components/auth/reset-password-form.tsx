"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField, fieldAria } from "@/components/shared/form-field";
import { authClient } from "@/lib/auth-client";
import { PASSWORD_MIN, resetPasswordSchema, type ResetPasswordInput } from "@/lib/auth-schemas";

const INVALID_LINK = "This reset link is invalid or has expired.";

/** Better Auth redirects the emailed link here with ?token=… (or ?error=INVALID_TOKEN). */
export function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token");
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({ resolver: zodResolver(resetPasswordSchema) });

  if (!token || params.get("error")) {
    return (
      <div className="grid gap-4">
        <p role="alert" className="text-sm text-destructive">
          {INVALID_LINK}
        </p>
        <Button render={<Link href="/forgot-password" />}>Send a new link</Button>
      </div>
    );
  }

  async function onSubmit({ newPassword }: ResetPasswordInput) {
    const { error } = await authClient.resetPassword({ newPassword, token: token! });
    if (error) {
      setError("root", {
        message:
          error.code === "INVALID_TOKEN"
            ? INVALID_LINK
            : (error.message ?? "Could not reset the password"),
      });
      return;
    }
    toast.success("Password changed. Log in with your new password.");
    router.replace("/login");
  }

  const fields = [
    {
      name: "newPassword",
      label: "New password",
      description: `At least ${PASSWORD_MIN} characters.`,
    },
    { name: "confirmPassword", label: "Confirm new password", description: undefined },
  ] as const;

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4">
      {fields.map((f, i) => {
        const error = errors[f.name]?.message;
        return (
          <FormField
            key={f.name}
            id={f.name}
            label={f.label}
            error={error}
            description={f.description}
          >
            <Input
              id={f.name}
              type="password"
              autoComplete="new-password"
              autoFocus={i === 0}
              {...fieldAria(f.name, error, !!f.description)}
              {...register(f.name)}
            />
          </FormField>
        );
      })}
      {errors.root ? (
        <p role="alert" className="text-sm text-destructive">
          {errors.root.message}{" "}
          <Link href="/forgot-password" className="underline underline-offset-4">
            Send a new link
          </Link>
        </p>
      ) : null}
      <Button type="submit" disabled={isSubmitting} className="w-full">
        {isSubmitting ? "Saving…" : "Set new password"}
      </Button>
    </form>
  );
}
