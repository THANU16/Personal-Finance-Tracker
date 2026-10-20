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

/** Daily digest of new notifications (Phase 10, docs/04 §19). */
export function notificationDigestEmail(
  user: { email: string; name: string },
  items: { title: string; body: string; link: string }[],
  appUrl: string,
): MailMessage {
  const base = appUrl.replace(/\/$/, "");
  const lines = items.map((i) => `• ${i.title} — ${i.body}\n  ${base}${i.link}`).join("\n");
  const text = `Hi ${user.name},\n\nNew in WealthTrack:\n\n${lines}\n\nAll notifications: ${base}/notifications\n\n— WealthTrack`;
  const html = `<p>Hi ${escapeHtml(user.name)},</p><p>New in WealthTrack:</p><ul>${items
    .map(
      (i) =>
        `<li><a href="${escapeHtml(base + i.link)}">${escapeHtml(i.title)}</a> — ${escapeHtml(i.body)}</li>`,
    )
    .join(
      "",
    )}</ul><p><a href="${escapeHtml(`${base}/notifications`)}">All notifications</a></p><p>— WealthTrack</p>`;
  return {
    to: user.email,
    subject:
      items.length === 1
        ? `WealthTrack: ${items[0]!.title}`
        : `WealthTrack: ${items.length} new reminders`,
    text,
    html,
  };
}
