import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { consultar } from "./banco";
import { cadastrar, emailNovo } from "./conta";

const CHAVE = "sk-e2e-chave-de-teste-do-bolsiq-1234";
/** Gerado das fixtures do eval (pnpm --filter @bolsiq/assistant run e2e:importacao). */
const XP = readFileSync(resolve(import.meta.dirname, "fixtures/posicao-xp.xlsx"));

test("importa a posição da XP com IA: revisa, edita uma linha, confirma e vê na carteira", async ({
  page,
}) => {
  const carteira = await cadastrar(page, emailNovo("importacao-ia"));

  // Modelo com saida estruturada, contra o provedor falso (ASSISTANT_DEEPSEEK_URL).
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

  await expect(sheet.getByRole("region", { name: "Consentimento" })).toContainText(
    "anonimiza",
  );
  await sheet.getByRole("button", { name: "Concordo e quero importar com IA" }).click();

  await sheet.getByLabel("Arquivos do extrato").setInputFiles({
    name: "PosicaoDetalhada.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: XP,
  });
  await sheet.getByRole("button", { name: "Estimar custo" }).click();
  await expect(sheet.getByRole("region", { name: "Estimativa" })).toContainText("tokens");
  await sheet.getByRole("button", { name: "Processar com IA" }).click();

  const revisao = sheet.getByRole("region", { name: "Revisão de PosicaoDetalhada.xlsx" });
  await expect(revisao).toContainText("extraído por IA", { timeout: 30_000 });
  await expect(revisao).toContainText("deepseek/deepseek-flash");
  await expect(revisao).toContainText("conciliado");
  await expect(revisao).not.toContainText("não conciliado");

  // Clicar no trecho mostra a aba de origem, ja anonimizada.
  await revisao.getByRole("button", { name: /aba Fundos: XP MACRO FIM/ }).click();
  const origem = revisao.getByRole("region", { name: "Origem da linha" });
  await expect(origem).toContainText("12.345.678/0001-90");

  // Edicao inline antes de confirmar: o nome do CDB.
  await revisao.getByRole("textbox", { name: "Ativo" }).first().fill("CDB ALFA EDITADO");

  await revisao.getByRole("button", { name: /Revisar carga \(12 linhas\)/ }).click();
  await expect(revisao.getByRole("region", { name: "Revisão da carga" })).toContainText(
    "Novas",
  );
  await revisao.getByRole("button", { name: "Confirmar importação" }).click();
  await expect(sheet.getByRole("status")).toContainText("linhas gravadas", {
    timeout: 15_000,
  });
  await page.keyboard.press("Escape");

  await page.reload();
  const outros = page.getByRole("region", { name: "Renda fixa, fundos e outros" });
  await expect(outros).toContainText("CDB ALFA EDITADO");
  await expect(outros).toContainText("XP MACRO FIM");
  await expect(page.getByText("HGLG11").first()).toBeVisible();

  // Nada do titular foi guardado; o cache tem o JSON extraido, sem o arquivo.
  const [linha] = consultar(
    `select original is null, confirmado_em is not null, position('123.456.789-09' in extraido::text) = 0 from assistant.extractions order by criado_em desc limit 1`,
  );
  expect(linha).toEqual(["t", "t", "t"]);
});
