export {
  extrairNumeros,
  folhasNumericas,
  limparTexto,
  numeroPresente,
  numerosInventados,
  type Encontrado,
} from "../src/numeros.js";

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
