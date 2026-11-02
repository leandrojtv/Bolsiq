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
      // server.ts abre porta e worker.ts precisa de Postgres: os dois são
      // cobertos pelo job de integração.
      exclude: [
        "src/**/*.test.ts",
        "src/server.ts",
        "src/worker.ts",
        "src/openapi-generate.ts",
        // A rota do WebSocket precisa de socket e de NATS: coberta pelo
        // teste de integração.
        "src/stream/rota.ts",
        "src/integration/**",
        "src/testes/**",
        "src/backfill.ts",
        // Leem e escrevem no Postgres: cobertos por src/integration/dados.test.ts.
        "src/dados/carga.ts",
        "src/dados/ingestao.ts",
        "src/dados/servico.ts",
        "src/jobs/admin.ts",
        "src/jobs/handlers.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
