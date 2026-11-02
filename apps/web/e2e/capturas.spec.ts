import { test } from "@playwright/test";

const LARGURAS = [390, 768, 1440];

for (const largura of LARGURAS) {
  test(`ativo PETR4 em ${largura} px`, async ({ page }, info) => {
    await page.setViewportSize({ width: largura, height: largura === 390 ? 844 : 1000 });
    await page.goto("/ativo/PETR4");
    await page.locator("canvas").first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);
    await page.screenshot({
      path: info.outputPath(`ativo-PETR4-${largura}.png`),
      fullPage: true,
    });
  });
}
