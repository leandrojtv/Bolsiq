import { d, moeda } from "../decimal.js";
import { somarMeses } from "../parcelamento.js";
import {
  ErroDeLeitura,
  type ExtratoLido,
  type LeitorDeExtrato,
  type LinhaLida,
} from "./tipos.js";

/**
 * Fatura do cartao C6 em CSV, o unico formato que o banco exporta:
 *
 *   Data de Compra;Nome no Cartão;Final do Cartão;Categoria;Descrição;Parcela;
 *   Valor (em US$);Cotação (em R$);Valor (em R$)
 *
 * Data dd/mm/aaaa da compra original (a parcela 6/7 traz a data de maio),
 * valor com ponto decimal, pagamento negativo, IOF de compra internacional
 * numa linha propria com o mesmo nome, e varios finais de cartao (adicional,
 * virtual) na mesma fatura.
 */

const semAcento = (t: string) =>
  t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

const COLUNAS = {
  data: "data de compra",
  final: "final do cartao",
  categoria: "categoria",
  descricao: "descricao",
  parcela: "parcela",
  usd: "valor (em us$)",
  real: "valor (em r$)",
} as const;

/** Separa por `;` respeitando aspas ("Inclusao de Pagamento    "). */
function campos(linha: string): string[] {
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
    } else if (c === ";" && !aspas) {
      saida.push(atual);
      atual = "";
    } else atual += c;
  }
  saida.push(atual);
  return saida.map((x) => x.trim());
}

function cabecalho(texto: string): string[] | null {
  const primeira = texto.split(/\r?\n/, 1)[0] ?? "";
  const nomes = campos(primeira).map(semAcento);
  return Object.values(COLUNAS).every((c) => nomes.includes(c)) ? nomes : null;
}

/** dd/mm/aaaa -> aaaa-mm-dd. */
export function dataC6(t: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t.trim());
  if (!m) return null;
  const [, dia, mes, ano] = m;
  const iso = `${ano}-${mes}-${dia}`;
  const x = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(x.getTime()) || x.toISOString().slice(0, 10) !== iso ? null : iso;
}

