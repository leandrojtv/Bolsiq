import { expect, test, type Page } from "@playwright/test";
import { publicarCotacao } from "./banco";
import { CONFERENCIA, cadastrar, emailNovo } from "./conta";

/** Regras e uma notificacao disparada, para a captura de /alertas nao sair vazia. */
async function prepararAlertas(page: Page) {
  await page.goto("/configuracoes/notificacoes");
  const regras = [
    { ticker: "PETR4", tipo: "preco_acima", valor: "10" },
    { ticker: "VALE3", tipo: "abaixo_graham" },
    { ticker: "ITUB4", tipo: "variacao_diaria", valor: "3" },
    { ticker: "HGLG11", tipo: "provento_anunciado" },
  ];
  const ids: string[] = [];
  for (const r of regras) {
    const res = await page.request.post("/api/alertas/regras", {
      data: { ...r, canais: ["inapp"], cooldown_segundos: 86400, silencio: "nenhum" },
    });
    ids.push(((await res.json()) as { data: { id: string } }).data.id);
  }
  await page.request.patch(`/api/alertas/regras/${ids[2]}`, { data: { ativo: false } });
  // O worker recarrega as regras a cada 2 s.
  await page.waitForTimeout(3000);
  publicarCotacao("PETR4", "99.00");
  await page.waitForTimeout(2000);
}

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

/** Conta nova com a carteira de conferencia e os snapshots ja gravados. */
async function prepararCarteira(page: Page): Promise<string> {
  const id = await cadastrar(page, emailNovo("captura"));
  await page.request.post(`/api/carteiras/${id}/importacoes`, {
    multipart: {
      formato: "bolsiq",
      arquivo: {
        name: "conferencia.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(CONFERENCIA),
      },
    },
  });
  await expect
    .poll(
      async () =>
        (
          (await (await page.request.get(`/api/carteiras/${id}`)).json()) as {
            data: { recalculando: boolean };
          }
        ).data.recalculando,
      { timeout: 60_000 },
    )
    .toBe(false);
  return `/carteiras/${id}`;
}

for (const largura of [390, 1440]) {
  test(`carteira em ${largura} px`, async ({ page }, info) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: largura, height: largura === 390 ? 844 : 1100 });
    await page.goto(await prepararCarteira(page));
    await page.locator("canvas").first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: info.outputPath(`carteira-${largura}.png`),
      fullPage: true,
    });
  });

  for (const [nome, rota] of [
    ["comparar", "/comparar?t=PETR4,PRIO3,HGLG11,07455507000189&p=1A"],
    ["screener", "/screener?preset=graham"],
    ["alertas", "/alertas?t=PETR4"],
    ["notificacoes", "/configuracoes/notificacoes"],
    ["entrar", "/entrar"],
  ] as const) {
    test(`${nome} em ${largura} px`, async ({ page }, info) => {
      await page.setViewportSize({
        width: largura,
        height: largura === 390 ? 844 : 1100,
      });
      if (nome === "alertas") await prepararAlertas(page);
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
