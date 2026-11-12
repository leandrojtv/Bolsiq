import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "eval/**/*.test.ts"],
    exclude: ["src/integration/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "json"],
      reportsDirectory: "coverage",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "**/index.ts",
        "src/puro.ts",
        "src/db/**",
        "src/integration/**",
        // Adaptador do Postgres: coberto em src/integration/importacao.test.ts.
        "src/importacao/postgres.ts",
      ],
      thresholds: { lines: 90, functions: 90, statements: 90, branches: 75 },
    },
  },
});
