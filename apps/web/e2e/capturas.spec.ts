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

for (const largura of [390, 1440]) {
  for (const [nome, rota] of [
    ["comparar", "/comparar?t=PETR4,PRIO3,HGLG11,07455507000189&p=1A"],
    ["screener", "/screener?preset=graham"],
  ] as const) {
    test(`${nome} em ${largura} px`, async ({ page }, info) => {
      await page.setViewportSize({
        width: largura,
        height: largura === 390 ? 844 : 1100,
      });
      await page.goto(rota);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(1500);
      await page.screenshot({
        path: info.outputPath(`${nome}-${largura}.png`),
        fullPage: true,
      });
    });
  }
}
