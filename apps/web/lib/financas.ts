import "server-only";
import { headers } from "next/headers";
import {
  apagarItem,
  apagarRecorrencia,
  copiarPlanejamento,
  criarItem,
  criarRecorrencia,
  detalheDaFatura,
  editarItem,
  editarRecorrencia,
  listarRecorrencias,
  obterPlanejamento,
  pagarFatura,
  painelDoMes,
  puxarRecorrencias,
  type EdicaoDeItemDoPlanejamento,
  type EdicaoDeRecorrencia,
  type NovaRecorrencia,
  type NovoItemDoPlanejamento,
  type PagamentoDeFatura,
  analisarArquivos,
  apagarCartao,
  apagarRegra,
  cancelarImportacao,
  confirmarImportacao,
  criarCartao,
  criarImportacao,
  criarRegra,
  desfazerImportacao,
  editarCartao,
  editarLinha,
  editarRegra,
  listarCartoes,
  listarFaturas,
  listarImportacoes,
  listarRegras,
  obterImportacao,
  type ArquivoRecebido,
  type EdicaoDeCartao,
  type EdicaoDeLinha,
  type EdicaoDeRegra,
  type LimitesDeImportacao,
  type NovaImportacao,
  type NovaRegra,
  type NovoCartao,
  apagarCategoria,
  apagarConta,
  apagarLancamento,
  comoUsuario,
  criarCategoria,
  criarConta,
  criarLancamento,
  editarCategoria,
  editarConta,
  editarLancamento,
  listarCategorias,
  listarContas,
  listarLancamentos,
  resumoDoMes,
  semearCategorias,
  type EdicaoDeCategoria,
  type EdicaoDeConta,
  type EdicaoDeLancamento,
  type FiltroDeLancamentos,
  type NovaCategoria,
  type NovaConta,
  type NovoLancamento,
  type Origem,
  type Tx,
} from "@bolsiq/finance";
import { banco } from "./analytics";
import { env } from "./env";
import { hojeEmSp } from "./indicadores-tecnicos";

/**
 * Bolsiq Financas (ADR 0031): modulo do app, schema `finance`. Toda leitura e
 * escrita passa por `comoUsuario` (RLS valendo, ADR 0011).
 */

async function origem(): Promise<Origem> {
  const h = await headers();
  return {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    user_agent: h.get("user-agent"),
  };
}

const como = <T>(uid: string, fn: (tx: Tx) => Promise<T>) =>
  comoUsuario(banco(), uid, fn);

/** Primeiro acesso: semeia as categorias padrao. Idempotente. */
export const iniciarFinancas = (uid: string) =>
  como(uid, (tx) => semearCategorias(tx, uid));

export const contas = (uid: string) =>
  como(uid, (tx) => listarContas(tx, uid, hojeEmSp()));

export async function novaConta(uid: string, c: NovaConta) {
  const o = await origem();
  return como(uid, (tx) => criarConta(tx, uid, c, hojeEmSp(), o));
}

export async function mudarConta(uid: string, id: string, e: EdicaoDeConta) {
  const o = await origem();
  return como(uid, (tx) => editarConta(tx, uid, id, e, hojeEmSp(), o));
}

export async function removerConta(uid: string, id: string) {
  const o = await origem();
  return como(uid, (tx) => apagarConta(tx, uid, id, hojeEmSp(), o));
}

export const categorias = (uid: string) =>
  como(uid, async (tx) => {
    await semearCategorias(tx, uid);
    return listarCategorias(tx, uid);
  });

export async function novaCategoria(uid: string, c: NovaCategoria) {
  const o = await origem();
  return como(uid, (tx) => criarCategoria(tx, uid, c, o));
}

export async function mudarCategoria(uid: string, id: string, e: EdicaoDeCategoria) {
  const o = await origem();
  return como(uid, (tx) => editarCategoria(tx, uid, id, e, o));
}

export async function removerCategoria(uid: string, id: string) {
  const o = await origem();
  return como(uid, (tx) => apagarCategoria(tx, uid, id, o));
}

export const lancamentos = (uid: string, f: FiltroDeLancamentos) =>
  como(uid, (tx) => listarLancamentos(tx, uid, f));

export async function novoLancamento(uid: string, l: NovoLancamento) {
  const o = await origem();
  return como(uid, (tx) => criarLancamento(tx, uid, l, o));
}

export async function mudarLancamento(uid: string, id: string, e: EdicaoDeLancamento) {
  const o = await origem();
  return como(uid, (tx) => editarLancamento(tx, uid, id, e, o));
}

export async function removerLancamento(uid: string, id: string) {
  const o = await origem();
  return como(uid, (tx) => apagarLancamento(tx, uid, id, o));
}

/** `mes` em YYYY-MM; sem ele, o mes de hoje em Sao Paulo. */
export function resumo(uid: string, mes?: string) {
  const hoje = hojeEmSp();
  const competencia = `${mes ?? hoje.slice(0, 7)}-01`;
  return como(uid, (tx) => resumoDoMes(tx, uid, competencia, hoje));
}

// Cartoes

export const cartoes = (uid: string) =>
  como(uid, (tx) => listarCartoes(tx, uid, hojeEmSp()));

export async function novoCartao(uid: string, c: NovoCartao) {
  const o = await origem();
  return como(uid, (tx) => criarCartao(tx, uid, c, hojeEmSp(), o));
}

