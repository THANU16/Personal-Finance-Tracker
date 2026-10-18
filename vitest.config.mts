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
          // Valid env for getEnv(); the DB itself comes from tests/helpers/test-db.ts
          env: {
            NODE_ENV: "test",
            MONGODB_URI: "mongodb://127.0.0.1:1/unused-see-test-db",
            BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-123",
            BETTER_AUTH_URL: "http://localhost:3100",
            APP_URL: "http://localhost:3100",
            CRON_SECRET: "test-cron-secret-1234",
            DEFAULT_TIMEZONE: "Asia/Colombo",
            DEFAULT_CURRENCY: "LKR",
          },
          // The first run downloads a mongod binary for mongodb-memory-server
          testTimeout: 60_000,
          hookTimeout: 300_000,
        },
      },
    ],
  },
});
