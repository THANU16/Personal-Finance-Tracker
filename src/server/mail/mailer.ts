import "server-only";
import { appendFile } from "node:fs/promises";
import { getEnv } from "@/server/env";

// docs/02 — Mailer behind an interface (auth emails now, reminders in Phase 10).
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  readonly driver: "resend" | "console";
  send(message: MailMessage): Promise<void>;
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** Sends through Resend's REST API (no SDK dependency). */
export function resendMailer(opts: {
  apiKey: string;
  from: string;
  fetchImpl?: typeof fetch;
}): Mailer {
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    driver: "resend",
    async send(message) {
      const res = await doFetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: opts.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          ...(message.html ? { html: message.html } : {}),
        }),
      });
      if (!res.ok) throw new Error(`Resend rejected the email (HTTP ${res.status})`);
    },
  };
}

/**
 * Dev/no-config driver. Development: logs the whole message (links included) so flows work
 * without a provider. Production: logs only that mail is not configured — never links or tokens.
 * `captureFile` (MAIL_CAPTURE_FILE, e2e only) appends every message as a JSON line.
 */
export function consoleMailer(opts: {
  mode: "development" | "test" | "production";
  captureFile?: string;
  log?: (line: string) => void;
}): Mailer {
  const log = opts.log ?? ((line: string) => console.info(line));
  return {
    driver: "console",
    async send(message) {
      if (opts.captureFile) {
        await appendFile(opts.captureFile, `${JSON.stringify({ ...message, at: Date.now() })}\n`);
      }
      if (opts.mode === "production") {
        log(
          `[mail] Email is not configured (RESEND_API_KEY empty); "${message.subject}" was not sent. ` +
            "Reset a password offline with: npm run reset-password -- <email> <newPassword>",
        );
        return;
      }
      log(`[mail] To: ${message.to}\n[mail] Subject: ${message.subject}\n${message.text}`);
    },
  };
}

let cached: Mailer | undefined;

/** Resend when RESEND_API_KEY is set, otherwise the console driver. */
export function getMailer(): Mailer {
  if (!cached) {
    const env = getEnv();
    cached =
      env.RESEND_API_KEY && env.MAIL_FROM
        ? resendMailer({ apiKey: env.RESEND_API_KEY, from: env.MAIL_FROM })
        : consoleMailer({ mode: env.NODE_ENV, captureFile: env.MAIL_CAPTURE_FILE });
  }
  return cached;
}
