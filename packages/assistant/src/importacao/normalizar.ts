/**
 * Correcao deterministica do que o modelo (ou a planilha) escreve, antes de
 * validar. Nada aqui inventa valor: so reescreve o que veio no formato que os
 * validadores leem. Numero "R$ 1.234,56" vira "1234.56", data "15 mai 2045" vira
 * "2045-05-15", "-" vira vazio, classe por sinonimo.
 */

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Traco, travessao, "n/a" e afins: campo vazio. */
const VAZIOS = /^(?:-+|–|—|n\/?a|nd|n\/d|null|none|--?)$/i;

export const vazio = (v: string): boolean => VAZIOS.test(v.trim()) || v.trim() === "";

/**
 * Numero em qualquer formato brasileiro ou ingles: "R$ 1.234,56", "1,234.56",
 * "(1.234,56)" (negativo), "12,5%". Devolve ponto decimal, sem milhar. Texto que
 * nao e numero volta como veio, para o validador apontar.
 */
export function numero(v: string): string {
  const t = v.trim();
  if (vazio(t)) return "";
  let s = t.replace(/^R\$\s*|US\$\s*|\s+|%$/gi, "").replace(/%/g, "");
  const negativo = /^\(.*\)$/.test(s) || /^-/.test(s);
  s = s.replace(/^\(|\)$/g, "").replace(/^[-+]/, "");
  if (!/^[\d.,]+$/.test(s)) return t;
  const ponto = s.lastIndexOf(".");
  const virgula = s.lastIndexOf(",");
  if (ponto !== -1 && virgula !== -1)
    s = virgula > ponto ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  // Uma virgula e decimal (pt-BR); mais de uma, milhar (en). Um ponto e decimal
  // (o formato pedido ao modelo e o da planilha); mais de um, milhar (pt-BR).
  else if (virgula !== -1)
    s = (s.match(/,/g)?.length ?? 0) > 1 ? s.replace(/,/g, "") : s.replace(",", ".");
  else if ((s.match(/\./g)?.length ?? 0) > 1) s = s.replace(/\./g, "");
  return `${negativo ? "-" : ""}${s}`;
}

/** Percentual em fracao: "110%" e "110" viram 1.10 em `pct_indexador`; "14,69%" e 0.1469 em taxa. */
export function fracao(v: string, limite: number): string {
  const tinhaPorcento = v.includes("%");
  const n = numero(v);
  if (n === "" || Number.isNaN(Number(n))) return n;
  const x = Number(n);
  // Ja em fracao (0.1469, 1.10) fica; percentual (14.69, 110) divide por 100.
  return tinhaPorcento || x > limite ? String(Number((x / 100).toFixed(8))) : n;
}

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
  feb: "02",
  apr: "04",
  may: "05",
  aug: "08",
  sep: "09",
  oct: "10",
  dec: "12",
};

const doisDigitos = (n: string) => n.padStart(2, "0");
const ano = (a: string) => (a.length === 2 ? `20${a}` : a);

