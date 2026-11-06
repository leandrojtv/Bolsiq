import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { CONFERENCIA, cadastrar, emailNovo } from "./conta";

async function importar(page: Page, nome: string, conteudo: string) {
  await page.getByRole("button", { name: "Importar CSV ou extrato B3" }).click();
  const sheet = page.getByRole("dialog", { name: "Importar transações" });
  await sheet.getByLabel("Arquivo CSV").setInputFiles({
    name: nome,
    mimeType: "text/csv",
    buffer: Buffer.from(conteudo),
  });
  await sheet.getByRole("button", { name: "Importar", exact: true }).click();
  return sheet;
}

// Acha a celula pelo titulo da coluna: conferir so a linha nao pega cabecalho
// desalinhado (#27).
async function celula(posicoes: Locator, ticker: string, coluna: string) {
  const linha = posicoes.getByRole("row", { name: new RegExp(ticker) });
  await expect(linha).toBeVisible();
  const titulos = await posicoes.getByRole("columnheader").allTextContents();
  expect(titulos, `coluna ${coluna}`).toContain(coluna);
  return linha.locator("th, td").nth(titulos.indexOf(coluna));
}

async function conferir(
  posicoes: Locator,
  ticker: string,
  valores: Record<string, string | RegExp>,
) {
  for (const [coluna, valor] of Object.entries(valores))
    await expect(
      await celula(posicoes, ticker, coluna),
      `${ticker}, ${coluna}`,
    ).toHaveText(valor);
}

async function dinheiro(posicoes: Locator, ticker: string, coluna: string) {
  const texto = await (await celula(posicoes, ticker, coluna)).innerText();
  return Number(texto.replace(/[^\d,]/g, "").replace(",", "."));
}

test("carteira de conferência aparece com os mesmos números", async ({ page }) => {
  await cadastrar(page, emailNovo("conferencia"));
  const sheet = await importar(page, "conferencia.csv", CONFERENCIA);
  await expect(sheet.getByRole("status")).toContainText("10 de 10 linhas importadas");
  await page.keyboard.press("Escape");

  const posicoes = page.getByRole("region", { name: "Posições" });
  const petr = posicoes.getByRole("row", { name: /PETR4/ });
  await expect(petr).toContainText("Desdobramento 1:2 aplicado");
  await expect(posicoes.getByRole("columnheader")).toHaveText([
    "Ativo",
    "Qtd.",
    "Preço médio",
    "Cotação",
    "Custo",
    "Atual",
    "Não realizado",
    "Realizado",
    "Proventos",
  ]);
  const comPreco = {
    Cotação: /^R\$\s[\d.,]+$/,
    Atual: /^R\$\s[\d.,]+$/,
    "Não realizado": /^[▲▼]/,
  };
  await conferir(posicoes, "PETR4", {
    ...comPreco,
    "Qtd.": "180",
    "Preço médio": "R$ 18,03",
    Custo: "R$ 3.244,80",
    Realizado: "R$ 350,80",
    Proventos: "R$ 201,00",
  });
  await conferir(posicoes, "VALE3", {
    ...comPreco,
    "Qtd.": "50",
    "Preço médio": "R$ 61,26",
    Custo: "R$ 3.063,00",
    Realizado: "R$ 182,00",
    Proventos: "R$ 120,00",
  });
  // Cotacao e valor de mercado tem o mesmo formato; a conta e que os separa.
  expect(await dinheiro(posicoes, "VALE3", "Atual")).toBeCloseTo(
    50 * (await dinheiro(posicoes, "VALE3", "Cotação")),
    0,
  );
  await expect(page.getByRole("region", { name: "Resumo" })).toContainText("R$ 532,80");

  // O portfolio-worker grava os snapshots e o grafico aparece sem recarregar.
  await expect(
    page.getByRole("region", { name: "Rentabilidade" }).locator("canvas").first(),
  ).toBeVisible({
    timeout: 30_000,
  });
});

