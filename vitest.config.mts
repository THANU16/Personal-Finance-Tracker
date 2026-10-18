import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// `server-only` throws outside a React Server Components bundle; in tests it is a no-op.
const serverOnlyStub = fileURLToPath(
  new URL("./tests/helpers/server-only-stub.ts", import.meta.url),
);

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: { "server-only": serverOnlyStub },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          // The first run downloads a mongod binary for mongodb-memory-server
          testTimeout: 60_000,
          hookTimeout: 300_000,
        },
      },
    ],
  },
});
