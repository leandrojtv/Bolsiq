import { shiftDecimal } from "./decimal.js";

/**
 * Decodificador do COTAHIST da B3 — arquivo de largura fixa, 245 bytes por
 * registro.
 *
 * As posições abaixo seguem o layout conhecido e **precisam ser conferidas
 * contra o documento publicado pela B3** antes de uso em produção. Ver
 * docs/services/market-data-sources.md.
 *
 * Atenção à licença: os Termos de Uso da B3 vedam coleta automatizada e
 * redistribuição do COTAHIST sem contrato. Este decodificador existe para ler
 * arquivo já obtido; a decisão sobre obtê-lo automaticamente é de negócio e
 * está registrada em docs/services/market-data-sources.md.
 */

/** Registro de cotação. `00` é header e `99` é trailer. */
export const TIPREG_COTACAO = "01";

/** Lote padrão. */
export const CODBDI_LOTE_PADRAO = "02";

/** Mercado a vista. */
export const TPMERC_A_VISTA = "010";

export const COTAHIST_LINE_LENGTH = 245;

export interface CotahistRecord {
  date: string;
  codbdi: string;
  ticker: string;
  tpmerc: string;
  shortName: string;
  specification: string;
  open: string;
  high: string;
  low: string;
  average: string;
  close: string;
  trades: number;
  volume: bigint;
  financialVolume: string;
  quoteFactor: number;
  isin: string;
}

/** Posições em bytes, 1-based e inclusivas, como a B3 documenta. */
const CAMPOS = {
  tipreg: [1, 2],
  data: [3, 10],
  codbdi: [11, 12],
  codneg: [13, 24],
  tpmerc: [25, 27],
  nomres: [28, 39],
  especi: [40, 49],
  preabe: [57, 69],
  premax: [70, 82],
  premin: [83, 95],
  premed: [96, 108],
  preult: [109, 121],
  totneg: [148, 152],
  quatot: [153, 170],
  voltot: [171, 188],
  fatcot: [211, 217],
  codisi: [231, 242],
} as const satisfies Record<string, readonly [number, number]>;

function campo(linha: string, [inicio, fim]: readonly [number, number]): string {
  return linha.slice(inicio - 1, fim).trim();
}

/**
 * Converte um campo de preço do COTAHIST.
 *
 * Duas conversões, nesta ordem:
 *
 * 1. **Centavos.** Todo campo `PRE*` tem duas decimais implícitas:
 *    `0000000001234` é `12,34`.
 * 2. **Fator de cotação.** `FATCOT` diz a quantos papéis o preço se refere.
 *    Com `FATCOT = 1000`, o preço é de um lote de mil, e o unitário é mil
 *    vezes menor. Ignorar isso erra o preço por mil em papéis antigos.
 */
export function parseCotahistPrice(bruto: string, fatcot: number): string {
  const digitos = bruto.trim();
  if (!/^\d+$/.test(digitos)) {
    throw new Error(`campo de preço não numérico: "${bruto}"`);
  }
  if (fatcot <= 0) {
    throw new Error(`fator de cotação inválido: ${fatcot}`);
  }

  const emReais = shiftDecimal(digitos, -2);

  // FATCOT é sempre potência de dez (1 ou 1000 na prática), então a divisão é
  // deslocamento de ponto e permanece exata.
  const expoente = Math.log10(fatcot);
  if (!Number.isInteger(expoente)) {
    throw new Error(`fator de cotação não é potência de dez: ${fatcot}`);
  }

  return shiftDecimal(emReais, -expoente);
}

/** `true` quando o registro é lote padrão do mercado a vista. */
export function isLotePadraoAVista(codbdi: string, tpmerc: string): boolean {
  return codbdi === CODBDI_LOTE_PADRAO && tpmerc === TPMERC_A_VISTA;
}

/**
 * Decodifica uma linha de cotação.
 *
 * Devolve `null` para header, trailer e linha vazia — são registros válidos do
 * arquivo que não são cotação.
 */
export function parseCotahistLine(linha: string): CotahistRecord | null {
  if (linha.trim() === "") return null;

  if (linha.length < COTAHIST_LINE_LENGTH) {
    throw new Error(`linha com ${linha.length} bytes, esperado ${COTAHIST_LINE_LENGTH}`);
  }

  if (campo(linha, CAMPOS.tipreg) !== TIPREG_COTACAO) return null;

  const fatcot = Number(campo(linha, CAMPOS.fatcot) || "1");
  const data = campo(linha, CAMPOS.data);
  const achado = /^(\d{4})(\d{2})(\d{2})$/.exec(data);
  if (!achado) {
    throw new Error(`data do COTAHIST em formato inesperado: ${data}`);
  }

  return {
    date: `${achado[1]}-${achado[2]}-${achado[3]}`,
    codbdi: campo(linha, CAMPOS.codbdi),
    ticker: campo(linha, CAMPOS.codneg),
    tpmerc: campo(linha, CAMPOS.tpmerc),
    shortName: campo(linha, CAMPOS.nomres),
    specification: campo(linha, CAMPOS.especi),
    open: parseCotahistPrice(campo(linha, CAMPOS.preabe), fatcot),
    high: parseCotahistPrice(campo(linha, CAMPOS.premax), fatcot),
    low: parseCotahistPrice(campo(linha, CAMPOS.premin), fatcot),
    average: parseCotahistPrice(campo(linha, CAMPOS.premed), fatcot),
    close: parseCotahistPrice(campo(linha, CAMPOS.preult), fatcot),
    trades: Number(campo(linha, CAMPOS.totneg)),
    volume: BigInt(campo(linha, CAMPOS.quatot)),
    // VOLTOT também tem duas decimais implícitas, mas não sofre FATCOT:
    // é o valor financeiro negociado, não um preço unitário.
    financialVolume: shiftDecimal(campo(linha, CAMPOS.voltot), -2),
    quoteFactor: fatcot,
    isin: campo(linha, CAMPOS.codisi),
  };
}