test("usuário B não vê a carteira do usuário A nem por URL", async ({ browser }) => {
  const a = await browser.newPage();
  const idA = await cadastrar(a, emailNovo("usuario-a"));
  await importar(a, "a.csv", CONFERENCIA);

  const b = await (await browser.newContext()).newPage();
  const idB = await cadastrar(b, emailNovo("usuario-b"));
  expect(idB).not.toBe(idA);

  const pagina = await b.goto(`/carteiras/${idA}`);
  expect(pagina?.status()).toBe(404);
  await expect(b.getByRole("region", { name: "Posições" })).toHaveCount(0);

  for (const [metodo, caminho] of [
    ["GET", `/api/carteiras/${idA}`],
    ["POST", `/api/carteiras/${idA}/transacoes`],
  ] as const) {
    const r = await b.request.fetch(caminho, {
      method: metodo,
      data: {
        ticker: "PETR4",
        tipo: "compra",
        data: "2024-01-02",
        quantidade: "1",
        preco: "1",
      },
    });
    expect(r.status(), `${metodo} ${caminho}`).toBe(404);
  }
  const lista = (await (await b.request.get("/api/carteiras")).json()) as {
    data: { id: string }[];
  };
  expect(lista.data.map((c) => c.id)).toEqual([idB]);

  // Sem sessao: 401 na API e redirecionamento na pagina.
  const anonimo = await (await browser.newContext()).newPage();
  expect((await anonimo.request.get(`/api/carteiras/${idA}`)).status()).toBe(401);
  await anonimo.goto(`/carteiras/${idA}`);
  await expect(anonimo).toHaveURL(/\/entrar\?volta=/);
});

test("importação de 500 linhas com relatório em menos de 5 s", async ({ page }) => {
  await cadastrar(page, emailNovo("importacao"));
  const linhas = ["data;ticker;tipo;quantidade;preco;taxas;corretora"];
  for (let i = 0; i < 500; i++) {
    const dia = String((i % 28) + 1).padStart(2, "0");
    const mes = String((i % 12) + 1).padStart(2, "0");
    linhas.push(
      `${dia}/${mes}/2023;${i % 2 ? "VALE3" : "PETR4"};compra;10;${(30 + (i % 7)).toFixed(2).replace(".", ",")};1,00;XP`,
    );
  }
  // Tres linhas ruins: data, tipo e quantidade.
  linhas[10] = "31/02/2023;PETR4;compra;10;30,00;0;XP";
  linhas[200] = "01/03/2023;PETR4;aluguel;10;30,00;0;XP";
  linhas[400] = "01/03/2023;VALE3;compra;dez;30,00;0;XP";

  const inicio = Date.now();
  const sheet = await importar(page, "quinhentas.csv", `${linhas.join("\n")}\n`);
  await expect(sheet.getByRole("status")).toContainText("497 de 500 linhas importadas");
  const decorrido = Date.now() - inicio;
  expect(decorrido).toBeLessThan(5_000);

  const rejeitadas = sheet
    .getByRole("region", { name: "Relatório da importação" })
    .getByRole("row");
  await expect(rejeitadas).toHaveCount(4);
  await expect(rejeitadas.nth(1)).toContainText("11");
});

test("nova transação pelo formulário rápido", async ({ page }) => {
  await cadastrar(page, emailNovo("transacao"));
  await page.getByRole("button", { name: "+ Transação" }).click();
  const sheet = page.getByRole("dialog", { name: "Nova transação" });
  await sheet.getByLabel("Ativo").fill("ITUB4");
  await sheet.getByLabel("Data").fill("2024-03-01");
  await sheet.getByLabel("Quantidade").fill("10");
  await sheet.getByLabel("Preço (R$)").fill("30,50");
  await sheet.getByRole("button", { name: "Salvar transação" }).click();
  await expect(sheet).toBeHidden();
  await conferir(page.getByRole("region", { name: "Posições" }), "ITUB4", {
    "Preço médio": "R$ 30,50",
    Custo: "R$ 305,00",
  });
});

const POSICAO = readFileSync(
  resolve(
    import.meta.dirname,
    "../../../packages/portfolio/src/fixtures/posicao-exemplo.csv",
  ),
  "utf8",
);

async function revisar(page: Page, conteudo: string) {
  await page.getByRole("button", { name: "Importar CSV ou extrato B3" }).click();
  const sheet = page.getByRole("dialog", { name: "Importar transações" });
  await sheet.getByLabel("Arquivo CSV").setInputFiles({
    name: "posicao.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(conteudo),
  });
  await sheet.getByRole("button", { name: "Revisar" }).click();
  return sheet;
}

