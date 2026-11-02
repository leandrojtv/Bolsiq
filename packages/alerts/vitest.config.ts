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
        "src/integration/**",
        // Schema e o que fala com banco, NATS e SMTP: cobertos pelo teste de
        // integracao com Postgres e NATS reais.
        "src/db/**",
        "src/repositorio.ts",
        "src/worker.ts",
        "src/canais/email.ts",
      ],
      thresholds: { lines: 95, functions: 95, statements: 95, branches: 85 },
    },
  },
});
