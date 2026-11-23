import type { MapeamentoDeCsv } from "../contratos-importacao.js";
import { d, moeda } from "../decimal.js";
import { marcacaoDe } from "./normalizar.js";
import {
  ErroDeLeitura,
  type ExtratoLido,
  type LeitorDeExtrato,
  type LinhaLida,
  type TipoDeExtrato,
} from "./tipos.js";

/**
 * CSV de banco: um leitor por layout conhecido (Nubank cartao e conta, Inter e
 * Itau conta; o C6 tem o seu em csv-c6.ts) e um leitor generico, montado com o
 * mapeamento de colunas que o usuario salvou para aquele cabecalho.
 */

export const semAcento = (t: string) =>
  t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Separa por `sep` respeitando aspas, com aspas duplicadas dentro do campo. */
export function camposDaLinha(linha: string, sep: string): string[] {
  const saida: string[] = [];
  let atual = "";
  let aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '"') {
      if (aspas && linha[i + 1] === '"') {
        atual += '"';
        i++;
      } else aspas = !aspas;
    } else if (c === sep && !aspas) {
      saida.push(atual);
      atual = "";
    } else atual += c;
  }
  saida.push(atual);
  return saida.map((x) => x.trim());
}

const SEPARADORES = [";", ",", "\t", "|"] as const;
export type Separador = (typeof SEPARADORES)[number];

/** O separador que divide a linha em mais campos. */
export function separadorDe(linha: string): Separador {
  let melhor: Separador = ";";
  let n = 0;
  for (const s of SEPARADORES) {
    const k = camposDaLinha(linha, s).length;
    if (k > n) {
      melhor = s;
      n = k;
    }
  }
  return melhor;
}

const linhasDe = (texto: string) => texto.split(/\r?\n/);

/** dd/mm/aaaa, dd/mm/aa, dd-mm-aaaa, aaaa-mm-dd e mm/dd/aaaa (so com o formato pedido). */
export type FormatoDeData = MapeamentoDeCsv["formato_data"];

export function dataDoCsv(t: string, formato: FormatoDeData = "dd/mm/aaaa"): string | null {
  const s = t.trim().slice(0, 10);
  let ano: string;
  let mes: string;
  let dia: string;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const br = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (iso) [, ano, mes, dia] = iso as unknown as [string, string, string, string];
  else if (br) {
    const [, a, b, c] = br as unknown as [string, string, string, string];
    [dia, mes] = formato === "mm/dd/aaaa" ? [b, a] : [a, b];
    ano = c.length === 2 ? `20${c}` : c;
  } else return null;
  const r = `${ano}-${mes.padStart(2, "0")}-${dia.padStart(2, "0")}`;
  const x = new Date(`${r}T00:00:00Z`);
  return Number.isNaN(x.getTime()) || x.toISOString().slice(0, 10) !== r ? null : r;
}

export type SeparadorDecimal = MapeamentoDeCsv["decimal"];

/**
 * Valor de CSV com sinal: "1.234,56", "-50,00", "R$ -12,30", "(12,30)", "12.30",
 * "12,30 D". Sem `decimal`, a virgula decide: se aparece, e a decimal.
 */
export function valorDoCsv(t: string, decimal?: SeparadorDecimal): string | null {
  let s = t.trim().replace(/\s|R\$|BRL/gi, "");
  let negativo = false;
  if (/^\(.*\)$/.test(s)) {
    negativo = true;
    s = s.slice(1, -1);
  }
  if (/[dD]$/.test(s)) {
    negativo = true;
    s = s.slice(0, -1);
  } else if (/[cC]$/.test(s)) s = s.slice(0, -1);
  if (s.startsWith("-")) {
    negativo = !negativo;
    s = s.slice(1);
  } else if (s.startsWith("+")) s = s.slice(1);
  const virgula = decimal ? decimal === "virgula" : s.includes(",");
  s = virgula ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return moeda(negativo ? d(s).neg() : d(s));
}

interface Bruta {
  data: string;
  descricao: string;
  /** Com sinal: negativo sai da conta (debito) ou, no cartao, e credito. */
  valor: string;
  fitid?: string | null;
}

/**
 * Linhas brutas em `LinhaLida`. Na conta, negativo e debito; no cartao, positivo
 * e compra (debito) e negativo e credito (pagamento ou estorno). Saldo do dia e
 * saldo anterior so informam: entram marcados e a revisao os deixa de fora.
 */