export async function mudarCartao(uid: string, id: string, e: EdicaoDeCartao) {
  const o = await origem();
  return como(uid, (tx) => editarCartao(tx, uid, id, e, hojeEmSp(), o));
}

export async function removerCartao(uid: string, id: string) {
  const o = await origem();
  return como(uid, (tx) => apagarCartao(tx, uid, id, o));
}

export const faturas = (uid: string, id: string) =>
  como(uid, (tx) => listarFaturas(tx, uid, id, hojeEmSp()));

// Importacao

export const limitesDeImportacao = (): LimitesDeImportacao => ({
  bytes: env.FINANCE_IMPORT_MAX_MB * 1024 * 1024,
  linhas: env.FINANCE_IMPORT_MAX_ROWS,
  arquivos: env.FINANCE_IMPORT_MAX_FILES,
});

export const analisar = (uid: string, arquivos: ArquivoRecebido[]) =>
  como(uid, (tx) => analisarArquivos(tx, uid, arquivos, limitesDeImportacao()));

export async function novaImportacao(
  uid: string,
  pedido: NovaImportacao,
  arquivos: ArquivoRecebido[],
) {
  const o = await origem();
  return como(uid, (tx) =>
    criarImportacao(tx, uid, pedido, arquivos, limitesDeImportacao(), o),
  );
}

export const importacoes = (uid: string) => como(uid, (tx) => listarImportacoes(tx, uid));

export const importacao = (uid: string, id: string) =>
  como(uid, (tx) => obterImportacao(tx, uid, id));

export async function mudarLinha(
  uid: string,
  id: string,
  linha: string,
  e: EdicaoDeLinha,
) {
  const o = await origem();
  return como(uid, (tx) => editarLinha(tx, uid, id, linha, e, o));
}

export async function confirmar(uid: string, id: string) {
  const o = await origem();
  return como(uid, (tx) => confirmarImportacao(tx, uid, id, o));
}

export async function cancelar(uid: string, id: string) {
  const o = await origem();
  return como(uid, (tx) => cancelarImportacao(tx, uid, id, o));
}

export async function desfazer(uid: string, id: string) {
  const o = await origem();
  return como(uid, (tx) => desfazerImportacao(tx, uid, id, o));
}

// Regras

export const regras = (uid: string) => como(uid, (tx) => listarRegras(tx, uid));

export async function novaRegra(uid: string, r: NovaRegra) {
  const o = await origem();
  return como(uid, (tx) => criarRegra(tx, uid, r, o));
}

export async function mudarRegra(uid: string, id: string, e: EdicaoDeRegra) {
  const o = await origem();
  return como(uid, (tx) => editarRegra(tx, uid, id, e, o));
}

export async function removerRegra(uid: string, id: string) {
  const o = await origem();
  return como(uid, (tx) => apagarRegra(tx, uid, id, o));
}

// Fatura

export const fatura = (uid: string, cartao: string, id: string) =>
  como(uid, (tx) => detalheDaFatura(tx, uid, cartao, id));

export async function pagar(
  uid: string,
  cartao: string,
  id: string,
  p: PagamentoDeFatura,
) {
  const o = await origem();
  return como(uid, (tx) => pagarFatura(tx, uid, cartao, id, p, o));
}

// Recorrencias

export const recorrencias = (uid: string) =>
  como(uid, (tx) => listarRecorrencias(tx, uid, hojeEmSp()));

export async function novaRecorrencia(uid: string, r: NovaRecorrencia) {
  const o = await origem();
  return como(uid, (tx) => criarRecorrencia(tx, uid, r, hojeEmSp(), o));
}

export async function mudarRecorrencia(uid: string, id: string, e: EdicaoDeRecorrencia) {
  const o = await origem();
  return como(uid, (tx) => editarRecorrencia(tx, uid, id, e, hojeEmSp(), o));
}

export async function removerRecorrencia(uid: string, id: string) {
  const o = await origem();
  return como(uid, (tx) => apagarRecorrencia(tx, uid, id, hojeEmSp(), o));
}

// Painel e planejamento

const mesOuHoje = (mes?: string) => mes ?? hojeEmSp().slice(0, 7);

export function painel(uid: string, mes?: string) {
  return como(uid, (tx) => painelDoMes(tx, uid, `${mesOuHoje(mes)}-01`, hojeEmSp()));
}

export const planejamento = (uid: string, mes?: string) =>
  como(uid, (tx) => obterPlanejamento(tx, uid, mesOuHoje(mes)));

export async function novoItem(uid: string, i: NovoItemDoPlanejamento) {
  const o = await origem();
  return como(uid, (tx) => criarItem(tx, uid, i, o));
}

export async function mudarItem(uid: string, id: string, e: EdicaoDeItemDoPlanejamento) {
  const o = await origem();
  return como(uid, (tx) => editarItem(tx, uid, id, e, o));
}

export async function removerItem(uid: string, id: string) {
  const o = await origem();
  return como(uid, (tx) => apagarItem(tx, uid, id, o));
}

export async function copiarMes(uid: string, de: string, para: string) {
  const o = await origem();
  return como(uid, (tx) => copiarPlanejamento(tx, uid, de, para, o));
}

export async function puxarFixos(uid: string, mes?: string) {
  const o = await origem();
  return como(uid, (tx) => puxarRecorrencias(tx, uid, mesOuHoje(mes), o));
}
