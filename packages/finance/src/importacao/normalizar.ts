/**
 * Descricao de extrato para comparar e categorizar: o mesmo estabelecimento
 * tem de dar o mesmo texto em qualquer banco, maquininha, cidade ou parcela.
 */

const UFS =
  "AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO";

const CIDADES = [
  "SAO PAULO",
  "RIO DE JANEIRO",
  "BELO HORIZONTE",
  "BRASILIA",
  "CURITIBA",
  "PORTO ALEGRE",
  "SALVADOR",
  "FORTALEZA",
  "RECIFE",
  "MANAUS",
  "BELEM",
  "GOIANIA",
  "CAMPINAS",
  "FLORIANOPOLIS",
  "VITORIA",
  "NATAL",
  "JOAO PESSOA",
  "MACEIO",
  "TERESINA",
  "CAMPO GRANDE",
  "CUIABA",
  "ARACAJU",
  "SAO LUIS",
  "PORTO VELHO",
  "OSASCO",
  "SANTOS",
  "GUARULHOS",
  "SAO BERNARDO DO CAMPO",
  "SAO BERNARDO DO C",
  "SANTO ANDRE",
  "NITEROI",
  "BARUERI",
  "JUNDIAI",
  "RIBEIRAO PRETO",
  "SOROCABA",
  "LONDRINA",
  "JOINVILLE",
  "UBERLANDIA",
  "CONTAGEM",
  "SAO JOSE DOS CAMPOS",
];

const PARCELA = [
  /\bPARC(?:ELA)?\.?\s*(\d{1,2})\s*(?:\/|DE)\s*(\d{1,2})\b/,
  /\b(\d{1,2})\s+DE\s+(\d{1,2})\b/,
  /(?:^|\s)(\d{1,2})\/(\d{1,2})\s*$/,
];

const semAcento = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();

/** "PARC 03/10", "3 DE 10" ou "03/10" no fim. O plano de parcelas vem depois. */
export function detectarParcela(
  descricao: string,
): { atual: number; total: number } | null {
  const t = semAcento(descricao);
  for (const re of PARCELA) {
    const m = re.exec(t);
    if (!m) continue;
    const atual = Number(m[1]);
    const total = Number(m[2]);
    if (atual >= 1 && total >= 2 && atual <= total) return { atual, total };
  }
  return null;
}

const FIM_PAIS = /[\s\-/,]+(BR|BRA|BRASIL)$/;
const FIM_UF = new RegExp(`[\\s\\-/,]+(${UFS})$`);
const FIM_CIDADE = new RegExp(`[\\s\\-/,]+(${CIDADES.join("|")})$`);

/**
 * Maiusculas, sem acento, sem prefixo de adquirente (PAG*, MP*, IFD*, PG *,
 * EBANX*...), sem parcela, sem numero de autorizacao e sem cidade/UF no fim.
 */
export function normalizarDeExtrato(descricao: string): string {
  let t = semAcento(descricao).replace(/\s+/g, " ").trim();
  for (const re of PARCELA) t = t.replace(re, " ").trim();
  // Prefixo de adquirente: token curto seguido de "*", as vezes repetido.
  for (let i = 0; i < 3; i++) t = t.replace(/^[A-Z0-9.]{1,12}\s?\*\s*/, "");
  t = t
    .replace(/\b(AUT|AUTORIZ\w*|NSU|DOC|CV|COD|TRANS)\s*[:.]?\s*\d+/g, " ")
    .replace(/[*•\dX]{3}\.[*•\dX]{3}\.[*•\dX]{3}-[*•\dX]{2}/g, " ")
    .replace(/\b\d{6,}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  let antes = "";
  while (antes !== t) {
    antes = t;
    for (const re of [FIM_PAIS, FIM_UF, FIM_CIDADE]) {
      const sem = t.replace(re, "").trim();
      if (sem.length >= 2) t = sem;
    }
  }
  t = t
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t || semAcento(descricao).trim();
}

/**
 * Parecido o bastante para "possivel duplicata": um contem o outro ou dividem
 * a maior parte das palavras.
 */
export function descricoesParecidas(a: string, b: string): boolean {
  const x = normalizarDeExtrato(a);
  const y = normalizarDeExtrato(b);
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  const px = new Set(x.split(" ").filter((p) => p.length > 2));
  const py = y.split(" ").filter((p) => p.length > 2);
  if (px.size === 0 || py.length === 0) return false;
  const comuns = py.filter((p) => px.has(p)).length;
  return comuns / Math.min(px.size, py.length) >= 0.6;
}
