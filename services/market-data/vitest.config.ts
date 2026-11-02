import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
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
