import { shiftDecimal } from "./decimal.js";

/** Ordem de exercício da CVM. Só `ÚLTIMO` deve ser gravado. */
export const ORDEM_EXERC_VALIDA = "ÚLTIMO";

/**
 * Converte data da CVM para `YYYY-MM-DD`.
 *
 * Os arquivos usam `YYYY-MM-DD` na maioria dos campos, mas há colunas em
 * `DD/MM/YYYY`. Aceitar os dois evita um bug que só aparece em alguns
 * datasets.
 */
export function parseCvmDate(valor: string): string {
  const texto = valor.trim();

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;

  throw new Error(`data da CVM em formato inesperado: ${valor}`);
}

/**
 * Aplica a ESCALA_MOEDA da CVM.
 *
 * A coluna vale `UNIDADE` ou `MIL`. Ignorá-la erra toda demonstração por um
 * fator de mil — e o número continua plausível, que é o que torna o erro
 * perigoso.
 */
export function applyCvmScale(valor: string, escala: string): string {
  const normalizada = escala.trim().toUpperCase();

  switch (normalizada) {
    case "UNIDADE":
      return shiftDecimal(valor, 0);
    case "MIL":
      return shiftDecimal(valor, 3);
    default:
      throw new Error(`ESCALA_MOEDA desconhecida: ${escala}`);
  }
}

/** Remove pontuação do CNPJ e valida o tamanho. */
export function normalizeCnpj(valor: string): string {
  const digitos = valor.replace(/\D/g, "");
  if (digitos.length !== 14) {
    throw new Error(`CNPJ com ${digitos.length} dígitos, esperado 14: ${valor}`);
  }
  return digitos;
}

export interface LinhaDemonstrativo {
  cvmCode: string;
  referenceDate: string;
  accountCode: string;
  isConsolidated: boolean;
  version: number;
  ordemExerc: string;
}

/**
 * Aplica as duas regras que definem se o número da CVM está certo:
 * `ORDEM_EXERC = 'ÚLTIMO'` e a maior `VERSAO` de cada conta.
 *
 * Sem o filtro de ordem, cada exercício é gravado duas vezes — uma delas com o
 * valor do ano anterior. Sem o filtro de versão, cada reapresentação soma de
 * novo, multiplicando a receita da empresa.
 *
 * Ver docs/services/market-data-sources.md.
 */
export function pickLatestVersion<T extends LinhaDemonstrativo>(linhas: T[]): T[] {
  const maiorVersao = new Map<string, number>();

  for (const linha of linhas) {
    if (linha.ordemExerc !== ORDEM_EXERC_VALIDA) continue;
    const chave = chaveDaConta(linha);
    const atual = maiorVersao.get(chave);
    if (atual === undefined || linha.version > atual) {
      maiorVersao.set(chave, linha.version);
    }
  }

  return linhas.filter(
    (linha) =>
      linha.ordemExerc === ORDEM_EXERC_VALIDA &&
      maiorVersao.get(chaveDaConta(linha)) === linha.version,
  );
}

function chaveDaConta(linha: LinhaDemonstrativo): string {
  return [
    linha.cvmCode,
    linha.referenceDate,
    linha.accountCode,
    String(linha.isConsolidated),
  ].join("\u0000");
}
