import { expect, test } from "@playwright/test";
import { cadastrar, emailNovo } from "./conta";

/** Dia 1 de dois meses atras: as parcelas 1 a 3 ja passaram (pagas), as outras ficam previstas. */
function primeiraData(): string {
  const d = new Date();
  const m = new Date(d.getFullYear(), d.getMonth() - 2, 1);
  return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}-01`;
}

for (const [nome, viewport] of [
  ["desktop", { width: 1440, height: 1000 }],
  ["celular", { width: 390, height: 844 }],
] as const) {
  test.describe(`Bolsiq Finanças: excluir financiamento (${nome})`, () => {
    test.use({ viewport });

    test("apaga as previstas e mantém as pagas sem vínculo", async ({ page }) => {
      await cadastrar(page, emailNovo(`divida-${nome}`));

      await page.goto("/financas/contas?nova=1");
      const conta = page.getByRole("dialog", { name: "Nova conta" });
      await conta.getByLabel("Nome da conta").fill("Corrente");
      await conta.getByRole("button", { name: "Criar conta" }).click();
      await expect(conta).toBeHidden();

      await page.goto("/financas/dividas");
      await page.getByRole("button", { name: "Empréstimo ou financiamento" }).click();
      const form = page.getByRole("dialog", { name: "Empréstimo ou financiamento" });
      await form.getByLabel("Tipo").selectOption("financiamento");
      await form.getByLabel("Descrição").fill("Financiamento do carro");
      await form.getByLabel("Valor financiado (R$)").fill("12.000,00");
      await form.getByLabel("Taxa (% ao mês)").fill("1");
      await form.getByLabel("Parcelas").fill("12");
      await form.getByLabel("Primeiro vencimento").fill(primeiraData());
      await form.getByRole("button", { name: "Cadastrar dívida" }).click();
      await expect(form).toBeHidden();

      const dividas = page.getByRole("list", { name: "Dívidas" });
      await expect(dividas).toContainText("3/12 pagas");
      await dividas.getByRole("button", { name: /Financiamento do carro/ }).click();

      // Cancelar nao apaga nada.
      await page.getByRole("button", { name: "Excluir dívida" }).click();
      const confirmar = page.getByRole("dialog", {
        name: "Excluir Financiamento do carro?",
      });
      await expect(confirmar).toContainText("9 parcelas previstas serão apagadas");
      await expect(confirmar).toContainText("3 parcelas pagas continuam");
      await confirmar.getByRole("button", { name: "Cancelar" }).click();
      await expect(confirmar).toBeHidden();
      await expect(dividas).toContainText("Financiamento do carro");

      await page.getByRole("button", { name: "Excluir dívida" }).click();
      await confirmar.getByRole("button", { name: "Excluir dívida" }).click();
      await expect(confirmar).toBeHidden();
      await expect(page.getByRole("status").filter({ hasText: "excluída" })).toHaveText(
        "Financiamento do carro excluída: 9 parcelas previstas apagadas e 3 lançamentos pagos mantidos.",
      );
      await expect(page.getByText("Nenhuma dívida cadastrada")).toBeVisible();

      const r = await page.request.get(
        "/api/financas/lancamentos?q=Financiamento%20do%20carro&por_pagina=50",
      );
      const corpo = (await r.json()) as {
        data: { status: string }[];
        meta: { total: number };
      };
      expect(corpo.meta.total).toBe(3);
      expect(corpo.data.every((l) => l.status !== "previsto")).toBe(true);
    });
  });
}
