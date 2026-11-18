import { randomUUID } from "node:crypto";
import type { LinhaRejeitada } from "./csv.js";
import { d, dividir as dividirDecimal, moeda } from "./decimal.js";
import { apurar } from "./posicao.js";
import type {
  PendenciaDePosicao,
  PosicaoLida,
  RelatorioDeImportacaoDePosicao,
  TotalDaCorretora,
} from "./posicao-csv.js";
import {
  CLASSES_COM_TICKER,
  type DecisaoDeDivergencia,
  type Transacao,
} from "./tipos.js";

/** O que ja existe na carteira e pesa na carga. */
export interface BaseDaCarga {
  transacoes: Transacao[];
  vigentes: PosicaoVigente[];
  cargas: { corretora: string; data_posicao: string }[];
}

export interface PosicaoVigente {
  corretora: string;
  chave_ativo: string;
  ativo: string;
  classe: string;
  data_posicao: string;
  saldo_bruto: string;
  quantidade: string | null;
  valor_aplicado: string | null;
}

export interface LinhaDaRevisao {
  corretora: string;
  ativo: string;
  classe: string;
  saldo_bruto: string;
}

export interface LinhaAlterada extends LinhaDaRevisao {
  saldo_anterior: string;
}

export interface DivergenciaDeQuantidade {
  corretora: string;
  ticker: string;
  sistema: string;
  extrato: string;
  /** Nulo quando o extrato nao da preco: nao ha ajuste a oferecer. */
  ajuste: { tipo: "compra" | "venda"; quantidade: string; preco: string } | null;
  data_posicao: string;
}

export interface SaldoInicialPrevisto {
  corretora: string;
  ticker: string;
  quantidade: string;
  preco: string;
  data_posicao: string;
}

export interface RevisaoDeCarga {
  totais_por_corretora: TotalDaCorretora[];
  novas: LinhaDaRevisao[];
  alteradas: LinhaAlterada[];
  removidas: LinhaDaRevisao[];
  saldos_iniciais: SaldoInicialPrevisto[];
  divergencias: DivergenciaDeQuantidade[];
  pendencias: PendenciaDePosicao[];
  rejeicoes: LinhaRejeitada[];
  /** Corretoras com carga igual ou mais recente: impedem a confirmacao. */
  recusas: string[];
  linhas_lidas: number;
  linhas_aceitas: number;
}

export const ehRendaVariavel = (p: PosicaoLida) => CLASSES_COM_TICKER.includes(p.classe);

export const dataBr = (iso: string) => iso.split("-").reverse().join("/");

const mesmaCorretora = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/** Preco de custo do saldo inicial: o medio e, sem ele, o melhor que a linha der. */
function precoDeCusto(p: PosicaoLida): string {
  if (p.preco_medio !== null) return p.preco_medio;
  if (p.valor_aplicado !== null)
    return moeda(dividirDecimal(d(p.valor_aplicado), d(p.quantidade ?? "0")) ?? d(0), 6);
  return precoDoExtrato(p);
}

function precoDoExtrato(p: PosicaoLida): string {
  const porSaldo = dividirDecimal(d(p.saldo_bruto), d(p.quantidade ?? "0"));
  return p.preco_unitario ?? moeda(porSaldo ?? d(0), 6);
}

/**
 * Compara o arquivo com a carteira, sem gravar nada. Roda de novo na confirmacao:
 * entre a revisao e o clique a carteira pode ter mudado.
 *
 * Transacao sem corretora (extrato da B3, lancamento sem o campo, evento
 * corporativo) conta como possivelmente desta corretora. Sem isso, quem importou
 * o extrato da B3 e depois a posicao da XP teria a quantidade dobrada por um
 * saldo inicial indevido (ADR 0025).
 */
