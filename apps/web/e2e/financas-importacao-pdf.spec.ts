import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { consultar } from "./banco";
import { cadastrar, emailNovo } from "./conta";

const CHAVE = "sk-e2e-chave-de-teste-do-bolsiq-1234";
/** Gerados das fixtures do eval (pnpm --filter @bolsiq/assistant run e2e:importacao). */
const fixture = (nome: string) =>
  readFileSync(resolve(import.meta.dirname, "fixtures", nome));

async function configurarIA(page: Page) {
  // DeepSeek contra o provedor falso (ASSISTANT_DEEPSEEK_URL no web e no worker).
  await page.goto("/configuracoes/assistente");
  await page.getByLabel("Provedor", { exact: true }).selectOption("deepseek");
  await page.getByLabel("Chave de API").fill(CHAVE);
  await page.getByRole("button", { name: "Testar conexão" }).click();
  await expect(page.getByRole("status")).toContainText("Conexão ok");
  await page.getByLabel("Modelo", { exact: true }).selectOption("deepseek-flash");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByRole("status")).toContainText("Configuração salva");
}

async function criarCartao(page: Page, nome: string, banco: string, final: string) {
  await page.goto("/financas/cartoes");
  await page.getByRole("button", { name: "Novo cartão" }).click();
  const cartao = page.getByRole("dialog", { name: "Novo cartão" });
  await cartao.getByLabel("Nome do cartão").fill(nome);
  await cartao.getByLabel("Instituição").fill(banco);
  await cartao.getByLabel("Final do cartão").fill(final);
  await cartao.getByLabel("Dia do fechamento").fill("8");
  await cartao.getByLabel("Dia do vencimento").fill("15");
  await cartao.getByLabel("Conta que paga a fatura").selectOption({ label: "Nu conta" });
  await cartao.getByRole("button", { name: "Criar cartão" }).click();
  await expect(cartao).toBeHidden();
}

test("Bolsiq Finanças: fatura em PDF pelo layout do Nubank e pela IA, na mesma revisão", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await cadastrar(page, emailNovo("fatura-pdf"));
  await configurarIA(page);

  await page.goto("/financas/contas?nova=1");
  const conta = page.getByRole("dialog", { name: "Nova conta" });
  await conta.getByLabel("Nome da conta").fill("Nu conta");
  await conta.getByLabel("Instituição").fill("Nubank");
  await conta.getByLabel("Saldo inicial (R$)").fill("10.000");
  await conta.getByLabel("Saldo em").fill("2026-01-01");
  await conta.getByRole("button", { name: "Criar conta" }).click();
  await expect(conta).toBeHidden();
  await criarCartao(page, "Nubank roxinho", "Nubank", "4321");

  // 1. Nubank: layout conhecido, sem chamar o modelo.
  await page.goto("/financas/importar");
  await page.getByRole("button", { name: "Concordo e quero ler com IA" }).click();
  await page.getByLabel("PDF ou foto da fatura").setInputFiles({
    name: "Nubank_2026-11-15.pdf",
    mimeType: "application/pdf",
    buffer: fixture("fatura-nubank.pdf"),
  });
  await page.getByRole("button", { name: "Ler fatura" }).click();
  const progresso = page.getByRole("region", { name: "Progresso da leitura" });
  await expect(progresso.getByLabel("Etapa de Nubank_2026-11-15.pdf")).toHaveText(
    "Pronto",
    {
      timeout: 90_000,
    },
  );
  const nubank = page.getByRole("region", { name: "Leitura de Nubank_2026-11-15.pdf" });
  await expect(nubank).toContainText("lida pelo layout do banco, sem IA");
  await expect(nubank).toContainText("9 linhas");
  await expect(nubank.getByRole("combobox", { name: "Cartão" })).toHaveValue(/.+/);
  await expect(nubank.getByRole("combobox", { name: "Fatura (vencimento)" })).toHaveValue(
    "2026-11-15",
  );
  await nubank.getByRole("button", { name: "Revisar linhas desta fatura" }).click();

  // A mesma revisao do OFX e do CSV.
  const linhas = page.getByRole("table", { name: "Linhas da importação" });
  await expect(linhas.getByRole("checkbox")).toHaveCount(9);
  await expect(page.getByLabel("Total da fatura")).toContainText("confere");
  await expect(linhas.getByRole("row", { name: /Pagamento recebido/ })).toContainText(
    "transferência",
  );
  await expect(
    linhas.getByRole("row", { name: /Estorno de Loja Exemplo/ }),
  ).toContainText("estorno");
  await expect(linhas.getByRole("row", { name: /Amazon Web Services/ })).toContainText(
    "USD 10,00",
  );
  await expect(linhas.getByLabel("Categoria de IOF de compra internacional")).toHaveValue(
    /.+/,
  );
  await expect(linhas.getByRole("row", { name: /Loja Exemplo - Parcela/ })).toContainText(
    "parcela 2/6",
  );
  await page.getByRole("button", { name: "Confirmar importação" }).click();
  // 7 compras, o estorno e os dois lados da transferencia do pagamento.
  await expect(page.getByRole("status")).toHaveText("10 lançamentos gravados.");

  // 2. Santander: sem layout conhecido, pela IA (provedor falso).
  await criarCartao(page, "Santander Free", "Santander", "9876");
  await page.goto("/financas/importar");
  await page.getByLabel("PDF ou foto da fatura").setInputFiles({
    name: "Santander_Fatura.pdf",
    mimeType: "application/pdf",
    buffer: fixture("fatura-santander.pdf"),
  });
  await page.getByRole("button", { name: "Ler fatura" }).click();
  await expect(
    page
      .getByRole("region", { name: "Progresso da leitura" })
      .getByLabel("Etapa de Santander_Fatura.pdf"),
  ).toHaveText("Pronto", { timeout: 90_000 });
  const santander = page.getByRole("region", { name: "Leitura de Santander_Fatura.pdf" });
  await expect(santander).toContainText("lida por IA");
  await santander.getByRole("combobox", { name: "Destino" }).selectOption("cartao");
  await santander
    .getByRole("combobox", { name: "Cartão" })
    .selectOption({ label: "Santander Free" });
  await santander
    .getByRole("combobox", { name: "Fatura (vencimento)" })
    .selectOption({ index: 1 });
  await santander.getByRole("button", { name: "Revisar linhas desta fatura" }).click();
  await expect(
    page.getByRole("table", { name: "Linhas da importação" }).getByRole("checkbox"),
  ).toHaveCount(4);
  await expect(page.getByText("Lida do PDF ou da foto")).toBeVisible();

  // Os arquivos lidos saem do servidor quando a revisao e criada.
  const [linha] = consultar(
    `select count(*) filter (where f.dados is not null), count(*) from assistant.import_job_files f join assistant.import_jobs j on j.id = f.job_id where j.documento = 'financas' and f.nome in ('Nubank_2026-11-15.pdf', 'Santander_Fatura.pdf') and j.criado_em > now() - interval '10 minutes'`,
  );
  expect(linha?.[0]).toBe("0");
});
