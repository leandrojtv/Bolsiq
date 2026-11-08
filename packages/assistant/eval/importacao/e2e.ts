import type { SaidaDaIA } from "../../src/importacao/esquema.js";
import { FIXTURES } from "./fixtures.js";

export const CAMINHO_DO_XLSX = "apps/web/e2e/fixtures/posicao-xp.xlsx";
export const CAMINHO_DA_RESPOSTA = "infra/docker/llm-falso-importacao.json";
/** Texto do documento que o provedor falso procura para escolher a resposta. */
export const MARCADOR_XP = "Posição Detalhada - XP Investimentos";

export function arquivosDoE2e(): {
  xlsx: Uint8Array;
  respostas: Record<string, SaidaDaIA>;
} {
  const xp = FIXTURES.find((f) => f.id === "xp-posicao-detalhada")!;
  const arquivo = xp.arquivo();
  if (!("bytes" in arquivo)) throw new Error("a fixture da XP e um arquivo");
  return { xlsx: arquivo.bytes, respostas: { [MARCADOR_XP]: xp.resposta } };
}
