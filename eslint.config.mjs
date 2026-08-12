import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // The Catalyst UI kit is licensed third-party source, vendored verbatim from
    // ~/tailwind-ui-templates/catalyst-ui-kit/typescript/. Reformatting it to
    // satisfy our rules would fork it from upstream and make the next kit update
    // a merge conflict, so it is linted on its own terms.
    files: ["src/components/ui/**"],
    rules: {
      "prefer-const": "off",
      "@next/next/no-img-element": "off",
    },
  },
]);

export default eslintConfig;
