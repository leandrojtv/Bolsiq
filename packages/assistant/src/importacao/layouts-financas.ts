import { detectarParcela } from "@bolsiq/finance/puro";
import {
  saidaVazia,
  type DocumentoFinancas,
  type LancamentoDaIA,
  type SaidaDaIA,
} from "./esquema.js";
import type { Parte } from "./texto.js";

/**
 * Atalho sem IA para faturas em PDF de layout conhecido (ADR 0040): Nubank,
 * Itau, Inter e C6. O texto ja extraido (e anonimizado) e lido por expressao
 * regular, linha a linha; cada linha vira um lancamento com o trecho sendo a
 * propria linha, e passa pela mesma validacao das linhas da IA. Layout que nao
 * casa, ou que casa e nao rende linha, vai para a IA.
 */

const MESES: Record<string, string> = {
  jan: "01",
  fev: "02",
  mar: "03",
  abr: "04",
  mai: "05",
  jun: "06",
  jul: "07",
  ago: "08",
  set: "09",
  out: "10",
  nov: "11",
  dez: "12",
};

const semAcento = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "");

/** "15 NOV 2026", "15/11/2026", "15 de nov. de 2026" -> 2026-11-15. */
function dataCompleta(t: string): string {
  const s = semAcento(t)
    .toLowerCase()
    .replace(/\bde\b|\./g, " ")
    .replace(/\s+/g, " ")
    .trim();
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  m = /^(\d{1,2}) ([a-z]{3})[a-z]* (\d{4})$/.exec(s);
  if (m && MESES[m[2]!]) return `${m[3]}-${MESES[m[2]!]}-${m[1]!.padStart(2, "0")}`;
  return "";
}

/** "05 OUT", "05/10", "05/10/2026" com o ano pela fatura. */
function dataDaLinha(t: string, vencimento: string): string {
  const completa = dataCompleta(t);
  if (completa) return completa;
  const s = semAcento(t).toLowerCase().trim();
  let dia: string | undefined;
  let mes: string | undefined;
  let m = /^(\d{1,2})\/(\d{1,2})$/.exec(s);
  if (m) [, dia, mes] = m;
  else {
    m = /^(\d{1,2}) ([a-z]{3})$/.exec(s);
    if (m && MESES[m[2]!]) [dia, mes] = [m[1], MESES[m[2]!]];
  }
  if (!dia || !mes || !vencimento) return "";
  const anoDoVencimento = Number(vencimento.slice(0, 4));
  // Compra de dezembro numa fatura de janeiro e do ano anterior.
  const ano =
    Number(mes) > Number(vencimento.slice(5, 7)) ? anoDoVencimento - 1 : anoDoVencimento;
  return `${ano}-${mes.padStart(2, "0")}-${dia.padStart(2, "0")}`;
}

/** "R$ 1.234,56", "-R$ 23,50", "− 23,50", "+ R$ 500,00" -> valor e sinal. */
const DINHEIRO = /([+\-−]?)\s*(?:R\$)?\s*([+\-−]?)\s*(\d{1,3}(?:\.\d{3})*,\d{2})$/;
const valorDe = (v: string) => v.replace(/\./g, "").replace(",", ".");

const DATA_NA_LINHA =
  /^(\d{1,2}\/\d{1,2}(?:\/\d{4})?|\d{1,2} (?:de )?[A-Za-zçÇ]{3}\.?(?: (?:de )?\d{4})?)\s*(?:\|\s*)?/;
const MOEDA =
  /(?:\|\s*)?\b(USD|US\$|EUR|€|GBP)\s*(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})\s*(?:\|\s*)?/i;

interface Layout {
  banco: string;
  /** O documento e deste banco e e uma fatura. */
  reconhece: RegExp;
  vencimento: RegExp;
  fechamento: RegExp;
  total: RegExp;
}

const LAYOUTS: Layout[] = [
  {
    banco: "Nubank",
    reconhece: /nu pagamentos[\s\S]*fatura|fatura[\s\S]*nu pagamentos/i,
    vencimento: /vencimento[:\s|]+(\d{1,2} [A-Za-z]{3} \d{4}|\d{2}\/\d{2}\/\d{4})/i,
    fechamento:
      /fechamento[:\s|]+(?:em\s+)?(\d{1,2} [A-Za-z]{3} \d{4}|\d{2}\/\d{2}\/\d{4})/i,
    total: /total a pagar[:\s|]*R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i,
  },
  {
    banco: "Itaú",
    reconhece: /ita[uú] unibanco[\s\S]*fatura|fatura[\s\S]*ita[uú] unibanco/i,
    vencimento: /vencimento[:\s|]+(\d{2}\/\d{2}\/\d{4})/i,
    fechamento: /(?:emiss[aã]o|fechamento)[:\s|]+(\d{2}\/\d{2}\/\d{4})/i,
    total: /total desta fatura[:\s|]*(?:R\$)?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i,
  },
  {
    banco: "Inter",
    reconhece: /banco inter[\s\S]*fatura|fatura[\s\S]*banco inter/i,
    vencimento: /data de vencimento[:\s|]+(\d{2}\/\d{2}\/\d{4})/i,
    fechamento: /data de fechamento[:\s|]+(\d{2}\/\d{2}\/\d{4})/i,
    total: /total da (?:sua )?fatura[:\s|]*R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i,
  },
  {
    banco: "C6",
    reconhece: /c6 bank[\s\S]*fatura|fatura[\s\S]*c6 bank/i,
    vencimento: /vencimento[:\s|]+(\d{2}\/\d{2}\/\d{4})/i,
    fechamento: /fechamento[:\s|]+(\d{2}\/\d{2}\/\d{4})/i,
    total: /valor total da fatura[:\s|]*R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i,
  },
];

