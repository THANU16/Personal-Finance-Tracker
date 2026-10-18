"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField, fieldAria } from "@/components/shared/form-field";
import { authClient } from "@/lib/auth-client";
import { PASSWORD_MIN, registerSchema, type RegisterInput } from "@/lib/auth-schemas";

export function RegisterForm() {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({ resolver: zodResolver(registerSchema) });

  async function onSubmit({ name, email, password }: RegisterInput) {
    const { data, error } = await authClient.signUp.email({
      name,
      email,
      password,
      callbackURL: "/verify-email?verified=1",
    });
    if (error) {
      const message =
        error.code === "USER_ALREADY_EXISTS" || error.status === 422
          ? "An account with this email already exists."
          : (error.message ?? "Could not create the account");
      setError("root", { message });
      toast.error(message);
      return;
    }
    if (!data?.token) {
      // REQUIRE_EMAIL_VERIFICATION: no session until the emailed link is used
      router.replace(`/verify-email?email=${encodeURIComponent(email)}&sent=1`);
      return;
    }
    toast.success("Welcome to WealthTrack");
    router.replace("/dashboard");
    router.refresh();
  }

  const fields = [
    { name: "name", label: "Name", type: "text", autoComplete: "name" },
    { name: "email", label: "Email", type: "email", autoComplete: "email" },
    {
      name: "password",
      label: "Password",
      type: "password",
      autoComplete: "new-password",
      description: `At least ${PASSWORD_MIN} characters.`,
    },
    {
      name: "confirmPassword",
      label: "Confirm password",
      type: "password",
      autoComplete: "new-password",
    },
  ] as const;

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4">
      {fields.map((f, i) => {
        const error = errors[f.name]?.message;
        const description = "description" in f ? f.description : undefined;
        return (
          <FormField
            key={f.name}
            id={f.name}
            label={f.label}
            error={error}
            description={description}
          >
            <Input
              id={f.name}
              type={f.type}
              autoComplete={f.autoComplete}
              autoFocus={i === 0}
              {...fieldAria(f.name, error, Boolean(description))}
              {...register(f.name)}
            />
          </FormField>
        );
      })}
      {errors.root ? (
        <p role="alert" className="text-sm text-destructive">
          {errors.root.message}
        </p>
      ) : null}
      <Button type="submit" disabled={isSubmitting} className="w-full">
        {isSubmitting ? "Creating account…" : "Create account"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Already registered?{" "}
        <Link href="/login" className="font-medium text-foreground underline underline-offset-4">
          Log in
        </Link>
      </p>
    </form>
  );
}
