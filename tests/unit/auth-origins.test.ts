import { describe, expect, it } from "vitest";
import { trustedOrigins } from "@/server/auth/origins";

describe("trustedOrigins", () => {
  it("includes the app/auth URLs, Vercel hostnames and extra origins, deduplicated", () => {
    expect(
      trustedOrigins({
        APP_URL: "https://wealth.example.com/dashboard",
        BETTER_AUTH_URL: "https://wealth.example.com",
        VERCEL_URL: "my-app-abc123.vercel.app",
        VERCEL_BRANCH_URL: "my-app-git-main-me.vercel.app",
        VERCEL_PROJECT_PRODUCTION_URL: "my-app.vercel.app",
        BETTER_AUTH_TRUSTED_ORIGINS: " http://localhost:3000 , not a url ,",
      }),
    ).toEqual([
      "https://wealth.example.com",
      "https://my-app-abc123.vercel.app",
      "https://my-app-git-main-me.vercel.app",
      "https://my-app.vercel.app",
      "http://localhost:3000",
    ]);
  });

  it("works with only the required URLs", () => {
    expect(
      trustedOrigins({
        APP_URL: "http://localhost:3000",
        BETTER_AUTH_URL: "http://localhost:3000",
      }),
    ).toEqual(["http://localhost:3000"]);
  });
});
