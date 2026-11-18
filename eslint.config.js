// Configuração raiz do ESLint (flat config). Cada pacote herda daqui.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import { regrasDeToken } from "./packages/ui/eslint-tokens.js";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "**/node_modules/**",
      "**/.turbo/**",
      "**/migrations/**",
      "**/openapi.json",
      "**/storybook-static/**",
      "**/playwright-report/**",
      "**/test-results/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Valor monetário é string/numeric no banco; comparação frouxa esconde
      // bug de tipo em dado financeiro.
      eqeqeq: ["error", "always"],
      "no-console": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Testes podem usar console e asserções menos estritas.
    files: ["**/*.test.ts", "**/*.spec.ts", "**/test/**"],
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // Design system: cor e fonte so em packages/ui/tokens.css.
    files: [
      "packages/ui/src/**/*.{ts,tsx}",
      "packages/ui/stories/**/*.{ts,tsx}",
      "packages/ui/.storybook/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-syntax": ["error", ...regrasDeToken],
    },
  },
);
