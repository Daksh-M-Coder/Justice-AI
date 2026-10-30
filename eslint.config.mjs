import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "coverage/**",
    // the archived pre-migration app: reference only, never built or shipped
    "legacy/**",
  ]),
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      // These two rules come from the React Compiler era of eslint-plugin-react-hooks.
      // They are real warnings for new code, but they fire on the standard, deliberate
      // pattern this app uses for client-persisted state (theme, language, active tab,
      // checklists, RTI filings): read localStorage in an effect after mount, because a
      // lazy useState would make the server HTML and the client disagree. Kept as
      // warnings with this note rather than silently switched off.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
]);

export default eslintConfig;
