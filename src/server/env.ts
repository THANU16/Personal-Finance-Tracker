import "server-only";
import { z } from "zod";

// Empty values in .env files (e.g. `RESEND_API_KEY=`) mean "not set".
const optionalString = z.preprocess((v) => (v === "" ? undefined : v), z.string().optional());

export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

    MONGODB_URI: z
      .string()
      .regex(/^mongodb(\+srv)?:\/\//, "must start with mongodb:// or mongodb+srv://"),

    BETTER_AUTH_SECRET: z.string().min(32, "must be at least 32 characters"),
    BETTER_AUTH_URL: z.url(),
    /** Sign-in/up rate limits (production). Only the e2e server turns them off. */
    AUTH_RATE_LIMIT: z.enum(["on", "off"]).default("on"),
    /** Close registration once the owner account exists. */
    DISABLE_SIGNUP: z
      .enum(["true", "false", ""])
      .default("false")
      .transform((v) => v === "true"),

    APP_URL: z.url(),
    DEFAULT_TIMEZONE: z.string().min(1).default("Asia/Colombo"),
    DEFAULT_CURRENCY: z
      .string()
      .regex(/^[A-Z]{3}$/, "must be an ISO 4217 code such as LKR")
      .default("LKR"),

    CRON_SECRET: z.string().min(16, "must be at least 16 characters"),

    RESEND_API_KEY: optionalString,
    MAIL_FROM: optionalString,

    STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
    STORAGE_LOCAL_DIR: z.string().min(1).default("./.uploads"),
    S3_ENDPOINT: optionalString,
    S3_REGION: optionalString,
    S3_BUCKET: optionalString,
    S3_ACCESS_KEY_ID: optionalString,
    S3_SECRET_ACCESS_KEY: optionalString,
  })
  .superRefine((env, ctx) => {
    if (env.STORAGE_DRIVER === "s3") {
      const required = [
        "S3_REGION",
        "S3_BUCKET",
        "S3_ACCESS_KEY_ID",
        "S3_SECRET_ACCESS_KEY",
      ] as const;
      for (const key of required) {
        if (!env[key]) {
          ctx.addIssue({ code: "custom", path: [key], message: "required when STORAGE_DRIVER=s3" });
        }
      }
    }
    if (env.RESEND_API_KEY && !env.MAIL_FROM) {
      ctx.addIssue({
        code: "custom",
        path: ["MAIL_FROM"],
        message: "required when RESEND_API_KEY is set",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Validates an env source. Error messages name the variables but never echo their values. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`,
    );
    throw new Error(`Invalid environment variables:\n${lines.join("\n")}`);
  }
  return result.data;
}

let cached: Env | undefined;

/** Validated server env, parsed once from `process.env`. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