function paraLinhas(tipo: TipoDeExtrato, brutas: Bruta[]): LinhaLida[] {
  return brutas.map((b, indice) => {
    const negativo = d(b.valor).isNegative();
    const sentido =
      tipo === "cartao"
        ? negativo
          ? "credito"
          : "debito"
        : negativo
          ? "debito"
          : "credito";
    const marcacao = marcacaoDe(b.descricao, tipo, sentido);
    return {
      indice,
      fitid: b.fitid ?? null,
      trntype: null,
      data: b.data,
      valor: moeda(d(b.valor).abs()),
      sentido,
      descricao: b.descricao.replace(/\s+/g, " ").trim() || "(sem descrição)",
      marcacao,
      categoria_sugerida: marcacao === "iof" ? "IOF" : null,
    } satisfies LinhaLida;
  });
}

function extrato(
  formato: string,
  tipo: TipoDeExtrato,
  banco: string,
  linhas: LinhaLida[],
  avisos: string[],
  extra: Partial<ExtratoLido> = {},
): ExtratoLido {
  const datas = linhas.map((l) => l.data).sort();
  return {
    formato,
    tipo,
    banco,
    conta: null,
    inicio: datas[0] ?? null,
    fim: datas.at(-1) ?? null,
    saldo: null,
    linhas,
    avisos,
    ...extra,
  };
}

/** Acha a linha do cabecalho (pode haver preambulo) com todas as colunas pedidas. */
function acharCabecalho(texto: string, colunas: string[], ate = 15) {
  const linhas = linhasDe(texto);
  for (let i = 0; i < Math.min(ate, linhas.length); i++) {
    const l = linhas[i] ?? "";
    const sep = separadorDe(l);
    const nomes = camposDaLinha(l, sep).map(semAcento);
    if (colunas.every((c) => nomes.includes(c)))
      return { indice: i, sep, nomes, corpo: linhas.slice(i + 1) };
  }
  return null;
}

/** Le o corpo com as colunas achadas; linha ilegivel vira aviso. */
function lerCorpo(
  achado: NonNullable<ReturnType<typeof acharCabecalho>>,
  ler: (v: (nome: string) => string) => Bruta | null,
  avisos: string[],
): Bruta[] {
  const brutas: Bruta[] = [];
  for (const [i, linha] of achado.corpo.entries()) {
    if (!linha.trim()) continue;
    const c = camposDaLinha(linha, achado.sep);
    const v = (nome: string) => c[achado.nomes.indexOf(nome)] ?? "";
    const b = ler(v);
    if (!b || d(b.valor).isZero()) {
      avisos.push(`linha ${achado.indice + i + 2} ignorada: data ou valor ilegível`);
      continue;
    }
    brutas.push(b);
  }
  return brutas;
}

// Nubank ---------------------------------------------------------------------

/** Fatura do cartao Nubank: date,title,amount (data ISO, compra positiva). */
export const leitorCsvNubankCartao: LeitorDeExtrato = {
  formato: "csv-nubank-cartao",
  reconhece: (t) => acharCabecalho(t, ["date", "title", "amount"], 1) !== null,
  ler(texto, nome) {
    const a = acharCabecalho(texto, ["date", "title", "amount"], 1);
    if (!a) throw new ErroDeLeitura("CSV sem o cabeçalho da fatura do Nubank");
    const avisos: string[] = [];
    const brutas = lerCorpo(
      a,
      (v) => {
        const data = dataDoCsv(v("date"), "aaaa-mm-dd");
        const valor = valorDoCsv(v("amount"), "ponto");
        return data && valor ? { data, descricao: v("title"), valor } : null;
      },
      avisos,
    );
    // Nubank_2026-11-15.csv: o nome traz o vencimento.
    const venc = /(\d{4}-\d{2}-\d{2})/.exec(nome)?.[1] ?? null;
    return extrato("csv-nubank-cartao", "cartao", "Nubank", paraLinhas("cartao", brutas), avisos, {
      vencimento: venc && dataDoCsv(venc, "aaaa-mm-dd") ? venc : null,
    });
  },
};

