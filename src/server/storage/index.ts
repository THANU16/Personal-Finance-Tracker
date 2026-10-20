import "server-only";
import { getEnv } from "@/server/env";
import { localStorage } from "@/server/storage/local";
import type { StorageProvider } from "@/server/storage/provider";
import { s3Storage } from "@/server/storage/s3";

let cached: StorageProvider | undefined;

/** STORAGE_DRIVER=local (STORAGE_LOCAL_DIR) or s3 (S3_* settings; env validation requires them). */
export function getStorage(): StorageProvider {
  if (!cached) {
    const env = getEnv();
    cached =
      env.STORAGE_DRIVER === "s3"
        ? s3Storage({
            endpoint: env.S3_ENDPOINT,
            region: env.S3_REGION!,
            bucket: env.S3_BUCKET!,
            accessKeyId: env.S3_ACCESS_KEY_ID!,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
          })
        : localStorage(env.STORAGE_LOCAL_DIR);
  }
  return cached;
}

/** Tests: swap in a provider (undefined restores the configured one). */
export function setStorageForTests(p: StorageProvider | undefined): void {
  cached = p;
}
