import { expect, test } from "@playwright/test";
import { filtroDoPreset } from "@bolsiq/analytics/puro";
import { consultar, publicarEvento } from "./banco";

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

  test("FII com P/VP e DY 12m do informe mensal da CVM, sem brapi", async ({
    page,
    request,
  }) => {
    // O que o market-data publica ao gravar um informe: o analytics-worker
    // consome, le /v1/fiis/{ticker}/monthly e recalcula.
    const fiis = {
      HGLG11: "11728688000147",
      KNCR11: "16706958000132",
      XPML11: "28757546000100",
    };
    for (const [ticker, cnpj] of Object.entries(fiis)) {
      publicarEvento("marketdata.fii.report.published.v1", {
        cnpj,
        tickers: [ticker],
        reference_date: "2026-09-01",
      });
    }

    type Resultado = {
      linhas: {
        ticker: string;
        preco: string;
        indicadores: Record<string, number | null>;
      }[];
    };
    const porPvp = async () =>
      (await (
        await request.post("/api/screener", {
          data: { tipos: ["fii"], ordenar_por: "pvp", ordem: "asc" },
        })
      ).json()) as Resultado;
    await expect
      .poll(async () => (await porPvp()).linhas.map((l) => l.ticker).sort(), {
        timeout: 60_000,
      })
      .toEqual(Object.keys(fiis).sort());

    // Conferido contra o banco: preco do ultimo pregao sobre o VP da ultima
    // competencia, e 12 meses de DY x VP (mes negativo conta zero) sobre o preco.
    for (const l of (await porPvp()).linhas) {
      const [linha] = consultar(
        `with f as (select * from market_data.fii_monthly where cnpj = '${fiis[l.ticker as keyof typeof fiis]}'),
              u as (select * from f order by reference_date desc limit 1),
              p as (select close from market_data.quotes_daily where ticker = '${l.ticker}' order by date desc limit 1)
         select p.close / u.nav_per_share,
                (select sum(greatest(dividend_yield_month, 0) * nav_per_share) from f
                  where reference_date > u.reference_date - interval '12 months') / p.close,
                u.equity, u.holders
         from u, p`,
      );
      const [pvp, dy, pl, cotistas] = (linha ?? []).map(Number) as [
        number,
        number,
        number,
        number,
      ];
      expect(l.indicadores.pvp, l.ticker).toBeCloseTo(pvp, 4);
      expect(l.indicadores.dy_12m, l.ticker).toBeCloseTo(dy, 4);
      expect(l.indicadores.patrimonio_liquido, l.ticker).toBeCloseTo(pl, 0);
      expect(l.indicadores.cotistas, l.ticker).toBe(cotistas);
      expect(dy).toBeGreaterThan(0.05);
    }

    // Preset de FII: so quem passa nas faixas.
    const filtro = filtroDoPreset("fii_desconto");
    const preset = (await (
      await request.post("/api/screener", { data: filtro })
    ).json()) as Resultado;
    expect(preset.linhas.length).toBeGreaterThan(0);
    for (const l of preset.linhas) {
      expect(l.indicadores.pvp).toBeLessThanOrEqual(1);
      expect(l.indicadores.dy_12m).toBeGreaterThanOrEqual(0.08);
    }

    // Tela: ordenada por DY 12m, com as colunas de fundo.
    await page.goto("/screener?tipos=fii&ord=dy_12m&dir=desc");
    const tabela = page.getByRole("table", { name: "Resultado do screener" });
    await expect(tabela.getByRole("columnheader", { name: "P/VP" })).toBeVisible();
    await expect(tabela.getByRole("columnheader", { name: "Cotistas" })).toBeVisible();
    for (const t of Object.keys(fiis)) {
      await expect(tabela.getByRole("row", { name: new RegExp(t) })).toBeVisible();
    }
  });

  test("FII aparece com a ordenacao padrao por P/L, depois das acoes", async ({
    page,
    request,
  }) => {
    const res = await request.post("/api/screener", {
      data: { tipos: ["stock", "fii"], limite: 1000 },
    });
    const { linhas } = (await res.json()) as {
      linhas: { ticker: string; kind: string }[];
    };
    const tipos = linhas.map((l) => l.kind);
    expect(tipos).toContain("fii");
    // Acoes com P/L primeiro, FII no fim.
    expect(tipos.indexOf("fii")).toBeGreaterThan(tipos.lastIndexOf("stock"));

    await page.goto("/screener?tipos=fii");
    await expect(page.getByRole("row", { name: /HGLG11/ })).toBeVisible();
    await expect(page.getByText(/P\/L só existe para ações/)).toBeVisible();
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
