import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["src/integration/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "json"],
      reportsDirectory: "coverage",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "**/index.ts",
        "**/puro.ts",
        // Schema, politicas e operacoes de banco: verificados contra Postgres
        // real, em src/integration.
        "src/db/**",
        "src/integration/**",
      ],
      // Mesma calibracao do portfolio: ramos em 80 por causa dos fallbacks
      // que o noUncheckedIndexedAccess obriga.
      thresholds: { lines: 95, functions: 95, statements: 95, branches: 80 },
    },
  },
});
