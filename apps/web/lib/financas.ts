import "server-only";
import { headers } from "next/headers";
import {
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
