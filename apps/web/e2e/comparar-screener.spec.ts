import { expect, test } from "@playwright/test";
import { filtroDoPreset } from "@bolsiq/analytics/puro";
import { consultar } from "./banco";

const FUNDO = "07455507000189";

test.describe("comparador", () => {
  test("acao, FII e fundo na mesma tela", async ({ page }) => {
    await page.goto(`/comparar?t=PETR4,HGLG11,${FUNDO}&p=1A`);
    const chips = page.getByRole("region", { name: "Ativos comparados" });
    await expect(chips.getByText("Ação", { exact: true })).toBeVisible();
    await expect(chips.getByText("FII", { exact: true })).toBeVisible();
    await expect(chips.getByText("Fundo", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("img", { name: /Rentabilidade acumulada/ }),
    ).toBeVisible();
    await expect(page.locator("canvas").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "CDI" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("rowheader", { name: "P/L" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Drawdown" })).toBeVisible();
  });

  test("estado na URL: remover e trocar periodo", async ({ page }) => {
    await page.goto("/comparar?t=PETR4,VALE3,IBOV&p=1A");
    await page.getByRole("button", { name: "Remover VALE3" }).click();
    await expect(page).toHaveURL(/t=PETR4%2CIBOV|t=PETR4,IBOV/);
    await page
      .getByRole("group", { name: "Período" })
      .getByRole("button", { name: "6M" })
      .click();
    await expect(page).toHaveURL(/p=6M/);
  });

  test("melhor da linha vem da regra do analytics", async ({ request }) => {
    const c = (await (
      await request.get("/api/comparar?t=PETR4,VALE3,PRIO3&p=1A")
    ).json()) as {
      tabela: { indicador: string; valores: (number | null)[]; melhores: number[] }[];
    };
    // P/L: o menor entre os positivos. ROE: o maior. Conferido contra os
    // valores da propria resposta, para valer com qualquer dado.
    const indices = (l: { valores: (number | null)[] }, alvo: number) =>
      l.valores.flatMap((v, i) => (v === alvo ? [i] : []));
    const pl = c.tabela.find((l) => l.indicador === "pl");
    const positivos = (pl?.valores ?? []).filter((v): v is number => v !== null && v > 0);
    if (pl && positivos.length >= 2)
      expect(pl.melhores).toEqual(indices(pl, Math.min(...positivos)));
    const roe = c.tabela.find((l) => l.indicador === "roe");
    const definidos = (roe?.valores ?? []).filter((v): v is number => v !== null);
    if (roe && definidos.length >= 2)
      expect(roe.melhores).toEqual(indices(roe, Math.max(...definidos)));
    expect(c.tabela.find((l) => l.indicador === "beta")?.melhores).toEqual([]);
  });

  test("sem ativos mostra o estado vazio", async ({ page }) => {
    await page.goto("/comparar");
    await expect(page.getByText("Nada para comparar ainda")).toBeVisible();
  });
});

test.describe("screener", () => {
  test("preset Graham so devolve quem passa nas faixas do codigo, conferido no banco", async ({
    request,
  }) => {
    const filtro = filtroDoPreset("graham");
    const res = await request.post("/api/screener", { data: filtro });
    expect(res.status()).toBe(200);
    const r = (await res.json()) as {
      total: number;
      ms: number;
      linhas: {
        ticker: string;
        kind: string;
        indicadores: Record<string, number | null>;
      }[];
    };
    expect(r.total).toBeGreaterThan(0);
    expect(r.ms).toBeLessThan(300);

    for (const l of r.linhas) {
      expect(l.kind).toBe("stock");
      for (const [nome, faixa] of Object.entries(filtro.faixas)) {
        const v = l.indicadores[nome];
        expect(v, `${l.ticker} ${nome}`).not.toBeNull();
        if (faixa.min !== undefined) expect(v).toBeGreaterThanOrEqual(faixa.min);
        if (faixa.max !== undefined) expect(v).toBeLessThanOrEqual(faixa.max);
      }
    }

    // A primeira linha, lida direto do banco: mesmos numeros e mesmas faixas.
    const primeira = r.linhas[0];
    const [linha] = consultar(
      `select margem_graham, pl, pvp from analytics.indicators where ticker = '${primeira?.ticker}' order by reference_date desc limit 1`,
    );
    const [mg, pl, pvp] = (linha ?? []).map(Number) as [number, number, number];
    expect(mg).toBeCloseTo(primeira?.indicadores.margem_graham ?? NaN, 5);
    expect(pl).toBeCloseTo(primeira?.indicadores.pl ?? NaN, 5);
    expect(mg).toBeGreaterThanOrEqual(0.2);
    expect(pl).toBeGreaterThanOrEqual(0);
    expect(pl).toBeLessThanOrEqual(15);
    expect(pvp).toBeLessThanOrEqual(1.5);

    // E quem tem a margem mas nao o P/L fica de fora.
    // Ultima linha de cada ticker, como o screener: linha antiga nao conta.
    const fora = consultar(
      `select ticker from (select distinct on (ticker) ticker, margem_graham, pl from analytics.indicators
         order by ticker, reference_date desc) u where margem_graham >= 0.2 and pl > 15 limit 5`,
    ).map(([t]) => t);
    for (const t of fora) expect(r.linhas.map((l) => l.ticker)).not.toContain(t);
  });

  test("filtro invalido responde 422", async ({ request }) => {
    const res = await request.post("/api/screener", {
      data: { faixas: { pl: { min: 10, max: 5 } } },
    });
    expect(res.status()).toBe(422);
  });

  test("tela: preset, selecao, comparar e CSV", async ({ page }) => {
    await page.goto("/screener?preset=graham");
    await expect(page.getByRole("button", { name: /^Graham/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const linhas = page
      .getByRole("table", { name: "Resultado do screener" })
      .getByRole("row");
    await expect(linhas.nth(1)).toBeVisible();

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Exportar CSV" }).click();
    const csv = await (await download).path();
    expect(csv).toBeTruthy();

    // Ate 6 selecionados; com 2 o botao abre o comparador.
    const caixas = page.getByRole("checkbox", { name: /^Selecionar / });
    if ((await caixas.count()) >= 2) {
      await caixas.nth(0).check();
      await caixas.nth(1).check();
      await page.getByRole("button", { name: /Comparar selecionados/ }).click();
      await expect(page).toHaveURL(/\/comparar\?t=/);
    }
  });

  test("estado na URL sobrevive ao recarregar", async ({ page }) => {
    await page.goto("/screener?tipos=stock&f=pl:0:12&ord=roe&dir=desc");
    await page.reload();
    await expect(page.getByText(/ordenado por ROE \(decrescente\)/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Remover filtro P/L" })).toBeVisible();
  });
});
