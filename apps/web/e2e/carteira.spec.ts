import { expect, test, type Page } from "@playwright/test";
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

test("carteira de conferência aparece com os mesmos números", async ({ page }) => {
  await cadastrar(page, emailNovo("conferencia"));
  const sheet = await importar(page, "conferencia.csv", CONFERENCIA);
  await expect(sheet.getByRole("status")).toContainText("10 de 10 linhas importadas");
  await page.keyboard.press("Escape");

  const posicoes = page.getByRole("region", { name: "Posições" });
  const petr = posicoes.getByRole("row", { name: /PETR4/ });
  await expect(petr).toContainText("Desdobramento 1:2 aplicado");
  for (const v of ["180", "R$ 18,03", "R$ 3.244,80", "R$ 350,80", "R$ 201,00"])
    await expect(petr).toContainText(v);
  const vale = posicoes.getByRole("row", { name: /VALE3/ });
  for (const v of ["50", "R$ 61,26", "R$ 3.063,00", "R$ 182,00", "R$ 120,00"])
    await expect(vale).toContainText(v);
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
  await expect(
    page.getByRole("region", { name: "Posições" }).getByRole("row", { name: /ITUB4/ }),
  ).toContainText("R$ 30,50");
});
