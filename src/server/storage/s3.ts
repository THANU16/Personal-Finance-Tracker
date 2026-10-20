import "server-only";
import { assertSafeKey, type StorageProvider } from "@/server/storage/provider";
import { EMPTY_SHA256, encodeSegment, sha256Hex, signV4 } from "@/server/storage/sigv4";

export interface S3Options {
  /** e.g. https://<account>.r2.cloudflarestorage.com or http://localhost:9000 (path-style); empty = AWS. */
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  fetchImpl?: typeof fetch;
}

/** The object URL: path-style on a custom endpoint, virtual-hosted on AWS. */
export function s3UrlOf(
  opts: Pick<S3Options, "endpoint" | "region" | "bucket">,
  key: string,
): string {
  assertSafeKey(key);
  const path = key.split("/").map(encodeSegment).join("/");
  return opts.endpoint
    ? `${opts.endpoint.replace(/\/$/, "")}/${encodeSegment(opts.bucket)}/${path}`
    : `https://${opts.bucket}.s3.${opts.region}.amazonaws.com/${path}`;
}

/** S3-compatible object storage over the REST API with SigV4 (AWS, R2, MinIO, B2…). */
export function s3Storage(opts: S3Options): StorageProvider {
  const doFetch = opts.fetchImpl ?? fetch;
  const send = (method: string, key: string, body?: Uint8Array, contentType?: string) => {
    const url = s3UrlOf(opts, key);
    const headers = signV4({
      method,
      url,
      headers: contentType ? { "content-type": contentType } : {},
      payloadHash: body ? sha256Hex(body) : EMPTY_SHA256,
      accessKeyId: opts.accessKeyId,
      secretAccessKey: opts.secretAccessKey,
      region: opts.region,
    });
    delete headers.host; // fetch sets it
    return doFetch(url, { method, headers, body: body ? Buffer.from(body) : undefined });
  };
  return {
    driver: "s3",
    async put(key, body, contentType) {
      const res = await send("PUT", key, body, contentType);
      if (!res.ok) throw new Error(`Storage rejected the upload (HTTP ${res.status})`);
    },
    async get(key) {
      const res = await send("GET", key);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Storage read failed (HTTP ${res.status})`);
      return new Uint8Array(await res.arrayBuffer());
    },
    async delete(key) {
      const res = await send("DELETE", key);
      if (!res.ok && res.status !== 404) {
        throw new Error(`Storage delete failed (HTTP ${res.status})`);
      }
    },
  };
}