/** "155.71", "-6661.61"; aceita virgula decimal se o banco mudar o formato. */
export function valorC6(t: string): string | null {
  let s = t.trim().replace(/\s/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return moeda(d(s));
}

function parcelaC6(t: string): { atual: number; total: number } | null | undefined {
  if (/^unica$/.test(semAcento(t))) return null;
  const m = /^(\d{1,2})\s*\/\s*(\d{1,2})$/.exec(t.trim());
  if (!m) return undefined;
  const atual = Number(m[1]);
  const total = Number(m[2]);
  return atual >= 1 && total >= 2 && atual <= total ? { atual, total } : undefined;
}

/**
 * Categoria do C6 (rotulo da bandeira) -> categoria padrao do Bolsiq. Rotulo
 * vago demais ("Empresa para empresa", "Servicos Profissionais", "Eletrico")
 * fica sem sugestao.
 */
const CATEGORIAS: [RegExp, string][] = [
  [/medic|odonto|hospital|farmac|drogar|saude|otica/, "Saúde"],
  [/supermercad|mercearia|padaria|conveniencia|hortifruti|acougue/, "Mercado"],
  [
    /restaurante|\bbar(es)?\b|lanchonete|fast food|alimentacao|delivery/,
    "Restaurantes e delivery",
  ],
  [/automotivo|combustiv|posto|gasolina|estacionamento|pedagio|transporte/, "Transporte"],
  [/t&e|hote|aere|viage|turismo|aluguel de carro/, "Viagem"],
  [/educa|escola|livraria/, "Educação"],
  [/telecomunica|utilidade|energia|\bagua\b|\bgas\b/, "Contas da casa"],
  [/entretenimento|\barte\b|artesanato|passatempo|lazer|cinema|esporte/, "Lazer"],
  [/vestuario|departamento|especialidade varejo|mobiliario|eletronico|varejo/, "Compras"],
  [/servicos pessoais|beleza|salao|cosmetic/, "Cuidados pessoais"],
  [/governo|imposto|tributo/, "Impostos"],
  [/\bpet|veterinar/, "Pets"],
];

export function categoriaDoC6(categoria: string): string | null {
  const c = semAcento(categoria);
  if (!c || c === "-") return null;
  return CATEGORIAS.find(([re]) => re.test(c))?.[1] ?? null;
}

interface Bruta {
  data: string;
  final: string;
  categoria: string;
  descricao: string;
  parcela: { atual: number; total: number } | null | undefined;
  usd: string;
  valor: string;
}

export const leitorCsvC6: LeitorDeExtrato = {
  formato: "csv-c6",
  reconhece: (texto) => cabecalho(texto) !== null,
  ler(texto, nome) {
    const nomes = cabecalho(texto);
    if (!nomes) throw new ErroDeLeitura("CSV sem o cabeçalho da fatura do C6");
    const col = Object.fromEntries(
      Object.entries(COLUNAS).map(([k, v]) => [k, nomes.indexOf(v)]),
    ) as Record<keyof typeof COLUNAS, number>;
    const avisos: string[] = [];
    const brutas: Bruta[] = [];
    const corpo = texto.split(/\r?\n/).slice(1);
    for (const [i, linha] of corpo.entries()) {
      if (!linha.trim()) continue;
      const c = campos(linha);
      const data = dataC6(c[col.data] ?? "");
      const valor = valorC6(c[col.real] ?? "");
      if (!data || !valor || d(valor).isZero()) {
        avisos.push(`linha ${i + 2} ignorada: data ou valor ilegível`);
        continue;
      }
      const parcela = parcelaC6(c[col.parcela] ?? "");
      if (parcela === undefined)
        avisos.push(`linha ${i + 2}: parcela "${c[col.parcela]}" não reconhecida`);
      brutas.push({
        data,
        final: (c[col.final] ?? "").replace(/\D/g, ""),
        categoria: c[col.categoria] ?? "",
        descricao:
          (c[col.descricao] ?? "").replace(/\s+/g, " ").trim() || "(sem descrição)",
        parcela: parcela ?? null,
        usd: valorC6(c[col.usd] ?? "") ?? "0.00",
        valor,
      });
    }

    // IOF: linha em reais com o mesmo nome e data de uma compra em dolar.
    const internacionais = new Map<string, number>();
    for (const b of brutas)
      if (!d(b.usd).isZero()) {
        const k = `${b.data}|${b.descricao}`;
        internacionais.set(k, (internacionais.get(k) ?? 0) + 1);
      }
    const ehIof = (b: Bruta) => {
      const k = `${b.data}|${b.descricao}`;
      const n = internacionais.get(k) ?? 0;
      if (!d(b.usd).isZero() || n === 0 || d(b.valor).isNegative()) return false;
      internacionais.set(k, n - 1);
      return true;
    };

    const venc = /(\d{4})-(\d{2})-(\d{2})/.exec(nome);
    const vencimento =
      venc && dataC6(`${venc[3]}/${venc[2]}/${venc[1]}`) ? venc[0] : null;
    // Nenhuma linha da fatura e posterior ao vencimento; sem ele, a ultima data.
    const limite =
      vencimento ??
      brutas
        .map((b) => b.data)
        .sort()
        .at(-1) ??
      "";
    /**
     * A parcela n/N vai para o mes dela: a data e a da compra original. Se
     * passar da fatura, o banco ja mandou a data da cobranca (anuidade 5/12
     * de 28/10) e ela fica como esta.
     */
    const dataDaParcela = (b: Bruta) => {
      if (!b.parcela) return b.data;
      const movida = somarMeses(b.data, b.parcela.atual - 1);
      return movida <= limite ? movida : b.data;
    };

    const linhas: LinhaLida[] = brutas.map((b, indice) => {
      const iof = ehIof(b);
      const negativo = d(b.valor).isNegative();
      return {
        indice,
        fitid: null,
        trntype: null,
        data: dataDaParcela(b),
        valor: moeda(d(b.valor).abs()),
        sentido: negativo ? "credito" : "debito",
        descricao: iof ? `IOF ${b.descricao}` : b.descricao,
        parcela: b.parcela,
        categoria_sugerida: iof
          ? "IOF"
          : /anuidade/i.test(b.descricao)
            ? "Tarifas bancárias"
            : negativo
              ? null
              : categoriaDoC6(b.categoria),
      };
    });

    const finais = [...new Set(brutas.map((b) => b.final).filter(Boolean))].sort();
    if (finais.length > 1)
      avisos.push(
        `${finais.length} finais de cartão nesta fatura (${finais.join(", ")}): tudo entra no cartão escolhido`,
      );
    const datas = linhas.map((l) => l.data).sort();
    return {
      formato: "csv-c6",
      tipo: "cartao",
      banco: "C6",
      conta: finais.join(",") || null,
      inicio: datas[0] ?? null,
      fim: datas.at(-1) ?? null,
      saldo: null,
      linhas,
      avisos,
      vencimento,
    } satisfies ExtratoLido;
  },
};
