import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const DESKTOP = { width: 1280, height: 800 };
const CELULAR = { width: 390, height: 844 };

const HISTORIAS: { id: string; viewport?: { width: number; height: number } }[] = [
  { id: "tokens--todos" },
  { id: "numeros--price-story" },
  { id: "numeros--change-story" },
  { id: "numeros--compact-story" },
  { id: "proveniencia--selos" },
  { id: "superficies--indicadores" },
  { id: "superficies--botoes" },
  { id: "controles--segmentado" },
  { id: "controles--chips" },
  { id: "controles--faixa" },
  { id: "controles--interruptor" },
  { id: "abas--detalhes" },
  { id: "tabela--screener" },
  { id: "tabela--estreita", viewport: CELULAR },
  { id: "estados--vazio" },
  { id: "estados--erro" },
  { id: "app-shell--desktop" },
  { id: "app-shell--mobile", viewport: CELULAR },
];

async function abrir(page: Page, id: string) {
  await page.goto(`/iframe.html?id=${id}&viewMode=story`);
  await page.locator("#storybook-root").waitFor();
  // Fonte carregada antes da captura: com fallback a largura do texto muda.
  await page.evaluate(() => document.fonts.ready);
}

for (const h of HISTORIAS) {
  test.describe(h.id, () => {
    test.use({ viewport: h.viewport ?? DESKTOP });

    test("visual", async ({ page }) => {
      await abrir(page, h.id);
      await expect(page).toHaveScreenshot(`${h.id}.png`, { fullPage: true });
    });

    test("acessibilidade", async ({ page }) => {
      await abrir(page, h.id);
      const r = await new AxeBuilder({ page }).include("#storybook-root").analyze();
      expect(
        r.violations.map(
          (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
        ),
      ).toEqual([]);
    });
  });
}

test("foco visivel no segmentado", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await abrir(page, "controles--segmentado");
  await page.keyboard.press("Tab");
  const foco = page.locator(":focus-visible");
  await expect(foco).toHaveAttribute("aria-pressed", "false");
  const contorno = await foco.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(contorno).toBe("solid");
});

test("alvos de toque de 44 px", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await abrir(page, "controles--segmentado");
  const alvo = await page.getByRole("button", { name: "6M" }).evaluate((el) => {
    const r = el.getBoundingClientRect();
    const depois = getComputedStyle(el, "::after");
    return { altura: r.height, extra: parseFloat(depois.top) };
  });
  // 36 px desenhados mais 4 px de cada lado pelo ::after.
  expect(alvo.altura - 2 * alvo.extra).toBeGreaterThanOrEqual(44);
});