/** Extrato da conta Nubank: Data,Valor,Identificador,Descricao (o identificador e o FITID). */
export const leitorCsvNubankConta: LeitorDeExtrato = {
  formato: "csv-nubank-conta",
  reconhece: (t) =>
    acharCabecalho(t, ["data", "valor", "identificador", "descricao"], 1) !== null,
  ler(texto) {
    const a = acharCabecalho(texto, ["data", "valor", "identificador", "descricao"], 1);
    if (!a) throw new ErroDeLeitura("CSV sem o cabeçalho do extrato do Nubank");
    const avisos: string[] = [];
    const brutas = lerCorpo(
      a,
      (v) => {
        const data = dataDoCsv(v("data"));
        const valor = valorDoCsv(v("valor"), "ponto");
        return data && valor
          ? { data, descricao: v("descricao"), valor, fitid: v("identificador") || null }
          : null;
      },
      avisos,
    );
    return extrato("csv-nubank-conta", "conta", "Nubank", paraLinhas("conta", brutas), avisos);
  },
};

// Inter ----------------------------------------------------------------------

const COLUNAS_INTER = ["data lancamento", "historico", "descricao", "valor"];

/**
 * Extrato da conta Inter: preambulo (Conta, Periodo, Saldo) e depois
 * "Data Lancamento;Historico;Descricao;Valor;Saldo", valor com virgula.
 */
export const leitorCsvInterConta: LeitorDeExtrato = {
  formato: "csv-inter-conta",
  reconhece: (t) => acharCabecalho(t, COLUNAS_INTER) !== null,
  ler(texto) {
    const a = acharCabecalho(texto, COLUNAS_INTER);
    if (!a) throw new ErroDeLeitura("CSV sem o cabeçalho do extrato do Inter");
    const avisos: string[] = [];
    const brutas = lerCorpo(
      a,
      (v) => {
        const data = dataDoCsv(v("data lancamento"));
        const valor = valorDoCsv(v("valor"), "virgula");
        const descricao = [v("historico"), v("descricao")].filter(Boolean).join(" ");
        return data && valor ? { data, descricao, valor } : null;
      },
      avisos,
    );
    const linhas = linhasDe(texto).slice(0, a.indice);
    const saldo = linhas
      .map((l) => camposDaLinha(l, a.sep))
      .find((c) => semAcento(c[0] ?? "") === "saldo");
    const fim = brutas.map((b) => b.data).sort().at(-1);
    const valorDoSaldo = saldo ? valorDoCsv(saldo[1] ?? "", "virgula") : null;
    return extrato("csv-inter-conta", "conta", "Inter", paraLinhas("conta", brutas), avisos, {
      saldo: valorDoSaldo && fim ? { valor: valorDoSaldo, data: fim } : null,
    });
  },
};

// Itau -----------------------------------------------------------------------

const COLUNAS_ITAU = ["data", "lancamento", "valor (r$)"];

/** Extrato da conta Itau: data;lancamento;ag./origem;valor (R$);saldos (R$). */
export const leitorCsvItauConta: LeitorDeExtrato = {
  formato: "csv-itau-conta",
  reconhece: (t) => acharCabecalho(t, COLUNAS_ITAU, 3) !== null,
  ler(texto) {
    const a = acharCabecalho(texto, COLUNAS_ITAU, 3);
    if (!a) throw new ErroDeLeitura("CSV sem o cabeçalho do extrato do Itaú");
    const avisos: string[] = [];
    const brutas = lerCorpo(
      a,
      (v) => {
        const data = dataDoCsv(v("data"));
        // SALDO ANTERIOR e SALDO DO DIA trazem o numero so na coluna de saldos.
        const valor =
          valorDoCsv(v("valor (r$)"), "virgula") ??
          (/^saldo/.test(semAcento(v("lancamento")))
            ? valorDoCsv(v("saldos (r$)"), "virgula")
            : null);
        return data && valor ? { data, descricao: v("lancamento"), valor } : null;
      },
      avisos,
    );
    return extrato("csv-itau-conta", "conta", "Itaú", paraLinhas("conta", brutas), avisos);
  },
};

// Generico -------------------------------------------------------------------

export interface CabecalhoDeCsv {
  assinatura: string;
  separador: Separador;
  colunas: string[];
  /** As primeiras linhas, para a tela mostrar ao mapear. */
  amostra: string[][];
}

/**
 * O cabecalho de um CSV desconhecido: a primeira linha (das 15 primeiras) com
 * pelo menos 3 campos nao vazios e seguida de uma linha com o mesmo numero de
 * campos. A assinatura e o cabecalho normalizado: mesmo banco, mesma assinatura.
 */
