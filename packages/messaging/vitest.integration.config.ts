import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/integration/**/*.test.ts"],
    // Postgres e NATS de verdade levam tempo a subir e a reconectar.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Em sequência: os testes compartilham broker e banco, e um derruba o
    // NATS de propósito.
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
