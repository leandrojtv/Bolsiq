import { expect, test } from "@playwright/test";
import { cadastrar, emailNovo } from "./conta";

test("Bolsiq Finanças: compra em 3x aparece nas 3 faturas", async ({ page }) => {
  await cadastrar(page, emailNovo("parcelas"));

  await page.goto("/financas/contas?nova=1");
  const conta = page.getByRole("dialog", { name: "Nova conta" });
  await conta.getByLabel("Nome da conta").fill("Corrente");
  await conta.getByRole("button", { name: "Criar conta" }).click();
  await expect(conta).toBeHidden();

  await page.goto("/financas/cartoes");
  await page.getByRole("button", { name: "Novo cartão" }).click();
  const cartao = page.getByRole("dialog", { name: "Novo cartão" });
  await cartao.getByLabel("Nome do cartão").fill("Roxinho");
  await cartao.getByLabel("Dia do fechamento").fill("28");
  await cartao.getByLabel("Dia do vencimento").fill("5");
  await cartao.getByRole("button", { name: "Criar cartão" }).click();
  await expect(cartao).toBeHidden();

  await page.goto("/financas/lancamentos");
  await page.getByRole("link", { name: "Compra parcelada" }).click();
  const compra = page.getByRole("dialog", { name: "Compra parcelada" });
  await compra.getByLabel("Descrição").fill("Notebook");
  await compra.getByLabel("Parcelas").fill("3");
  await compra.getByLabel("Valor da parcela (R$)").fill("1.000,00");
  await compra.getByLabel("Categoria").selectOption({ label: "Compras" });
  await compra.getByRole("button", { name: "Lançar compra parcelada" }).click();
  await expect(compra).toBeHidden();

  const planos = page.getByRole("list", { name: "Compras parceladas" });
  await expect(planos).toContainText("Notebook");
  await expect(planos).toContainText("1/3 pagas");

  await page.goto("/financas/cartoes");
  await page.getByRole("button", { name: "Ver todas as faturas" }).click();
  const faturas = page.getByRole("table", { name: "Faturas de Roxinho" });
  await expect(faturas.getByRole("row").filter({ hasText: "R$ 1.000,00" })).toHaveCount(
    3,
  );
});
