import { Decimal } from "decimal.js";
import { conferirFatura, marcacaoDe, type Marcacao } from "@bolsiq/finance/puro";
import type {
  Confianca,
  DocumentoFinancas,
  LancamentoDaIA,
  Origem,
  SaidaDaIA,
} from "./esquema.js";
import { data as normalizarData, numero, PARECE_TOTAL, vazio } from "./normalizar.js";
import type { Parte } from "./texto.js";
import {
  conferirOrigem,
  FontesDoDocumento,
  palavrasDoNome,
  type ParaCorrigir,
} from "./validacao.js";

/**
 * Validacao das linhas de fatura e extrato (ADR 0040). A IA so propoe: cada
 * linha tem de estar no documento (trecho, valor e descricao), com data valida
 * e nao futura e sinal conhecido. O que passa vira um lancamento lido, que o
 * Bolsiq Financas leva a mesma revisao do OFX. Pagamento, estorno, saldo
 * anterior e IOF sao marcados aqui; a soma e conferida com o total da fatura.
 */

export interface LancamentoValidado {
  indice: number;
  data: string;
  descricao: string;
  /** Positivo, duas casas. */
  valor: string;
  sentido: "credito" | "debito";
  parcela: { atual: number; total: number } | null;
  moeda_original: string | null;
  valor_moeda_original: string | null;
  marcacao: Marcacao | null;
  confianca: Confianca;
  origem: Origem;
  avisos: string[];
}

export interface RejeicaoDeLancamento {
  linha: LancamentoDaIA;
  motivo: string;
}

export interface ConferenciaDaFatura {
  total_informado: string;
  total_calculado: string;
  diferenca: string;
  confere: boolean;
  /** Indices em `linhas`. */
  suspeitas: number[];
}

export interface ResultadoDaValidacaoFinancas {
  documento: DocumentoFinancas;
  linhas: LancamentoValidado[];
  rejeicoes: RejeicaoDeLancamento[];
  para_corrigir: ParaCorrigir[];
  /** So fatura com total escrito. */
  conferencia: ConferenciaDaFatura | null;
  avisos: string[];
}

export interface OpcoesDaValidacaoFinancas {
  hoje: string;
  sem_texto?: string[];
}

const MOEDAS: Record<string, string> = {
  US$: "USD",
  U$: "USD",
  DOLAR: "USD",
  "€": "EUR",
  EURO: "EUR",
  "£": "GBP",
};

function moeda(v: string): string | null {
  const t = v.trim().toUpperCase();
  if (!t) return null;
  if (MOEDAS[t]) return MOEDAS[t] ?? null;
  return /^[A-Z]{3}$/.test(t) && t !== "BRL" ? t : null;
}

const duasCasas = (v: string) => new Decimal(v).abs().toFixed(2);

function lerNumero(v: string): string | null {
  const n = numero(v);
  if (!n || !/^-?\d+(\.\d+)?$/.test(n)) return null;
  return n;
}

function lerParcela(a: string, t: string) {
  const atual = Number(a.trim());
  const total = Number(t.trim());
  if (!a.trim() && !t.trim()) return { parcela: null, aviso: null };
  if (Number.isInteger(atual) && Number.isInteger(total) && atual >= 1 && total >= 2)
    if (atual <= total) return { parcela: { atual, total }, aviso: null };
  return { parcela: null, aviso: `parcela ${a}/${t} não faz sentido e foi ignorada` };
}

/** O cabecalho normalizado: datas ISO e total com ponto. */
export function documentoNormalizado(d: DocumentoFinancas): DocumentoFinancas {
  return {
    ...d,
    banco: d.banco.trim(),
    final_cartao: d.final_cartao.replace(/\D/g, "").slice(-4),
    data_fechamento: normalizarData(d.data_fechamento),
    data_vencimento: normalizarData(d.data_vencimento),
    periodo_inicio: normalizarData(d.periodo_inicio),
    periodo_fim: normalizarData(d.periodo_fim),
    total_fatura: (() => {
      const n = lerNumero(d.total_fatura);
      return n ? duasCasas(n) : "";
    })(),
  };
}

const iso = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

