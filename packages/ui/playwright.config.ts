import { defineConfig } from "@playwright/test";

/**
 * Regressao visual sobre o Storybook estatico.
 *
 * As imagens de referencia sao geradas e comparadas dentro da imagem oficial
 * do Playwright (make ui-visual), no CI e na maquina de quem desenvolve:
 * fonte e antialias mudam entre sistemas, e referencia gerada no macOS
 * reprovaria no Linux do CI sem nada ter mudado.
 */
export default defineConfig({
  testDir: "tests/visual",
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}{ext}",
  fullyParallel: true,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: "disabled" },
  },
  use: {
    baseURL: "http://127.0.0.1:6006",
    colorScheme: "dark",
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
  },
  webServer: {
    command: "node scripts/servir.mjs 6006 storybook-static",
    url: "http://127.0.0.1:6006/iframe.html",
    reuseExistingServer: !process.env.CI,
  },
});
