import { createHash, createHmac } from "node:crypto";

// AWS Signature Version 4 for S3-compatible storage (no SDK). Header-based signing; the payload
// hash is sent as x-amz-content-sha256.

export const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export const sha256Hex = (data: string | Uint8Array) =>
  createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) =>
  createHmac("sha256", key).update(data).digest();

/** RFC 3986 encoding of one path segment (S3 keeps "/" between segments). */
export const encodeSegment = (s: string) =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

export interface SignInput {
  method: string;
  /** Absolute URL; the path must already be encoded. */
  url: string;
  headers: Record<string, string>;
  payloadHash: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service?: string;
  /** `YYYYMMDDTHHMMSSZ`; defaults to now. */
  amzDate?: string;
}

export function amzDateOf(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/** Headers to send: the input headers + host, x-amz-date, x-amz-content-sha256 and authorization. */
export function signV4(input: SignInput): Record<string, string> {
  const url = new URL(input.url);
  const amzDate = input.amzDate ?? amzDateOf(new Date());
  const day = amzDate.slice(0, 8);
  const service = input.service ?? "s3";
  const headers: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(input.headers).map(([k, v]) => [k.toLowerCase(), v.trim()]),
    ),
    host: url.host,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": input.payloadHash,
  };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]!.replace(/\s+/g, " ")}\n`).join("");
  const signedHeaders = names.join(";");
  const query = [...url.searchParams.entries()]
    .map(([k, v]) => [encodeSegment(k), encodeSegment(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const canonicalRequest = [
    input.method.toUpperCase(),
    url.pathname || "/",
    query,
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join("\n");
  const scope = `${day}/${input.region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const kDate = hmac(`AWS4${input.secretAccessKey}`, day);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