export function validarLancamentos(
  saida: SaidaDaIA,
  partes: Parte[],
  o: OpcoesDaValidacaoFinancas,
): ResultadoDaValidacaoFinancas {
  const documento = documentoNormalizado(
    saida.documento.financas ?? {
      banco: saida.documento.corretora,
      tipo: "fatura_cartao",
      final_cartao: "",
      data_fechamento: "",
      data_vencimento: "",
      total_fatura: "",
      periodo_inicio: "",
      periodo_fim: "",
    },
  );
  const tipo = documento.tipo === "extrato_conta" ? "conta" : "cartao";
  const fontes = new FontesDoDocumento(
    partes,
    new Set((o.sem_texto ?? []).map((s) => s.toLowerCase())),
  );
  const linhas: LancamentoValidado[] = [];
  const rejeicoes: RejeicaoDeLancamento[] = [];
  const para_corrigir: ParaCorrigir[] = [];
  const recusar = (l: LancamentoDaIA, motivo: string, corrigivel = true) => {
    rejeicoes.push({ linha: l, motivo });
    if (corrigivel) para_corrigir.push({ tipo: "lancamento", original: l, motivo });
  };

  for (const l of saida.lancamentos) {
    const descricao = l.descricao.replace(/\s+/g, " ").trim();
    if (!descricao || PARECE_TOTAL.test(descricao) || /^limite\b/i.test(descricao)) {
      recusar(l, "linha de total ou de resumo, não é lançamento", false);
      continue;
    }
    const dia = normalizarData(l.data);
    if (!iso(dia)) {
      recusar(l, `data ${l.data || "vazia"} inválida`);
      continue;
    }
    if (dia > o.hoje) {
      recusar(l, `data ${dia} no futuro`);
      continue;
    }
    const bruto = lerNumero(l.valor);
    if (!bruto || new Decimal(bruto).isZero()) {
      recusar(l, `valor ${l.valor || "vazio"} inválido`);
      continue;
    }
    const s = l.sinal.trim().toLowerCase();
    const sentido = s.startsWith("c") ? "credito" : s.startsWith("d") ? "debito" : null;
    if (!sentido) {
      recusar(l, `sinal ${l.sinal || "vazio"}: use debito ou credito`);
      continue;
    }
    const valorOriginal = vazio(l.valor_moeda_original)
      ? null
      : lerNumero(l.valor_moeda_original);
    const conferida = conferirOrigem(
      fontes,
      l.origem,
      l.confianca,
      [
        { campo: "valor", valor: duasCasas(bruto) },
        ...(valorOriginal
          ? [{ campo: "valor_moeda_original", valor: duasCasas(valorOriginal) }]
          : []),
      ],
      { grafias: [descricao, ...palavrasDoNome(descricao)], rotulo: "descricao" },
    );
    if (!conferida.ok) {
      recusar(
        l,
        conferida.motivo ?? "não confere com o documento",
        !/parece instrução/.test(conferida.motivo ?? ""),
      );
      continue;
    }
    const { parcela, aviso } = lerParcela(l.parcela_atual, l.parcela_total);
    const m = valorOriginal ? moeda(l.moeda_original) : null;
    linhas.push({
      indice: linhas.length,
      data: dia,
      descricao,
      valor: duasCasas(bruto),
      sentido,
      parcela,
      moeda_original: m,
      valor_moeda_original: m && valorOriginal ? duasCasas(valorOriginal) : null,
      marcacao: marcacaoDe(descricao, tipo, sentido),
      confianca: conferida.confianca,
      origem: l.origem,
      avisos: [...conferida.avisos, ...(aviso ? [aviso] : [])],
    });
  }

  separarIof(linhas);

  const avisos = [...saida.avisos];
  let conferencia: ConferenciaDaFatura | null = null;
  if (tipo === "cartao" && documento.total_fatura) {
    const c = conferirFatura(
      documento.total_fatura,
      linhas.map((l) => ({
        id: String(l.indice),
        tipo: l.sentido === "debito" ? "despesa" : "receita",
        valor: l.valor,
        marcacao: l.marcacao,
        data: l.data,
        descricao_normalizada: l.descricao.toUpperCase(),
        aviso: l.confianca === "baixa" ? "baixa" : null,
      })),
    );
    conferencia = { ...c, suspeitas: c.suspeitas.map(Number) };
    if (!c.confere)
      avisos.push(
        `A soma das linhas (R$ ${c.total_calculado}) não bate com o total da fatura (R$ ${c.total_informado}): diferença de R$ ${c.diferenca}. Confira as linhas destacadas.`,
      );
  } else if (tipo === "cartao")
    avisos.push("A fatura não traz o total escrito: confira a soma com o app do banco.");
  return { documento, linhas, rejeicoes, para_corrigir, conferencia, avisos };
}

/**
 * IOF de compra internacional em lancamento proprio, com categoria IOF. Quando
 * o banco repete o nome da compra na linha do IOF (mesma data, sem moeda, valor
 * pequeno), a linha ganha o prefixo "IOF": separa as duas no hash e na
 * categoria, como no CSV do C6.
 */
function separarIof(linhas: LancamentoValidado[]) {
  const internacionais = linhas.filter((l) => l.moeda_original && l.sentido === "debito");
  for (const c of internacionais) {
    const iof = linhas.find(
      (l) =>
        l !== c &&
        !l.moeda_original &&
        l.marcacao === null &&
        l.sentido === "debito" &&
        l.data === c.data &&
        l.descricao === c.descricao &&
        new Decimal(l.valor).lt(new Decimal(c.valor).times(0.1)),
    );
    if (iof) {
      iof.descricao = `IOF ${iof.descricao}`;
      iof.marcacao = "iof";
    }
  }
}
