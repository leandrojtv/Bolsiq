import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { consultar } from "./banco";
import { cadastrar, emailNovo } from "./conta";

const CHAVE = "sk-e2e-chave-de-teste-do-bolsiq-1234";
/** Gerados das fixtures do eval (pnpm --filter @bolsiq/assistant run e2e:importacao). */
const fixture = (nome: string) => readFileSync(resolve(import.meta.dirname, "fixtures", nome));
const ARQUIVOS = [
  {
    name: "XP_PosicaoDetalhada.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: fixture("posicao-xp.xlsx"),
  },
  { name: "Nubank_Extrato_de_Custodia.pdf", mimeType: "application/pdf", buffer: fixture("custodia-nubank.pdf") },
  {
    name: "Extrato_COE_Santander.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: fixture("coe-santander.xlsx"),
  },
];

test("importa XP, Nubank e Santander de uma vez com IA: progresso, revisão, confirmação e carteira", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const carteira = await cadastrar(page, emailNovo("importacao-ia"));

  // Modelo da DeepSeek contra o provedor falso (ASSISTANT_DEEPSEEK_URL no web e no worker).
  await page.goto("/configuracoes/assistente");
  await page.getByLabel("Provedor", { exact: true }).selectOption("deepseek");
  await page.getByLabel("Chave de API").fill(CHAVE);
  await page.getByRole("button", { name: "Testar conexão" }).click();
  await expect(page.getByRole("status")).toContainText("Conexão ok");
  await page.getByLabel("Modelo", { exact: true }).selectOption("deepseek-flash");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByRole("status")).toContainText("Configuração salva");

  await page.goto(`/carteiras/${carteira}`);
  await page.getByRole("button", { name: "Importar CSV ou extrato B3" }).click();
  const sheet = page.getByRole("dialog", { name: "Importar transações" });
  await sheet.getByRole("button", { name: "Com IA" }).click();
  await sheet.getByRole("button", { name: "Concordo e quero importar com IA" }).click();

  await sheet.getByLabel("Arquivos do extrato").setInputFiles(ARQUIVOS);
  // Corretora sugerida pelo nome do arquivo.
  await expect(sheet.getByLabel("Corretora de XP_PosicaoDetalhada.xlsx")).toHaveValue("XP");
  await expect(sheet.getByLabel("Corretora de Nubank_Extrato_de_Custodia.pdf")).toHaveValue("Nubank");
  await expect(sheet.getByLabel("Corretora de Extrato_COE_Santander.xlsx")).toHaveValue("Santander");
  await sheet.getByRole("button", { name: "Importar com IA" }).click();

  // Progresso por arquivo, em segundo plano, ate os tres ficarem prontos.
  const progresso = sheet.getByRole("region", { name: "Progresso da importação" });
  await expect(progresso).toBeVisible();
  for (const a of ARQUIVOS)
    await expect(progresso.getByLabel(`Etapa de ${a.name}`)).toHaveText("Pronto", { timeout: 120_000 });

  // XP: revisao com os grupos, os totais conciliados e a origem anonimizada.
  const xp = sheet.getByRole("region", { name: "Revisão de XP_PosicaoDetalhada.xlsx" });
  await expect(xp).toContainText("extraído por IA");
  await expect(xp).toContainText("conciliado");
  await expect(xp).not.toContainText("não conciliado");
  await expect(xp.getByRole("region", { name: "Preenchidas automaticamente" })).toBeVisible();
  await expect(xp.getByText("preenchido automaticamente").first()).toBeVisible();
  await xp.getByRole("button", { name: /aba Fundos: XP MACRO FIM/ }).click();
  await expect(xp.getByRole("region", { name: "Origem da linha" })).toContainText("12.345.678/0001-90");
  await xp.getByRole("textbox", { name: "Ativo" }).first().fill("CDB ALFA EDITADO");
  await xp.getByRole("button", { name: /Revisar carga \(12 linhas\)/ }).click();
  await xp.getByRole("button", { name: "Confirmar importação" }).click();
  await expect(sheet.getByRole("status").filter({ hasText: "XP_PosicaoDetalhada.xlsx" })).toContainText(
    "linhas gravadas",
    { timeout: 15_000 },
  );

  // Nubank (PDF de custodia) e Santander (XLSX com cabecalho deslocado): conciliados.
  for (const nome of ["Nubank_Extrato_de_Custodia.pdf", "Extrato_COE_Santander.xlsx"]) {
    const r = sheet.getByRole("region", { name: `Revisão de ${nome}` });
    await expect(r).toContainText("conciliado");
    await expect(r).not.toContainText("não conciliado");
    await r.getByRole("button", { name: /Revisar carga/ }).click();
    await r.getByRole("button", { name: "Confirmar importação" }).click();
    await expect(sheet.getByRole("status").filter({ hasText: nome })).toContainText("linhas gravadas", {
      timeout: 15_000,
    });
  }
  await page.keyboard.press("Escape");

  await page.reload();
  const outros = page.getByRole("region", { name: "Renda fixa, fundos e outros" });
  await expect(outros).toContainText("CDB ALFA EDITADO");
  await expect(outros).toContainText("XP MACRO FIM");
  await expect(outros).toContainText("COE Santander Ibovespa Alta 2027");
  await expect(outros).toContainText("Tesouro Selic 2029");
  await expect(page.getByText("HGLG11").first()).toBeVisible();

  // O arquivo saiu do servidor na confirmacao; o JSON extraido nao tem o CPF.
  const [linha] = consultar(
    `select count(*) filter (where dados is not null), count(*) from assistant.import_job_files f join assistant.import_jobs j on j.id = f.job_id where j.carteira_id = '${carteira}'`,
  );
  expect(linha).toEqual(["0", "3"]);
  const [cpf] = consultar(
    `select count(*) from assistant.extractions where position('123.456.789-09' in extraido::text) > 0 or position('321.654.987-11' in extraido::text) > 0`,
  );
  expect(cpf).toEqual(["0"]);
});