export function revisarCarga(
  r: RelatorioDeImportacaoDePosicao,
  base: BaseDaCarga,
): RevisaoDeCarga {
  const rv = r.posicoes.filter(ehRendaVariavel);
  const demais = r.posicoes.filter((p) => !ehRendaVariavel(p));

  const saldos_iniciais: SaldoInicialPrevisto[] = [];
  const divergencias: DivergenciaDeQuantidade[] = [];
  for (const p of rv) {
    const ticker = p.codigo as string;
    const quantidade = d(p.quantidade as string);
    const dela = base.transacoes.filter(
      (t) =>
        t.ticker === ticker &&
        (t.corretora === undefined || mesmaCorretora(t.corretora, p.corretora)),
    );
    if (dela.length === 0) {
      if (quantidade.gt(0))
        saldos_iniciais.push({
          corretora: p.corretora,
          ticker,
          quantidade: quantidade.toString(),
          preco: precoDeCusto(p),
          data_posicao: p.data_posicao,
        });
      continue;
    }
    const sistema = d(apurar(dela).posicoes[0]?.quantidade ?? "0");
    if (sistema.eq(quantidade)) continue;
    const preco = precoDoExtrato(p);
    divergencias.push({
      corretora: p.corretora,
      ticker,
      sistema: sistema.toString(),
      extrato: quantidade.toString(),
      ajuste: d(preco).gt(0)
        ? {
            tipo: quantidade.gt(sistema) ? "compra" : "venda",
            quantidade: quantidade.minus(sistema).abs().toString(),
            preco,
          }
        : null,
      data_posicao: p.data_posicao,
    });
  }

  // Ticker com saldo na corretora que sumiu do extrato. So transacao com esta
  // corretora escrita: a sem corretora pode estar em qualquer outra.
  for (const total of r.totais_por_corretora) {
    const daCorretora = base.transacoes.filter(
      (t) => t.corretora !== undefined && mesmaCorretora(t.corretora, total.corretora),
    );
    const noArquivo = new Set(
      rv.filter((p) => p.corretora === total.corretora).map((p) => p.codigo),
    );
    for (const pos of apurar(daCorretora).posicoes) {
      if (noArquivo.has(pos.ticker) || d(pos.quantidade).lte(0)) continue;
      divergencias.push({
        corretora: total.corretora,
        ticker: pos.ticker,
        sistema: d(pos.quantidade).toString(),
        extrato: "0",
        ajuste: null,
        data_posicao: total.data_posicao,
      });
    }
  }

  const chave = (x: { corretora: string; chave_ativo: string }) =>
    `${x.corretora}|${x.chave_ativo}`;
  const vigentes = new Map(base.vigentes.map((v) => [chave(v), v]));
  const noArquivo = new Set(demais.map(chave));
  const corretoras = new Set(r.totais_por_corretora.map((t) => t.corretora));
  const linha = (p: PosicaoLida): LinhaDaRevisao => ({
    corretora: p.corretora,
    ativo: p.ativo,
    classe: p.classe,
    saldo_bruto: p.saldo_bruto,
  });
  const igual = (a: string | null, b: string | null) =>
    a === null || b === null ? a === b : d(a).eq(d(b));

  const novas: LinhaDaRevisao[] = [];
  const alteradas: LinhaAlterada[] = [];
  for (const p of demais) {
    const v = vigentes.get(chave(p));
    if (!v) novas.push(linha(p));
    else if (
      !igual(v.saldo_bruto, p.saldo_bruto) ||
      !igual(v.quantidade, p.quantidade) ||
      !igual(v.valor_aplicado, p.valor_aplicado)
    )
      alteradas.push({ ...linha(p), saldo_anterior: v.saldo_bruto });
  }
  const removidas = base.vigentes
    .filter((v) => corretoras.has(v.corretora) && !noArquivo.has(chave(v)))
    .map((v) => ({
      corretora: v.corretora,
      ativo: v.ativo,
      classe: v.classe,
      saldo_bruto: v.saldo_bruto,
    }));

  const recusas = r.totais_por_corretora.flatMap((t) => {
    const carga = base.cargas.find((c) => c.corretora === t.corretora);
    return carga && t.data_posicao <= carga.data_posicao
      ? [
          `${t.corretora}: o arquivo é de ${dataBr(t.data_posicao)} e já existe carga de ${dataBr(carga.data_posicao)}. Envie um extrato mais recente.`,
        ]
      : [];
  });

  return {
    totais_por_corretora: r.totais_por_corretora,
    novas,
    alteradas,
    removidas,
    saldos_iniciais,
    divergencias,
    pendencias: r.pendencias,
    rejeicoes: r.rejeicoes,
    recusas,
    linhas_lidas: r.linhas_lidas,
    linhas_aceitas: r.posicoes.length,
  };
}

/** Transacoes que a carga gera: saldos iniciais e os ajustes que o usuario pediu. */
export function transacoesDaCarga(
  revisao: RevisaoDeCarga,
  decisoes: DecisaoDeDivergencia[],
): Transacao[] {
  const iniciais: Transacao[] = revisao.saldos_iniciais.map((s) => ({
    id: randomUUID(),
    ticker: s.ticker,
    tipo: "saldo_inicial",
    data: s.data_posicao,
    quantidade: s.quantidade,
    preco: s.preco,
    taxas: "0",
    corretora: s.corretora,
  }));
  const ajustes: Transacao[] = revisao.divergencias.flatMap((x) => {
    const pediu = decisoes.some(
      (o) =>
        o.acao === "gerar_ajuste" && o.ticker === x.ticker && o.corretora === x.corretora,
    );
    return pediu && x.ajuste
      ? [
          {
            id: randomUUID(),
            ticker: x.ticker,
            tipo: x.ajuste.tipo,
            data: x.data_posicao,
            quantidade: x.ajuste.quantidade,
            preco: x.ajuste.preco,
            taxas: "0",
            corretora: x.corretora,
          },
        ]
      : [];
  });
  return [...iniciais, ...ajustes];
}

export class CargaRecusada extends Error {
  constructor(readonly recusas: string[]) {
    super(recusas.join(" "));
  }
}
