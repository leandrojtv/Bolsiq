import { expect, test } from "@playwright/test";
import { cadastrar, emailNovo } from "./conta";

const CHAVE = "sk-e2e-chave-de-teste-do-bolsiq-1234";

test("Bolsiq Finanças: o assistente abre no módulo e responde com dado de ferramenta", async ({
  page,
}) => {
  await cadastrar(page, emailNovo("agente-financeiro"));

  await page.goto("/configuracoes/assistente");
  await page.getByLabel("Provedor", { exact: true }).selectOption("deepseek");
  await page.getByLabel("Chave de API").fill(CHAVE);
  await page.getByRole("button", { name: "Testar conexão" }).click();
  await expect(page.getByRole("status")).toContainText("Conexão ok");
  await page.getByLabel("Modelo", { exact: true }).selectOption("falso-com-ferramentas");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByRole("status")).toContainText("Configuração salva");
  // Relatorio mensal: opt-in, desligado por padrao, com a estimativa na tela.
  const relatorio = page.getByRole("region", { name: "Relatório mensal" });
  await expect(relatorio).toContainText("Gasta tokens");
  await expect(relatorio.getByRole("switch")).not.toBeChecked();

  await page.goto("/financas/contas?nova=1");
  const conta = page.getByRole("dialog", { name: "Nova conta" });
  await conta.getByLabel("Nome da conta").fill("Corrente");
  await conta.getByLabel("Saldo inicial (R$)").fill("3.000,00");
  await conta.getByRole("button", { name: "Criar conta" }).click();
  await expect(conta).toBeHidden();

  await page.goto("/financas/lancamentos");
  const rapido = page.getByRole("form", { name: "Lançamento rápido" });
  await rapido.getByLabel("Valor").fill("123,45");
  await rapido.getByLabel("Descrição").fill("Supermercado do bairro");
  await rapido.getByLabel("Categoria").selectOption({ label: "Mercado" });
  await rapido.getByLabel("Descrição").press("Enter");
  await expect(rapido.getByLabel("Valor")).toHaveValue("");

  await page.goto("/financas");
  await page.getByRole("button", { name: "Pergunte ao Bolsiq" }).click();
  const painel = page.getByRole("dialog", { name: "Pergunte ao Bolsiq" });
  // Consentimento do modulo: diz quais dados financeiros vao ao provedor.
  const consentimento = painel.getByRole("region", { name: "Consentimento" });
  await expect(consentimento).toContainText("lançamentos");
  await expect(consentimento).toContainText("[pessoa]");
  await consentimento.getByRole("button", { name: "Concordo, continuar" }).click();

  await painel.getByRole("button", { name: "Como está o meu mês?" }).click();
  const resposta = painel.getByRole("article", { name: "Resposta do Bolsiq" }).last();
  await expect(resposta).toContainText("Despesas: R$ 123,45", { timeout: 30_000 });
  await expect(resposta.getByText(/Lendo o resumo do mês/)).toBeVisible();

  // O mesmo numero do dashboard, lido direto do BFF.
  const r = await page.request.get("/api/financas/painel");
  const { data } = (await r.json()) as { data: { despesas: { total: string } } };
  expect(data.despesas.total).toBe("123.45");
});
