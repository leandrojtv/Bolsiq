/** Numeros da resposta contra os numeros que as ferramentas devolveram. */

/** Tira o que parece numero e nao e valor: ticker, data, id, link, lista. */
export function limparTexto(texto: string): string {
  return texto
    .replace(/\]\([^)]*\)/g, "]")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, " ")
    .replace(/\b[A-Z]{4}\d{1,2}\b/g, " ")
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, " ")
    .replace(/\b\d{1,2}\/\d{4}\b/g, " ")
    .replace(/\b\d{1,2}\/\d{1,2}\b/g, " ")
    .replace(/\b\d{1,2}º? de [a-zç]+( de \d{4})?/gi, " ")
    .replace(/\b\d{4}-\d{2}(-\d{2})?(T[\d:.]+Z?)?\b/g, " ")
    .replace(/^\s*\d+[.)]\s/gm, " ");
}

export interface Encontrado {
  valor: number;
  casas: number;
}

/** Numeros em pt-BR ou com ponto decimal, com as casas com que foram escritos. */
export function extrairNumeros(texto: string): Encontrado[] {
  const saida: Encontrado[] = [];
  for (const m of limparTexto(texto).matchAll(/-?\d[\d.,]*\d|\d/g)) {
    const bruto = m[0];
    const virgula = bruto.lastIndexOf(",");
    const ponto = bruto.lastIndexOf(".");
    let normal: string;
    if (virgula > ponto) normal = bruto.replace(/\./g, "").replace(",", ".");
    else if (ponto > -1 && (bruto.match(/\./g) ?? []).length > 1)
      normal = bruto.replace(/\./g, "");
    else if (ponto > -1 && virgula === -1 && /^\d{1,3}\.\d{3}$/.test(bruto))
      normal = bruto.replace(".", "");
    else normal = bruto.replace(/,/g, "");
    const valor = Number(normal);
    if (!Number.isNaN(valor))
      saida.push({ valor, casas: normal.split(".")[1]?.length ?? 0 });
  }
  return saida;
}

const bate = (e: Encontrado, alvo: number) => {
  const passo = 10 ** -e.casas;
  // Arredondado para as casas escritas, com folga de meio passo mais ruido.
  return Math.abs(Math.abs(alvo) - Math.abs(e.valor)) <= passo / 2 + 1e-9;
};

/** Valor esperado aparece no texto, nas casas que o modelo escolheu. */
export function numeroPresente(alvo: number, achados: Encontrado[]): boolean {
  return achados.some((e) => bate(e, alvo) && (e.casas > 0 || alvo === Math.round(alvo)));
}

/** Todas as folhas numericas de um valor JSON, tambem as strings decimais. */
export function folhasNumericas(v: unknown, saida: number[] = []): number[] {
  if (typeof v === "number") saida.push(v);
  else if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) saida.push(Number(v));
  else if (Array.isArray(v)) for (const x of v) folhasNumericas(x, saida);
  else if (v && typeof v === "object")
    for (const x of Object.values(v)) folhasNumericas(x, saida);
  return saida;
}

/**
 * Numeros da resposta sem origem nas ferramentas nem na pergunta. Fracao pode
 * aparecer como percentual, e valor grande pode aparecer em bilhoes ou milhoes.
 */
export function numerosInventados(
  resposta: string,
  saidas: unknown[],
  pergunta: string,
): number[] {
  const folhas = folhasNumericas(saidas);
  const aceitos = folhas.flatMap((n) => [n, n * 100, n / 1e9, n / 1e6, n / 1e3]);
  const daPergunta = extrairNumeros(pergunta).map((e) => e.valor);
  return (
    extrairNumeros(resposta)
      .filter((e) => !daPergunta.includes(Math.abs(e.valor)))
      // Inteiros de 1 a 12 sao contagem de texto ("3 ativos", "12 meses").
      .filter((e) => !(e.casas === 0 && Math.abs(e.valor) <= 12))
      .filter((e) => !aceitos.some((a) => bate(e, a)))
      .map((e) => e.valor)
  );
}

export const tickersNoTexto = (texto: string): string[] => [
  ...new Set(texto.match(/\b[A-Z]{4}\d{1,2}\b/g) ?? []),
];

/** Parametros esperados contidos nos usados; lista compara sem ordem. */
export function parametrosBatem(
  esperados: Record<string, unknown>,
  usados: Record<string, unknown>,
): boolean {
  return Object.entries(esperados).every(([k, v]) => {
    const u = usados[k];
    if (Array.isArray(v) && Array.isArray(u))
      return v.length === u.length && v.every((x) => u.includes(x));
    return u === v;
  });
}
