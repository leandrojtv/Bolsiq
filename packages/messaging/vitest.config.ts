import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Sem isto o run unitário coleta src/integration/** e tenta subir
    // containers — o unitário tem de rodar sem Docker.
    include: ["src/**/*.test.ts"],
    exclude: ["src/integration/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "json"],
      reportsDirectory: "coverage",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        // Barris de reexportação não têm lógica a cobrir.
        "**/index.ts",
        // Estes três precisam de NATS ou Postgres de verdade e são cobertos
        // pelo teste de integração (src/integration/), não pelo unitário.
        // Mocká-los testaria o mock, não a garantia de entrega.
        "src/client.ts",
        "src/consumer.ts",
        "src/publisher.ts",
        "src/efemero.ts",
        // Os próprios testes de integração e seus ajudantes.
        "src/integration/**",
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
      },
    },
  },
});
