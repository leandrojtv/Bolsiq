import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["src/integration/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "json"],
      reportsDirectory: "coverage",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "**/index.ts",
        // Declaracao de schema: verificada aplicando a migration num Postgres
        // real, nao por teste unitario. Testar que uma coluna foi declarada
        // testaria o Drizzle.
        "src/db/**",
        // Precisam de Postgres e NATS: cobertos pelo teste de integracao.
        "src/worker.ts",
        "src/executarScreener.ts",
      ],
      thresholds: { lines: 95, functions: 95, branches: 90, statements: 95 },
    },
  },
});
