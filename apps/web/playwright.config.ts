import { defineConfig, devices } from "@playwright/test";

/**
 * e2e contra o app no ar (compose). BASE_URL aponta para ele; no CI o job e2e
 * sobe o compose com dados de exemplo (infra/docker/seed-e2e.sql).
 *
 * O projeto `capturas` so grava as telas em 390, 768 e 1440 px para comparar
 * a olho com docs/design/; nao compara pixel, porque o dado muda todo dia.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    colorScheme: "dark",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "e2e",
      testIgnore: /capturas\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } },
    },
    {
      name: "capturas",
      testMatch: /capturas\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
