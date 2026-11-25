import "server-only";
import { ErroDeFinancas } from "@bolsiq/finance";
import { ErroDeImportacao } from "@bolsiq/assistant";
import { tratarFinancas } from "./respostas-financas";
import { tratarImportacaoIA } from "./respostas-importacao-ia";

/** Leitura de fatura com IA: erro do assistente ou do Financas, em portugues e com codigo. */
export function tratarLeitura(erro: unknown) {
  if (erro instanceof ErroDeFinancas) return tratarFinancas(erro);
  if (erro instanceof ErroDeImportacao) return tratarImportacaoIA(erro);
  throw erro;
}
