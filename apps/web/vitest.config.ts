import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      "server-only": fileURLToPath(new URL("./testes/server-only.ts", import.meta.url)),
    },
  },
  // O tsconfig do Next usa jsx "preserve"; o teste precisa do JSX transformado.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "jsdom",
    // Sem URL o jsdom tem origem opaca e nao oferece localStorage.
    environmentOptions: { jsdom: { url: "http://localhost/" } },
    setupFiles: ["./testes/setup.ts"],
    include: ["lib/**/*.test.ts", "componentes/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "json"],
      reportsDirectory: "coverage",
      include: [
        "lib/indicadores-tecnicos.ts",
        "lib/market-data.ts",
        "componentes/watchlist.ts",
        "lib/carteira-modelo.ts",
      ],
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
});
