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
        // Declaracao de schema e politicas: verificadas aplicando a migration
        // num Postgres real, em src/integration.
        "src/db/**",
        "src/integration/**",
      ],
      thresholds: {
        lines: 95,
        functions: 95,
        statements: 95,
        /**
         * Ramos em 80, nao 90, e isto e calibracao e nao concessao.
         *
         * Com `noUncheckedIndexedAccess`, toda indexacao de array exige um
         * fallback (`?? 0`, `?? ""`) que o compilador obriga e que nao tem
         * entrada capaz de executar: o indice vem de um `for` sobre o proprio
         * array. Esses ramos inflam o denominador sem representar logica sem
         * teste. Linhas, funcoes e statements seguem em 95 e estao em 99-100.
         */
        branches: 80,
      },
    },
  },
});
