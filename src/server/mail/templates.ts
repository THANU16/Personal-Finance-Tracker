import type { MailMessage } from "@/server/mail/mailer";

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function actionEmail(opts: {
  to: string;
  subject: string;
  greeting: string;
  body: string;
  action: string;
  url: string;
  footer: string;
}): MailMessage {
  const text = `${opts.greeting}\n\n${opts.body}\n\n${opts.action}: ${opts.url}\n\n${opts.footer}\n\n— WealthTrack`;
  const html = `<p>${escapeHtml(opts.greeting)}</p><p>${escapeHtml(opts.body)}</p>
<p><a href="${escapeHtml(opts.url)}">${escapeHtml(opts.action)}</a></p>
<p style="color:#666;font-size:12px">${escapeHtml(opts.footer)}</p><p>— WealthTrack</p>`;
  return { to: opts.to, subject: opts.subject, text, html };
}

export function resetPasswordEmail(user: { email: string; name: string }, url: string) {
  return actionEmail({
    to: user.email,
    subject: "Reset your WealthTrack password",
    greeting: `Hi ${user.name},`,
    body: "Someone asked to reset the password for your WealthTrack account. The link works for 1 hour.",
    action: "Choose a new password",
    url,
    footer: "If you did not ask for this, ignore this email — your password stays the same.",
  });
}

export function verifyEmailEmail(user: { email: string; name: string }, url: string) {
  return actionEmail({
    to: user.email,
    subject: "Confirm your WealthTrack email",
    greeting: `Hi ${user.name},`,
    body: "Confirm this email address to finish setting up your WealthTrack account. The link works for 24 hours.",
    action: "Confirm email",
    url,
    footer: "If you did not create an account, ignore this email.",
  });
}
