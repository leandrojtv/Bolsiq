import { expect, test } from "@playwright/test";
import { cadastrar, emailNovo } from "./conta";

test("Bolsiq Finanças: compra no cartão, fatura, pagamento e despesa sem dobrar no painel", async ({
  page,
}) => {
  await cadastrar(page, emailNovo("cartao"));

  await page.goto("/financas/contas?nova=1");
  const conta = page.getByRole("dialog", { name: "Nova conta" });
  await conta.getByLabel("Nome da conta").fill("Corrente");
  await conta.getByLabel("Saldo inicial (R$)").fill("5.000,00");
  await conta.getByRole("button", { name: "Criar conta" }).click();
  await expect(conta).toBeHidden();

  await page.goto("/financas/cartoes");
  await page.getByRole("button", { name: "Novo cartão" }).click();
  const cartao = page.getByRole("dialog", { name: "Novo cartão" });
  await cartao.getByLabel("Nome do cartão").fill("Roxinho");
  await cartao.getByLabel("Limite (R$)").fill("2.000");
  await cartao.getByLabel("Dia do fechamento").fill("28");
  await cartao.getByLabel("Dia do vencimento").fill("5");
  await cartao.getByLabel("Conta que paga a fatura").selectOption({ label: "Corrente" });
  await cartao.getByRole("button", { name: "Criar cartão" }).click();
  await expect(cartao).toBeHidden();

  // Compra no cartao pelo lancamento rapido.
  await page.goto("/financas/lancamentos");
  const rapido = page.getByRole("form", { name: "Lançamento rápido" });
  await rapido
    .getByRole("combobox", { name: /^Conta/ })
    .selectOption({ label: "Roxinho" });
  await rapido.getByLabel("Valor").fill("250");
  await rapido.getByLabel("Descrição").fill("Supermercado");
  await rapido.getByLabel("Categoria").selectOption({ label: "Mercado" });
  await rapido.getByLabel("Descrição").press("Enter");
  await expect(rapido.getByLabel("Valor")).toHaveValue("");

  // Fatura com a compra e o limite usado.
  await page.goto("/financas/cartoes");
  const lista = page.getByRole("list", { name: "Cartões" });
  await expect(lista).toContainText("R$ 250,00 de R$ 2.000,00");
  await lista.getByRole("link", { name: "Fatura atual: abrir" }).click();
  await expect(page.getByRole("list", { name: "Compras por categoria" })).toContainText(
    "Mercado",
  );
  await expect(page.getByRole("table", { name: "Lançamentos da fatura" })).toContainText(
    "Supermercado",
  );

  await page.getByRole("button", { name: "Pagar fatura" }).click();
  const pagar = page.getByRole("dialog", { name: "Pagar fatura" });
  await expect(pagar.getByLabel("Valor pago (R$)")).toHaveValue("250,00");
  await pagar.getByRole("button", { name: "Confirmar pagamento" }).click();
  await expect(pagar).toBeHidden();
  await expect(page.getByText("paga", { exact: true })).toBeVisible();

  // O pagamento e transferencia: a despesa do mes continua 250, nao 500.
  await page.goto("/financas");
  const numeros = page.getByRole("region", { name: "Números do mês" });
  await expect(numeros).toContainText("Despesas pagas");
  await expect(numeros).toContainText("R$ 250,00");
  await expect(numeros).not.toContainText("R$ 500,00");
  await expect(page.getByRole("list", { name: "Saldo por conta" })).toContainText(
    "R$ 4.750,00",
  );
});