/** DD/MM/AAAA, DD-MM-AA, AAAA-MM-DD, "15 mai 2045", "15 de maio de 2045", "mai/2045" (dia 1). */
export function data(v: string): string {
  const t = semAcento(v.trim());
  if (vazio(t)) return "";
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return `${m[1]}-${doisDigitos(m[2] ?? "")}-${doisDigitos(m[3] ?? "")}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(t);
  if (m)
    return `${ano(m[3] ?? "")}-${doisDigitos(m[2] ?? "")}-${doisDigitos(m[1] ?? "")}`;
  m = /^(\d{1,2})\s*(?:de\s+)?([a-z]{3})[a-z]*\.?\s*(?:de\s+)?(\d{2,4})$/.exec(t);
  if (m && MESES[m[2] ?? ""])
    return `${ano(m[3] ?? "")}-${MESES[m[2] ?? ""]}-${doisDigitos(m[1] ?? "")}`;
  m = /^([a-z]{3})[a-z]*[/ .-]+(\d{2,4})$/.exec(t);
  if (m && MESES[m[1] ?? ""]) return `${ano(m[2] ?? "")}-${MESES[m[1] ?? ""]}-01`;
  return v.trim();
}

export const ticker = (v: string): string => v.toUpperCase().replace(/\s+/g, "");

/** Classe pelos nomes que os extratos usam. Ja canonica, fica. */
export function classe(v: string, ativo = ""): string {
  const c = semAcento(v.trim()).replace(/\s+/g, "_");
  const canonicas = [
    "acao",
    "fii",
    "bdr",
    "etf",
    "renda_fixa",
    "titulo_publico",
    "fundo",
    "previdencia",
    "coe",
    "estruturado",
    "cripto",
    "outro",
  ];
  if (canonicas.includes(c)) return c;
  const texto = `${semAcento(v)} ${semAcento(ativo)}`;
  const regras: [RegExp, string][] = [
    [
      /\b(cdb|lci|lca|lc|rdb|cri|cra|debenture|debentures|lf|lig|renda fixa|caixinha)\b/,
      "renda_fixa",
    ],
    [
      /\b(tesouro|lft|ntn-?[bfc]?|ltn|titulos? publicos?|selic \d{4}|ipca\+ \d{4})\b/,
      "titulo_publico",
    ],
    [/\b(pgbl|vgbl|previdencia)\b/, "previdencia"],
    [/\b(fidc|fic|fim|fia|multimercado|fundos? de investimento|fundo)\b/, "fundo"],
    [/\b(fii|fundos? imobiliarios?)\b/, "fii"],
    [/\b(coe)\b/, "coe"],
    [/\b(etf)\b/, "etf"],
    [/\b(bdr)\b/, "bdr"],
    [/\b(acoes|acao|renda variavel)\b/, "acao"],
    [/\b(cripto|bitcoin|btc|eth)\b/, "cripto"],
    [/\b(estruturad[ao]s?|swap|termo|opcoes)\b/, "estruturado"],
  ];
  return regras.find(([re]) => re.test(texto))?.[1] ?? v.trim().toLowerCase();
}

export function indexador(v: string): string {
  const t = semAcento(v.trim());
  if (vazio(t)) return "";
  if (/cdi|di\b/.test(t)) return "CDI";
  if (/selic/.test(t)) return "SELIC";
  if (/ipca/.test(t)) return "IPCA";
  if (/igp-?m/.test(t)) return "IGPM";
  if (/pre|prefixad/.test(t)) return "PRE";
  return v.trim().toUpperCase();
}

export function liquidez(v: string): string {
  const t = semAcento(v.trim());
  if (vazio(t)) return "";
  if (/^(s|sim|diaria|d\+0|d\+1|y|yes|true)$/.test(t)) return "S";
  if (/^(n|nao|no|false|no vencimento)$/.test(t)) return "N";
  return v.trim();
}

const NUMERICOS_DA_POSICAO = [
  "quantidade",
  "preco_unitario",
  "preco_medio",
  "valor_aplicado",
  "saldo_bruto",
  "ir",
  "iof",
  "saldo_liquido",
];
const DATAS_DA_POSICAO = ["data_posicao", "data_aplicacao", "vencimento"];

/** Uma linha de posicao como texto, no formato que `importarPosicaoBolsiq` le. */
export function normalizarPosicao(d: Record<string, string>): Record<string, string> {
  const r: Record<string, string> = {};
  for (const [k, v] of Object.entries(d)) r[k] = vazio(v) ? "" : v.trim();
  for (const c of NUMERICOS_DA_POSICAO) if (r[c] !== undefined) r[c] = numero(r[c]);
  for (const c of DATAS_DA_POSICAO) if (r[c] !== undefined) r[c] = data(r[c]);
  if (r.pct_indexador !== undefined) r.pct_indexador = fracao(r.pct_indexador, 5);
  if (r.taxa_aa !== undefined) r.taxa_aa = fracao(r.taxa_aa, 1);
  if (r.classe !== undefined) r.classe = classe(r.classe, r.ativo ?? "");
  if (r.indexador !== undefined) r.indexador = indexador(r.indexador);
  if (r.liquidez_diaria !== undefined) r.liquidez_diaria = liquidez(r.liquidez_diaria);
  if (r.cnpj) r.cnpj = r.cnpj.replace(/\D/g, "");
  if (r.codigo && ["acao", "fii", "bdr", "etf"].includes(r.classe ?? ""))
    r.codigo = ticker(r.codigo).replace(/^(.{4,11}\d{1,2})F$/, "$1");
  if (r.valorizacao) r.valorizacao = semAcento(r.valorizacao).replace(/\s+/g, "_");
  return r;
}

const TIPOS: Record<string, string> = {
  c: "compra",
  compra: "compra",
  credito: "compra",
  v: "venda",
  venda: "venda",
  debito: "venda",
};

/** Uma transacao como texto, no formato do CSV Bolsiq. */
export function normalizarTransacao(d: Record<string, string>): Record<string, string> {
  const r: Record<string, string> = {};
  for (const [k, v] of Object.entries(d)) r[k] = vazio(v) ? "" : v.trim();
  for (const c of ["quantidade", "preco", "taxas"])
    if (r[c] !== undefined) r[c] = numero(r[c]);
  if (r.data !== undefined) r.data = data(r.data);
  if (r.ticker !== undefined)
    r.ticker = ticker(r.ticker).replace(/^(.{4,11}\d{1,2})F$/, "$1");
  if (r.tipo !== undefined) r.tipo = TIPOS[semAcento(r.tipo)] ?? semAcento(r.tipo);
  return r;
}

/** Linha de total ou subtotal do documento: nao e posicao. */
export const PARECE_TOTAL =
  /^\s*(sub-?total|total(\s|$|:|geral|da|do|em|de)|patrim[oô]nio\s+(total|l[ií]quido)|saldo\s+total|valor\s+total)/i;