/** Linha que nunca e lancamento, mesmo comecando por data. */
const NAO_E_LANCAMENTO =
  /\b(total|subtotal|limite|vencimento|fechamento|pagamento m[ií]nimo)\b/i;

export function lerLinhaDeFatura(
  linha: string,
  vencimento: string,
): Omit<LancamentoDaIA, "origem" | "confianca"> | null {
  const t = linha.replace(/\s+/g, " ").trim();
  const d = DATA_NA_LINHA.exec(t);
  if (!d) return null;
  const data = dataDaLinha(d[1]!.replace(/ de /g, " ").replace(/\.$/, ""), vencimento);
  if (!data) return null;
  let resto = t.slice(d[0].length);
  const dinheiro = DINHEIRO.exec(resto);
  if (!dinheiro) return null;
  resto = resto.slice(0, dinheiro.index).replace(/[|\s]+$/, "");
  let moeda_original = "";
  let valor_moeda_original = "";
  const m = MOEDA.exec(resto);
  if (m) {
    moeda_original = /€/.test(m[1]!)
      ? "EUR"
      : /US/i.test(m[1]!)
        ? "USD"
        : m[1]!.toUpperCase();
    valor_moeda_original = valorDe(m[2]!.replace(/\.(?=\d{2}$)/, ","));
    resto = (resto.slice(0, m.index) + resto.slice(m.index + m[0].length)).trim();
  }
  const descricao = resto
    .replace(/\s*\|\s*/g, " ")
    .replace(/\s+-\s*$/, "")
    .trim();
  if (!descricao || NAO_E_LANCAMENTO.test(descricao)) return null;
  const credito = /[-−+]/.test(`${dinheiro[1]}${dinheiro[2]}`);
  const parcela = detectarParcela(descricao);
  return {
    data,
    descricao,
    valor: valorDe(dinheiro[3]!),
    sinal: credito ? "credito" : "debito",
    parcela_atual: parcela ? String(parcela.atual) : "",
    parcela_total: parcela ? String(parcela.total) : "",
    moeda_original,
    valor_moeda_original,
  };
}

/** A fatura lida pelo layout do banco, ou null (vai para a IA). */
export function lerFaturaConhecida(partes: Parte[]): SaidaDaIA | null {
  const tudo = partes.map((p) => p.texto).join("\n");
  const layout = LAYOUTS.find((l) => l.reconhece.test(tudo));
  if (!layout) return null;
  const achar = (re: RegExp) => re.exec(tudo)?.[1] ?? "";
  const vencimento = dataCompleta(achar(layout.vencimento));
  if (!vencimento) return null;
  const total = achar(layout.total);
  const documento: DocumentoFinancas = {
    banco: layout.banco,
    tipo: "fatura_cartao",
    final_cartao:
      /final\s*(?:do cart[aã]o)?[:\s|]*(?:\*{0,4}\s*)?(\d{4})\b/i.exec(tudo)?.[1] ?? "",
    data_fechamento: dataCompleta(achar(layout.fechamento)),
    data_vencimento: vencimento,
    total_fatura: total ? valorDe(total) : "",
    periodo_inicio: "",
    periodo_fim: "",
  };
  const lancamentos: LancamentoDaIA[] = [];
  for (const p of partes)
    for (const linha of p.texto.split("\n")) {
      const l = lerLinhaDeFatura(linha, vencimento);
      if (l)
        lancamentos.push({
          ...l,
          origem: {
            pagina_ou_aba: p.origem,
            trecho_original: linha.trim().slice(0, 200),
          },
          confianca: "alta",
        });
    }
  if (lancamentos.length === 0) return null;
  return {
    ...saidaVazia(),
    documento: {
      tipo: "fatura_cartao",
      corretora: layout.banco,
      data_referencia: vencimento,
      totais_declarados: documento.total_fatura
        ? [{ descricao: "total da fatura", valor: documento.total_fatura }]
        : [],
      financas: documento,
    },
    lancamentos,
    avisos: [`Fatura do ${layout.banco} lida pelo layout conhecido, sem IA.`],
  };
}
