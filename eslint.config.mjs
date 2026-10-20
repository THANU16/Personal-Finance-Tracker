import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      // CLAUDE.md: no default exports except Next.js pages/layouts/route files (see override below)
      "import/no-default-export": "error",
    },
  },
  {
    // Files where Next.js or a tool requires a default export
    files: [
      "src/app/**/{page,layout,template,default,loading,error,global-error,not-found}.tsx",
      "src/app/{manifest,robots,sitemap}.ts",
      "src/proxy.ts",
      "*.config.{ts,mts,mjs,js}",
    ],
    rules: { "import/no-default-export": "off" },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "test-results/**",
    "playwright-report/**",
    "blob-report/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
