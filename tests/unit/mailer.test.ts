import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { consoleMailer, resendMailer } from "@/server/mail/mailer";
import { resetPasswordEmail } from "@/server/mail/templates";

const message = resetPasswordEmail(
  { email: "nimal@example.com", name: "Nimal <b>" },
  "http://localhost:3000/api/auth/reset-password/secret-token?callbackURL=%2Freset-password",
);

describe("templates", () => {
  it("puts the link in text and html, escaping user input in html", () => {
    expect(message.to).toBe("nimal@example.com");
    expect(message.text).toContain("secret-token");
    expect(message.html).toContain("secret-token");
    expect(message.html).toContain("Nimal &lt;b&gt;");
  });
});

describe("consoleMailer", () => {
  it("logs the whole message, link included, in development", async () => {
    const lines: string[] = [];
    await consoleMailer({ mode: "development", log: (l) => lines.push(l) }).send(message);
    expect(lines.join("\n")).toContain("secret-token");
  });

  it("never logs links or tokens in production", async () => {
    const lines: string[] = [];
    await consoleMailer({ mode: "production", log: (l) => lines.push(l) }).send(message);
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("secret-token");
    expect(lines[0]).not.toContain("nimal@example.com");
    expect(lines[0]).toContain("npm run reset-password");
  });

  it("appends every message to the capture file when one is set", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "wt-mail-"));
    const file = path.join(dir, "mail.jsonl");
    const mailer = consoleMailer({ mode: "production", captureFile: file, log: () => {} });
    await mailer.send(message);
    await mailer.send({ ...message, to: "other@example.com" });
    const rows = (await readFile(file, "utf8"))
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { to: string; text: string });
    expect(rows.map((r) => r.to)).toEqual(["nimal@example.com", "other@example.com"]);
    expect(rows[0]!.text).toContain("secret-token");
  });
});

describe("resendMailer", () => {
  it("posts the message to the Resend API", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    await resendMailer({ apiKey: "re_test", from: "WealthTrack <a@b.c>", fetchImpl }).send(message);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer re_test");
    expect(JSON.parse(init.body as string)).toMatchObject({
      from: "WealthTrack <a@b.c>",
      to: ["nimal@example.com"],
      subject: message.subject,
    });
  });

  it("throws on a rejected request without echoing the key", async () => {
    const fetchImpl = vi.fn(async () => new Response("bad", { status: 422 }));
    const send = resendMailer({ apiKey: "re_secret", from: "a@b.c", fetchImpl }).send(message);
    await expect(send).rejects.toThrow("HTTP 422");
    await expect(send).rejects.not.toThrow("re_secret");
  });
});