export function cabecalhoDoCsv(texto: string): (CabecalhoDeCsv & { indice: number }) | null {
  const linhas = linhasDe(texto);
  for (let i = 0; i < Math.min(15, linhas.length - 1); i++) {
    const l = linhas[i] ?? "";
    const sep = separadorDe(l);
    const nomes = camposDaLinha(l, sep).map(semAcento);
    if (nomes.filter(Boolean).length < 3) continue;
    const seguinte = camposDaLinha(linhas[i + 1] ?? "", sep);
    if (seguinte.length !== nomes.length) continue;
    return {
      indice: i,
      assinatura: nomes.join("|").slice(0, 500),
      separador: sep,
      colunas: nomes,
      amostra: linhas
        .slice(i + 1, i + 6)
        .filter((x) => x.trim())
        .map((x) => camposDaLinha(x, sep)),
    };
  }
  return null;
}

/** CSV que nenhum leitor reconhece e que tem cabecalho: a tela pede o mapeamento. */
export class PrecisaDeMapeamento extends ErroDeLeitura {
  constructor(
    readonly nome: string,
    readonly csv: CabecalhoDeCsv,
  ) {
    super(`${nome}: CSV desconhecido. Diga qual coluna é a data, a descrição e o valor.`);
  }
}

export function leitorCsvMapeado(m: MapeamentoDeCsv): LeitorDeExtrato {
  return {
    formato: "csv-mapeado",
    reconhece: (t) => cabecalhoDoCsv(t)?.assinatura === m.assinatura,
    ler(texto) {
      const c = cabecalhoDoCsv(texto);
      if (!c || c.assinatura !== m.assinatura)
        throw new ErroDeLeitura("o cabeçalho não é o do mapeamento salvo");
      const col = (nome: string | null) => (nome ? c.colunas.indexOf(nome) : -1);
      for (const [campo, nome] of [
        ["data", m.data],
        ["descrição", m.descricao],
      ] as const)
        if (col(nome) === -1) throw new ErroDeLeitura(`coluna de ${campo} não encontrada`);
      if (col(m.valor) === -1 && col(m.credito) === -1 && col(m.debito) === -1)
        throw new ErroDeLeitura("coluna de valor não encontrada");
      const avisos: string[] = [];
      const brutas: (Bruta & { parcela: string })[] = [];
      const corpo = linhasDe(texto).slice(c.indice + 1);
      for (const [i, linha] of corpo.entries()) {
        if (!linha.trim()) continue;
        const campos = camposDaLinha(linha, c.separador);
        const v = (nome: string | null) => {
          const k = col(nome);
          return k === -1 ? "" : (campos[k] ?? "");
        };
        const data = dataDoCsv(v(m.data), m.formato_data);
        let valor: string | null;
        if (m.valor) valor = valorDoCsv(v(m.valor), m.decimal);
        else {
          const cr = v(m.credito) ? valorDoCsv(v(m.credito), m.decimal) : null;
          const db = v(m.debito) ? valorDoCsv(v(m.debito), m.decimal) : null;
          // Na conta, credito entra (+) e debito sai (-); no cartao, ao contrario.
          const comSinal = (x: string, entra: boolean) =>
            moeda(entra !== (m.tipo === "cartao") ? d(x).abs() : d(x).abs().neg());
          valor =
            db && !d(db).isZero()
              ? comSinal(db, false)
              : cr && !d(cr).isZero()
                ? comSinal(cr, true)
                : null;
        }
        if (!data || !valor || d(valor).isZero()) {
          avisos.push(`linha ${c.indice + i + 2} ignorada: data ou valor ilegível`);
          continue;
        }
        brutas.push({
          data,
          descricao: v(m.descricao),
          valor: m.inverter_sinal && m.valor ? moeda(d(valor).neg()) : valor,
          parcela: v(m.parcela),
        });
      }
      const linhas = paraLinhas(m.tipo, brutas).map((l, i) => {
        const p = /^(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})$/i.exec(brutas[i]?.parcela ?? "");
        const atual = Number(p?.[1]);
        const total = Number(p?.[2]);
        return p && atual >= 1 && total >= 2 && atual <= total
          ? { ...l, parcela: { atual, total } }
          : l;
      });
      return extrato("csv-mapeado", m.tipo, "", linhas, avisos, {
        banco: null,
        assinatura: m.assinatura,
      });
    },
  };
}
