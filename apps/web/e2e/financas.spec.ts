import { expect, test } from "@playwright/test";
import { cadastrar, emailNovo, entrar } from "./conta";

test("Bolsiq Finanças: criar conta, lançar despesa e ver na lista", async ({ page }) => {
  const email = emailNovo("financas");
  await cadastrar(page, email);

  // Seletor de modulo leva ao Bolsiq Financas, que guia para a primeira conta.
  await page
    .getByRole("navigation", { name: "Módulo" })
    .first()
    .getByRole("link", { name: "Finanças" })
    .click();
  await expect(page).toHaveURL(/\/financas$/);
  await expect(page.getByText("Bolsiq Finanças").first()).toBeVisible();
  await page.getByRole("link", { name: "Criar primeira conta" }).click();

  const sheet = page.getByRole("dialog", { name: "Nova conta" });
  await sheet.getByLabel("Nome da conta").fill("Conta do banco");
  await sheet.getByLabel("Saldo inicial (R$)").fill("1.000,00");
  await sheet.getByRole("button", { name: "Criar conta" }).click();
  await expect(sheet).toBeHidden();
  const contas = page.getByRole("list", { name: "Contas" });
  await expect(contas).toContainText("Conta do banco");
  await expect(contas).toContainText("R$ 1.000,00");

  await page
    .getByRole("navigation", { name: "Navegação principal" })
    .first()
    .getByRole("link", { name: "Lançamentos" })
    .click();
  const rapido = page.getByRole("form", { name: "Lançamento rápido" });
  await rapido.getByLabel("Valor").fill("45,90");
  await rapido.getByLabel("Descrição").fill("Padaria");
  await rapido.getByLabel("Categoria").selectOption({ label: "Mercado" });
  // Enter salva.
  await rapido.getByLabel("Descrição").press("Enter");
  await expect(rapido.getByLabel("Valor")).toHaveValue("");

  const lista = page.getByRole("table", { name: "Lançamentos" });
  const linha = lista.getByRole("row", { name: /Padaria/ });
  await expect(linha).toContainText("-R$ 45,90");
  await expect(linha).toContainText("Mercado");

  // O saldo da conta ja desconta a despesa.
  await page.goto("/financas/contas");
  await expect(page.getByRole("list", { name: "Contas" })).toContainText("R$ 954,10");

  // A exportacao LGPD leva os dados de financas.
  await page.goto("/configuracoes/conta");
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Exportar meus dados" }).click();
  const dados = JSON.parse(
    await (
      await (await download).createReadStream()
    )
      .toArray()
      .then((b: Buffer[]) => Buffer.concat(b).toString()),
  ) as { financas: { contas: { nome: string }[]; lancamentos: { descricao: string }[] } };
  expect(dados.financas.contas.map((c) => c.nome)).toEqual(["Conta do banco"]);
  expect(dados.financas.lancamentos.map((l) => l.descricao)).toEqual(["Padaria"]);

  // O ultimo modulo usado vira a entrada depois do login; /configuracoes nao conta.
  const contexto = page.context();
  const modulo = (await contexto.cookies()).filter((c) => c.name === "bolsiq_modulo");
  expect(modulo.map((c) => c.value)).toEqual(["financas"]);
  await contexto.clearCookies();
  await contexto.addCookies(modulo);
  await entrar(page, email);
  await page.waitForURL(/\/financas$/);
});
