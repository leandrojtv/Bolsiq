import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { cadastrar, emailNovo } from "./conta";

/** Fixture anonimizada do parser (packages/finance): extrato Itaú, SGML em latin1. */
const OFX = resolve(
  import.meta.dirname,
  "../../../packages/finance/src/importacao/fixtures/itau-conta.ofx",
);

test("Bolsiq Finanças: importa OFX, revisa, confirma, reimporta sem duplicar e desfaz", async ({
  page,
}) => {
  page.on("dialog", (d) => void d.accept());
  await cadastrar(page, emailNovo("ofx"));

  await page.goto("/financas/contas?nova=1");
  const sheet = page.getByRole("dialog", { name: "Nova conta" });
  await sheet.getByLabel("Nome da conta").fill("Corrente Itaú");
  await sheet.getByLabel("Instituição").fill("Itaú");
  await sheet.getByLabel("Saldo inicial (R$)").fill("0");
  await sheet.getByLabel("Saldo em").fill("2023-11-01");
  await sheet.getByRole("button", { name: "Criar conta" }).click();
  await expect(sheet).toBeHidden();

  await page
    .getByRole("navigation", { name: "Navegação principal" })
    .first()
    .getByRole("link", { name: "Importar" })
    .click();
  await expect(page).toHaveURL(/\/financas\/importar$/);
  await page.getByLabel("Arquivos OFX").setInputFiles(OFX);
  await expect(page.getByRole("list", { name: "Arquivos lidos" })).toContainText(
    "extrato de conta · 6 linhas",
  );
  // O banco do arquivo (0341) sugere a conta do Itaú.
  await expect(page.getByLabel("Conta", { exact: true })).toHaveValue(/.+/);
  await page.getByRole("button", { name: "Revisar linhas" }).click();

  const linhas = page.getByRole("table", { name: "Linhas da importação" });
  await expect(linhas.getByRole("checkbox")).toHaveCount(6);
  await expect(page.getByText("Saldo confere")).toBeVisible();
  await linhas
    .getByLabel("Categoria de SALÁRIO EMPRESA EXEMPLO")
    .selectOption({ label: "Salário" });
  await expect(linhas.getByRole("button", { name: "Criar regra" })).toBeVisible();
  await linhas.getByLabel("Importar ALUGUEL APTO").uncheck();
  await expect(page.getByText("5 marcadas")).toBeVisible();

  await page.getByRole("button", { name: "Confirmar importação" }).click();
  await expect(page.getByRole("status")).toHaveText("5 lançamentos gravados.");

  await page.goto("/financas/lancamentos");
  const lista = page.getByRole("table", { name: "Lançamentos" });
  await expect(lista.getByRole("row", { name: /CAFÉ DA ESQUINA/ })).toHaveCount(2);
  await expect(lista.getByRole("row", { name: /SALÁRIO/ })).toContainText("Salário");

  // O mesmo arquivo de novo: so o aluguel, que ficou de fora, e novo.
  await page.goto("/financas/importar");
  await page.getByLabel("Arquivos OFX").setInputFiles(OFX);
  await page.getByRole("button", { name: "Revisar linhas" }).click();
  await expect(page.getByText("já importada")).toHaveCount(5);
  await expect(page.getByText("1 marcada", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancelar" }).click();

  // Desfazer apaga os lancamentos da importacao.
  const historico = page.getByRole("list", { name: "Importações" });
  await historico.getByRole("button", { name: "Desfazer itau-conta.ofx" }).click();
  await expect(historico).toContainText("Desfeita");
  await page.goto("/financas/lancamentos");
  await expect(page.getByText("Nenhum lançamento")).toBeVisible();
});
