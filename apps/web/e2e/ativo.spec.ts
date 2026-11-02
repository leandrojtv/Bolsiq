import { expect, test } from "@playwright/test";

test.describe("pagina do ativo", () => {
  test("PETR4 com cabecalho, grafico, indicadores e abas", async ({ page }) => {
    const res = await page.goto("/ativo/PETR4");
    expect(res?.status()).toBe(200);

    await expect(
      page.getByRole("heading", { level: 1, name: "PETR4" }).first(),
    ).toBeVisible();
    await expect(page.getByText(/^R\$ \d/).first()).toBeVisible();
    await expect(page.getByText(/^Fonte: /).first()).toBeVisible();
    await expect(
      page.getByRole("img", { name: /Gráfico de preço de PETR4/ }),
    ).toBeVisible();
    await expect(page.locator("canvas").first()).toBeVisible();

    await expect(page.getByRole("heading", { name: "Indicadores" })).toBeVisible();
    await expect(
      page.getByText("Não é recomendação.", { exact: false }).first(),
    ).toBeVisible();

    const periodo = page.getByRole("group", { name: "Período" }).first();
    await periodo.getByRole("button", { name: "1A" }).click();
    await expect(periodo.getByRole("button", { name: "1A" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await page.getByRole("tab", { name: "Demonstrativos" }).click();
    await expect(page.getByRole("rowheader", { name: "Receita líquida" })).toBeVisible();
    await page.getByRole("tab", { name: "Sobre" }).click();
    await expect(page.getByText("CNPJ")).toBeVisible();

    await expect(page.getByRole("link", { name: "Comparar" }).last()).toHaveAttribute(
      "href",
      "/comparar?t=PETR4",
    );
  });

  test("ticker inexistente tem 404 proprio", async ({ page }) => {
    const res = await page.goto("/ativo/XXXX9");
    expect(res?.status()).toBe(404);
    await expect(page.getByText("Ativo não encontrado")).toBeVisible();
  });

  test("busca global com Ctrl+K e autocomplete", async ({ page }) => {
    await page.goto("/ativo/PETR4");
    await page.keyboard.press("Control+k");
    const busca = page.getByRole("combobox", { name: "Buscar ativo" });
    await expect(busca).toBeFocused();
    await busca.fill("vale");
    await expect(page.getByRole("option", { name: /VALE3/ })).toBeVisible();
    await busca.press("Enter");
    await expect(page).toHaveURL(/\/ativo\/VALE3$/);
  });

  test("watchlist persiste no aparelho", async ({ page }) => {
    await page.goto("/ativo/VALE3");
    await page.evaluate(() =>
      localStorage.setItem("bolsiq:watchlist", JSON.stringify(["PETR4"])),
    );
    await page.reload();
    const botao = page.getByRole("button", { name: "+ Watchlist" });
    await botao.click();
    await page.reload();
    await expect(page.getByRole("button", { name: "✓ Na watchlist" })).toBeVisible();
    const lista = await page.evaluate(() => localStorage.getItem("bolsiq:watchlist"));
    expect(JSON.parse(lista ?? "[]")).toEqual(["PETR4", "VALE3"]);
  });

  test("celular: navegacao inferior e topo proprio", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/ativo/PETR4");
    // Os dois menus estao no DOM; no celular so o inferior aparece.
    const navs = page.locator('nav[aria-label="Navegação principal"]');
    await expect(navs).toHaveCount(2);
    await expect(navs.first()).toBeHidden();
    await expect(navs.last()).toBeVisible();
    await expect(page.getByRole("link", { name: "Voltar" })).toBeVisible();
    await expect(page.getByRole("button", { name: /watchlist/i }).first()).toBeVisible();
  });
});

test.describe("BFF e PWA", () => {
  test("BFF repassa so as rotas de leitura", async ({ request }) => {
    expect((await request.get("/api/v1/assets/PETR4")).status()).toBe(200);
    expect((await request.get("/api/v1/admin/jobs")).status()).toBe(404);
    expect((await request.get("/api/health")).status()).toBe(200);
  });

  test("nenhuma chave de API na pagina servida", async ({ request }) => {
    const html = await (await request.get("/ativo/PETR4")).text();
    expect(html).not.toMatch(/mdk_(live|test)_/);
  });

  test("manifest e service worker", async ({ request }) => {
    const manifest = (await (await request.get("/manifest.webmanifest")).json()) as {
      icons: { src: string; purpose: string }[];
    };
    expect(manifest.icons.map((i) => i.purpose)).toContain("maskable");
    for (const i of manifest.icons) expect((await request.get(i.src)).status()).toBe(200);
    expect((await request.get("/sw.js")).headers()["content-type"]).toMatch(/javascript/);
  });
});
