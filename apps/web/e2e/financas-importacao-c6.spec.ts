import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { cadastrar, emailNovo } from "./conta";

/** Fixture anonimizada do parser (packages/finance): fatura do C6 em CSV. */
const CSV = resolve(
  import.meta.dirname,
  "../../../packages/finance/src/importacao/fixtures/c6-Fatura_2026-11-10.csv",
);

test("Bolsiq Finanças: importa a fatura do C6 em CSV com parcelas e pagamento", async ({
  page,
}) => {
  await cadastrar(page, emailNovo("c6"));

  await page.goto("/financas/contas?nova=1");
  const conta = page.getByRole("dialog", { name: "Nova conta" });
  await conta.getByLabel("Nome da conta").fill("C6 conta");
  await conta.getByLabel("Instituição").fill("C6");
  await conta.getByLabel("Saldo inicial (R$)").fill("10.000");
  await conta.getByLabel("Saldo em").fill("2026-01-01");
  await conta.getByRole("button", { name: "Criar conta" }).click();
  await expect(conta).toBeHidden();

  await page.goto("/financas/cartoes");
  await page.getByRole("button", { name: "Novo cartão" }).click();
  const cartao = page.getByRole("dialog", { name: "Novo cartão" });
  await cartao.getByLabel("Nome do cartão").fill("C6 Carbon");
  await cartao.getByLabel("Instituição").fill("C6");
  await cartao.getByLabel("Final do cartão").fill("2222");
  await cartao.getByLabel("Dia do fechamento").fill("3");
  await cartao.getByLabel("Dia do vencimento").fill("10");
  await cartao.getByLabel("Conta que paga a fatura").selectOption({ label: "C6 conta" });
  await cartao.getByRole("button", { name: "Criar cartão" }).click();
  await expect(cartao).toBeHidden();

  await page.goto("/financas/importar");
  await page.getByLabel("Arquivos OFX ou CSV").setInputFiles(CSV);
  const lidos = page.getByRole("list", { name: "Arquivos lidos" });
  await expect(lidos).toContainText("fatura de cartão · 42 linhas");
  await expect(lidos).toContainText("3 finais de cartão nesta fatura");
  // Um dos finais (2222) sugere o cartao; o nome do arquivo, a fatura.
  await expect(page.getByRole("combobox", { name: "Cartão" })).toHaveValue(/.+/);
  await expect(page.getByRole("combobox", { name: "Fatura (vencimento)" })).toHaveValue(
    "2026-11-10",
  );
  await page.getByRole("button", { name: "Revisar linhas" }).click();

  const linhas = page.getByRole("table", { name: "Linhas da importação" });
  await expect(linhas.getByRole("checkbox")).toHaveCount(42);
  // Compras e pagamento batem com o arquivo.
  const resumo = page.getByRole("main");
  await expect(resumo).toContainText(/compras R\$\s5\.038,20/);
  await expect(resumo).toContainText(/créditos R\$\s6\.661,61/);
  const pagamento = linhas.getByRole("row", { name: /Inclusao de Pagamento/ });
  await expect(pagamento).toContainText("transferência");
  await expect(linhas.getByRole("row", { name: /CLINICA SORRISO/ })).toContainText(
    "parcela 6/7",
  );
  await expect(linhas.getByLabel("Categoria de IOF ANTHROPIC SA")).toHaveValue(/.+/);
  await expect(linhas.getByText("categoria do banco").first()).toBeVisible();

  await page.getByRole("button", { name: "Confirmar importação" }).click();
  // 41 compras e os dois lados da transferencia do pagamento.
  await expect(page.getByRole("status")).toHaveText("43 lançamentos gravados.");

  await page.goto("/financas/parcelamentos");
  await expect(page.getByText("CLINICA SORRISO")).toBeVisible();
});
