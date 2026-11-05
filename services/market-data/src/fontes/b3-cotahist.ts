import {
  classeDaEspecificacao,
  classificarCotahist,
  parseCotahistLine,
  type CotahistRecord,
  type TipoDeAtivo,
} from "@bolsiq/domain";
import { baixarParaArquivo, type ArquivoBaixado, type Buscar } from "./http.js";
import { linhasDoZip } from "./zip.js";

export const COTAHIST_SOURCE = "b3-cotahist";
export const COTAHIST_LICENSE = "proprietaria B3, sem direito de redistribuicao";

/** Nome do arquivo diario, que tambem e o `source_ref` no `fetch_log`. */
export function refDoDia(data: string): string {
  const [a, m, d] = data.split("-");
  return `COTAHIST_D${d}${m}${a}.ZIP`;
}

export interface RegistroDoUniverso extends CotahistRecord {
  kind: TipoDeAtivo;
  classe: string;
}

export interface ArquivoCotahist extends ArquivoBaixado {
  sourceRef: string;
  registros: () => AsyncGenerator<RegistroDoUniverso>;
}

/**
 * COTAHIST da B3: arquivo anual (carga historica) e diario.
 *
 * Atencao a licenca: os Termos de Uso da B3 vedam coleta automatizada e
 * redistribuicao. O adapter existe porque o produto o pede; a decisao e de
 * negocio e esta registrada em docs/services/market-data-sources.md.
 */
export class B3CotahistAdapter {
  constructor(
    private readonly buscar: Buscar,
    private readonly base = "https://bvmf.bmfbovespa.com.br/InstDados/SerHist",
  ) {}

  ano(ano: number): Promise<ArquivoCotahist | null> {
    return this.baixar(`COTAHIST_A${ano}.ZIP`);
  }

  /**
   * `null` quando a B3 responde 404, que e feriado ou arquivo que ainda nao
   * saiu: a fonte nao distingue os dois casos.
   */
  dia(data: string): Promise<ArquivoCotahist | null> {
    return this.baixar(refDoDia(data));
  }

  private async baixar(nome: string): Promise<ArquivoCotahist | null> {
    const arquivo = await baixarParaArquivo(this.buscar, `${this.base}/${nome}`);
    if (!arquivo) return null;
    return { ...arquivo, sourceRef: nome, registros: () => lerUniverso(arquivo.caminho) };
  }
}

async function* lerUniverso(caminho: string): AsyncGenerator<RegistroDoUniverso> {
  for await (const { linha } of linhasDoZip(caminho)) {
    // Filtro barato antes do parse: so registro de cotacao (01) a vista.
    if (!linha.startsWith("01") || linha.slice(24, 27) !== "010") continue;
    const kind = classificarCotahist(linha.slice(10, 12), linha.slice(24, 27));
    if (!kind) continue;
    const r = parseCotahistLine(linha);
    if (!r) continue;
    yield { ...r, kind, classe: classeDaEspecificacao(r.specification) };
  }
}