test("importação de posições: revisão, confirmação e seção da carteira", async ({
  page,
}) => {
  await cadastrar(page, emailNovo("posicao"));
  const sheet = await revisar(page, POSICAO);

  const totais = sheet.getByRole("region", { name: "Total por corretora" });
  await expect(totais).toContainText("R$ 10.356,20");
  await expect(totais).toContainText("R$ 38.929,60");
  await expect(totais).toContainText("R$ 13.227,79");

  await expect(sheet.getByRole("region", { name: "Novas (4)" })).toContainText(
    "CDB NUBANK",
  );
  await expect(
    sheet.getByRole("region", { name: "Saldo inicial na renda variável (1)" }),
  ).toContainText("ITUB4");
  await expect(sheet.getByRole("region", { name: "Pendências (3)" })).toContainText(
    "sem CNPJ",
  );
  const rejeitadas = sheet.getByRole("region", { name: "Rejeitadas (4)" });
  await expect(rejeitadas).toContainText("7");
  await expect(rejeitadas).toContainText("quantidade: obrigatoria em acao");

  await sheet.getByRole("button", { name: "Confirmar importação" }).click();
  await expect(sheet.getByRole("status")).toContainText("5 de 9 linhas importadas");
  await page.keyboard.press("Escape");

  const secao = page.getByRole("region", { name: "Renda fixa, fundos e outros" });
  await expect(secao.getByRole("row", { name: /CDB NUBANK/ })).toContainText("120% CDI");
  await expect(secao.getByRole("row", { name: /NTN-B/ })).toContainText("IPCA + 7,95%");
  const fundo = secao.getByRole("row", { name: /Jive BossaNova/ });
  await expect(fundo).toContainText("valor do extrato de 05/11");
  await expect(fundo).toContainText("sem CNPJ");
  await expect(secao).toContainText("COE");
  await expect(page.getByRole("region", { name: "Rentabilidade" })).toContainText(
    "O TWR considera só a renda variável",
  );
  await expect(
    page.getByRole("region", { name: "Posições" }).getByRole("row", { name: /ITUB4/ }),
  ).toContainText("R$ 41,16");

  const alocacao = page.getByRole("region", { name: "Alocação" });
  for (const classe of ["Títulos públicos", "COE", "Fundos", "Renda fixa"])
    await expect(alocacao).toContainText(classe);
  await expect(page.getByRole("region", { name: "Resumo" })).toContainText(
    "R$ 59.241,94 pelo extrato",
  );
});

test("mesma carga é recusada; mais recente substitui só a corretora", async ({
  page,
}) => {
  await cadastrar(page, emailNovo("recarga"));
  let sheet = await revisar(page, POSICAO);
  await sheet.getByRole("button", { name: "Confirmar importação" }).click();
  await expect(sheet.getByRole("status")).toContainText("5 de 9");
  await page.keyboard.press("Escape");

  sheet = await revisar(page, POSICAO);
  await expect(sheet.getByRole("alert").first()).toContainText("já existe carga");
  await expect(
    sheet.getByRole("button", { name: "Confirmar importação" }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");

  const soXp = POSICAO.split("\n")
    .filter((l, i) => i === 0 || l.startsWith("2026-11-05,XP,"))
    .map((l) => l.replace("2026-11-05,", "2026-11-06,"))
    .filter((l) => !/imovel|PETR4/.test(l))
    .map((l) => l.replace("12884.64", "13000.00"))
    .join("\n");
  sheet = await revisar(page, soXp);
  await expect(sheet.getByRole("region", { name: "Alteradas (1)" })).toContainText(
    "R$ 13.000,00",
  );
  await sheet.getByRole("button", { name: "Confirmar importação" }).click();
  await expect(sheet.getByRole("status")).toContainText("3 de 3");
  await page.keyboard.press("Escape");

  const secao = page.getByRole("region", { name: "Renda fixa, fundos e outros" });
  await expect(secao.getByRole("row", { name: /Jive BossaNova/ })).toContainText(
    "valor do extrato de 06/11",
  );
  await expect(secao.getByRole("row", { name: /CDB NUBANK/ })).toContainText(
    "valor do extrato de 05/11",
  );
});
