import type {
  CabecalhoDaIA,
  CabecalhoFinancasDaIA,
} from "../../src/importacao/esquema.js";
import { cabecalhoDa, respostaGravada } from "./executar.js";
import { FIXTURES } from "./fixtures.js";
import { FIXTURES_DE_FINANCAS } from "./fixtures-financas.js";

/**
 * Os tres extratos do e2e (XP em XLSX, custodia Nubank em PDF, COE Santander em
 * XLSX), gerados das fixtures do eval, e o que o provedor falso responde para
 * cada um, escolhido por um trecho do documento.
 */
export const ARQUIVOS_DO_E2E = [
  {
    fixture: "xp-posicao-detalhada",
    caminho: "apps/web/e2e/fixtures/posicao-xp.xlsx",
    marcador: "Posição Detalhada - XP Investimentos",
  },
  {
    fixture: "nubank-custodia-pdf",
    caminho: "apps/web/e2e/fixtures/custodia-nubank.pdf",
    marcador: "Nu Invest - Extrato de Custódia",
  },
  {
    fixture: "santander-coe-xlsx",
    caminho: "apps/web/e2e/fixtures/coe-santander.xlsx",
    marcador: "Data base: 31/10/2026",
  },
] as const;
export const CAMINHO_DA_RESPOSTA = "infra/docker/llm-falso-importacao.json";

/**
 * Faturas do e2e do Financas (ADR 0040): a do Nubank passa pelo atalho (o
 * provedor falso nao e chamado) e a do Santander, pela IA.
 */
export const FATURAS_DO_E2E = [
  {
    fixture: "nubank-fatura-pdf",
    caminho: "apps/web/e2e/fixtures/fatura-nubank.pdf",
    marcador: "Nu Pagamentos S.A. - Fatura",
  },
  {
    fixture: "santander-fatura-pdf",
    caminho: "apps/web/e2e/fixtures/fatura-santander.pdf",
    marcador: "Santander - Resumo da fatura",
  },
] as const;

/** O que o provedor falso devolve: o cabecalho (JSON) e as linhas (blocos CSV). */
export interface RespostaDoFalso {
  cabecalho: CabecalhoDaIA | CabecalhoFinancasDaIA;
  csv: string;
}

export function arquivosDoE2e(): {
  arquivos: { caminho: string; bytes: Uint8Array }[];
  respostas: Record<string, RespostaDoFalso>;
} {
  const respostas: Record<string, RespostaDoFalso> = {};
  const arquivos: { caminho: string; bytes: Uint8Array }[] = ARQUIVOS_DO_E2E.map((a) => {
    const f = FIXTURES.find((x) => x.id === a.fixture);
    const arquivo = f?.arquivo();
    if (!f || !arquivo || !("bytes" in arquivo))
      throw new Error(`fixture ${a.fixture} sem arquivo`);
    respostas[a.marcador] = {
      cabecalho: cabecalhoDa(f.resposta),
      csv: respostaGravada(f.resposta, "", "linhas"),
    };
    return { caminho: a.caminho, bytes: arquivo.bytes };
  });
  for (const a of FATURAS_DO_E2E) {
    const f = FIXTURES_DE_FINANCAS.find((x) => x.id === a.fixture);
    const arquivo = f?.arquivo();
    if (!f || !arquivo || !("bytes" in arquivo))
      throw new Error(`fixture ${a.fixture} sem arquivo`);
    respostas[a.marcador] = {
      cabecalho: cabecalhoDa(f.resposta),
      csv: respostaGravada(f.resposta, "", "linhas"),
    };
    arquivos.push({ caminho: a.caminho, bytes: arquivo.bytes });
  }
  return { arquivos, respostas };
}
