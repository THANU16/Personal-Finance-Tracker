import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertSafeKey, type StorageProvider } from "@/server/storage/provider";

/** Files under `dir` (STORAGE_LOCAL_DIR). Development and single-server installs. */
export function localStorage(dir: string): StorageProvider {
  const root = path.resolve(dir);
  const fileOf = (key: string) => {
    assertSafeKey(key);
    const file = path.resolve(root, key);
    if (!file.startsWith(root + path.sep)) throw new Error("Invalid storage key");
    return file;
  };
  return {
    driver: "local",
    async put(key, body) {
      const file = fileOf(key);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, body);
    },
    async get(key) {
      try {
        return new Uint8Array(await readFile(fileOf(key)));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
    },
    async delete(key) {
      await rm(fileOf(key), { force: true });
    },
  };
}
