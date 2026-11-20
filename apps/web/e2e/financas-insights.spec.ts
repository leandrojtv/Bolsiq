import { expect, test } from "@playwright/test";
import { cadastrar, emailNovo } from "./conta";

test("Bolsiq Finanças: abrir um insight, ver as evidências e dispensar", async ({
  page,
}) => {
  await cadastrar(page, emailNovo("insights"));

  await page.goto("/financas/contas?nova=1");
  const conta = page.getByRole("dialog", { name: "Nova conta" });
  await conta.getByLabel("Nome da conta").fill("Corrente");
  await conta.getByLabel("Saldo inicial (R$)").fill("3.000,00");
  await conta.getByRole("button", { name: "Criar conta" }).click();
  await expect(conta).toBeHidden();

  // Uma tarifa no mes vira o insight de tarifas e juros.
  await page.goto("/financas/lancamentos");
  const rapido = page.getByRole("form", { name: "Lançamento rápido" });
  await rapido.getByLabel("Valor").fill("39,90");
  await rapido.getByLabel("Descrição").fill("Tarifa Pacote Servicos");
  await rapido.getByLabel("Categoria").selectOption({ label: "Tarifas bancárias" });
  await rapido.getByLabel("Descrição").press("Enter");
  await expect(rapido.getByLabel("Valor")).toHaveValue("");

  // O dashboard mostra o maior impacto em "Onde otimizar".
  await page.goto("/financas");
  await expect(page.getByRole("list", { name: "Onde otimizar" })).toContainText(
    "em tarifas e juros em 12 meses",
  );

  await page.goto("/financas/insights");
  const card = page.getByRole("article", { name: /tarifas e juros em 12 meses/ });
  await expect(card).toContainText("R$ 39,90");
  await card.getByRole("button", { name: "Ver lançamentos e ações" }).click();
  await expect(
    card.getByRole("table", { name: "Lançamentos de evidência" }),
  ).toContainText("Tarifa Pacote Servicos");

  await card.getByRole("button", { name: "Dispensar" }).click();
  await expect(card).toBeHidden();
  await expect(page.getByRole("region", { name: "Resumo dos insights" })).toContainText(
    "1 dispensado(s) fora da lista",
  );
});
