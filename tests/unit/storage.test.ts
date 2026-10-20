import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { localStorage } from "@/server/storage/local";
import { s3Storage, s3UrlOf } from "@/server/storage/s3";
import { EMPTY_SHA256, signV4 } from "@/server/storage/sigv4";

describe("signV4", () => {
  it("matches the AWS S3 'GET Object' example signature", () => {
    // docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html — Example: GET Object
    const h = signV4({
      method: "GET",
      url: "https://examplebucket.s3.amazonaws.com/test.txt",
      headers: { Range: "bytes=0-9" },
      payloadHash: EMPTY_SHA256,
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      region: "us-east-1",
      amzDate: "20130524T000000Z",
    });
    expect(h.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
        "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, " +
        "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
  });
});

const KEY = "0123456789abcdef01234567/abcdefgh1234";

describe("s3Storage", () => {
  it("path-style URLs on a custom endpoint, virtual-hosted on AWS; signed PUT/GET/DELETE", async () => {
    expect(s3UrlOf({ endpoint: "http://minio:9000/", region: "auto", bucket: "b" }, KEY)).toBe(
      `http://minio:9000/b/${KEY}`,
    );
    expect(s3UrlOf({ region: "eu-west-1", bucket: "b" }, KEY)).toBe(
      `https://b.s3.eu-west-1.amazonaws.com/${KEY}`,
    );
    const calls: { url: string; method: string; headers: Record<string, string> }[] = [];
    const store = new Map<string, Uint8Array>();
    const fake = (async (url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      calls.push({ url, method: init.method!, headers });
      if (init.method === "PUT") store.set(url, new Uint8Array(init.body as Buffer));
      if (init.method === "GET") {
        const b = store.get(url);
        return b ? new Response(Buffer.from(b)) : new Response(null, { status: 404 });
      }
      if (init.method === "DELETE") store.delete(url);
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    const s3 = s3Storage({
      endpoint: "http://minio:9000",
      region: "us-east-1",
      bucket: "b",
      accessKeyId: "k",
      secretAccessKey: "s",
      fetchImpl: fake,
    });
    await s3.put(KEY, new Uint8Array([1, 2, 3]), "image/png");
    expect(Array.from((await s3.get(KEY))!)).toEqual([1, 2, 3]);
    await s3.delete(KEY);
    expect(await s3.get(KEY)).toBeNull();
    expect(calls[0]!.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=k\//);
    expect(calls[0]!.headers["content-type"]).toBe("image/png");
    expect(calls[0]!.headers.host).toBeUndefined();
    await expect(s3.get("../etc/passwd")).rejects.toThrow(/Invalid storage key/);
  });
});

describe("localStorage", () => {
  let dir = "";
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });
  it("puts, gets, deletes; refuses unsafe keys", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "wt-store-"));
    const s = localStorage(dir);
    await s.put(KEY, new Uint8Array([9]), "application/pdf");
    expect(Array.from((await s.get(KEY))!)).toEqual([9]);
    await s.delete(KEY);
    expect(await s.get(KEY)).toBeNull();
    await expect(s.put("../x", new Uint8Array(), "x")).rejects.toThrow(/Invalid storage key/);
  });
});
