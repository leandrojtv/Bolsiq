import { expect, test, type Page } from "@playwright/test";
import { cadastrar, emailNovo } from "./conta";

const brl = (v: string) =>
  `R$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hoje = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

async function post(page: Page, caminho: string, data: unknown) {
  const r = await page.request.post(caminho, { data });
  expect(r.ok(), `${caminho}: ${await r.text()}`).toBe(true);
  return ((await r.json()) as { data: { id: string } }).data;
}

/**
 * Painel geral com dados de seed: uma carteira com acao, uma conta com renda,
 * gasto e aporte do mes, e uma meta ligada a carteira. A tela mostra o mesmo
 * numero que o BFF calcula, e o atalho abre o assistente no Painel.
 */
test("Painel geral: patrimonio consolidado, mes, metas e atalho do assistente", async ({
  page,
}) => {
  const carteira = await cadastrar(page, emailNovo("painel"));
  const dia = hoje();

  await post(page, `/api/carteiras/${carteira}/transacoes`, {
    ticker: "PETR4",
    tipo: "compra",
    data: "2024-03-01",
    quantidade: "10",
    preco: "30,50",
  });
  const conta = await post(page, "/api/financas/contas", {
    nome: "Corrente",
    tipo: "corrente",
    saldo_inicial: "1000",
    data_saldo_inicial: `${dia.slice(0, 7)}-01`,
  });
  const categorias = (
    (await (await page.request.get("/api/financas/categorias")).json()) as {
      data: { id: string; nome: string }[];
    }
  ).data;
  const cat = (nome: string) => categorias.find((c) => c.nome === nome)?.id;
  for (const l of [
    { tipo: "receita", valor: "5000", descricao: "Salario", category_id: cat("Salário") },
    { tipo: "despesa", valor: "1200", descricao: "Mercado", category_id: cat("Mercado") },
    {
      tipo: "despesa",
      valor: "500",
      descricao: "Aporte Tesouro",
      category_id: cat("Investimentos (aporte)"),
    },
  ])
    await post(page, "/api/financas/lancamentos", {
      ...l,
      data: dia,
      account_id: conta.id,
    });
  await post(page, "/api/financas/metas", {
    nome: "Independencia",
    valor_alvo: "100000",
    data_alvo: "2030-12-31",
    portfolio_id: carteira,
  });

  const api = (
    (await (await page.request.get("/api/financas/painel-geral")).json()) as {
      data: {
        patrimonio: {
          patrimonio_liquido: string;
          contas: string;
          renda_variavel: string;
        };
        mes: {
          renda: string;
          despesas: string;
          investido: string;
          taxa_de_poupanca: number;
        };
      };
    }
  ).data;
  // 1000 + 5000 - 1200 - 500 na conta; o aporte nao e gasto.
  expect(api.patrimonio.contas).toBe("4300.00");
  expect(api.mes).toMatchObject({
    renda: "5000.00",
    despesas: "1200.00",
    investido: "500.00",
    taxa_de_poupanca: 76,
  });

  await page.goto("/painel");
  const topo = page.getByRole("region", { name: "Patrimônio líquido" });
  await expect(topo).toContainText(brl(api.patrimonio.patrimonio_liquido));
  const composicao = page.getByRole("list", { name: "Composição do patrimônio" });
  await expect(composicao).toContainText("Contas");
  await expect(composicao).toContainText(brl("4300"));
  if (Number(api.patrimonio.renda_variavel) > 0)
    await expect(composicao).toContainText(brl(api.patrimonio.renda_variavel));

  const mes = page.getByRole("region", { name: "Mês atual" });
  await expect(mes).toContainText(brl("5000"));
  await expect(mes).toContainText("76%");
  await expect(page.getByRole("list", { name: "Metas" })).toContainText("Independencia");
  await expect(page.getByRole("list", { name: "Metas" })).toContainText("(carteira)");

  await page.getByRole("button", { name: "Perguntar ao Bolsiq" }).click();
  await expect(page.getByRole("dialog", { name: "Pergunte ao Bolsiq" })).toBeVisible();
});
