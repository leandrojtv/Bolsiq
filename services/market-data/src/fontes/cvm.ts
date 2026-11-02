import {
  applyCvmScale,
  leitorDeColunas,
  normalizeCnpj,
  ORDEM_EXERC_VALIDA,
} from "@bolsiq/domain";
import { BolsiqError } from "@bolsiq/contracts";
import { baixarParaArquivo, type ArquivoBaixado, type Buscar } from "./http.js";
import { linhasDoZip } from "./zip.js";

export const CVM_LICENSE = "ODbL-1.0";
const BASE = "https://dados.cvm.gov.br/dados/CIA_ABERTA";
const BASE_FI = "https://dados.cvm.gov.br/dados/FI";

export interface ClasseDeFundo {
  cnpj: string;
  name: string;
  classType: string | null;
  classification: string | null;
  anbimaClass: string | null;
  status: string | null;
  aum: string | null;
  aumDate: string | null;
}

export interface CotaDiaria {
  cnpj: string;
  date: string;
  nav: string;
  aum: string;
  inflows: string | null;
  outflows: string | null;
  holders: number | null;
  totalPortfolio: string | null;
}

export interface ArquivoDeCotas extends ArquivoBaixado {
  sourceRef: string;
  cotas: () => AsyncGenerator<CotaDiaria>;
  /** Linhas descartadas por valor fora da escala (ver `cabeNoNumeric`). */
  descartadas: () => number;
}

/**
 * numeric(20,6) guarda ate 10^14. O informe diario tem linhas com cota ou
 * patrimonio acima disso (erro de escala da fonte: patrimonio de quatrilhoes).
 * Gravar exigiria afrouxar a coluna por causa de dado errado; a linha e
 * descartada e contada.
 */
export function cabeNoNumeric(...valores: (string | null)[]): boolean {
  return valores.every((v) => v === null || Math.abs(Number(v)) < 1e14);
}

export interface Companhia {
  cnpj: string;
  cvmCode: string;
  legalName: string;
  name: string;
  sector: string | null;
  status: string | null;
  ownershipType: string | null;
  registeredAt: string | null;
}

export interface ValorMobiliario {
  cnpj: string;
  ticker: string;
}

export interface LinhaDeDemonstrativo {
  cnpj: string;
  cvmCode: string;
  referenceDate: string;
  periodStart: string | null;
  periodEnd: string | null;
  statementType: string;
  isConsolidated: boolean;
  accountCode: string;
  accountLabel: string;
  amount: string;
  currency: string;
  version: number;
  sourceRef: string;
}

export interface ComposicaoDeCapital {
  cnpj: string;
  referenceDate: string;
  common: bigint;
  preferred: bigint;
  total: bigint;
  treasuryTotal: bigint;
  version: number;
}

export interface ArquivoDeDemonstrativos extends ArquivoBaixado {
  sourceRef: string;
  linhas: () => AsyncGenerator<LinhaDeDemonstrativo>;
  composicao: () => AsyncGenerator<ComposicaoDeCapital>;
}

/** CD_CVM com seis digitos, como no DFP. O cadastro traz sem zeros a esquerda. */
export function normalizarCodigoCvm(codigo: string): string {
  return codigo.trim().padStart(6, "0");
}

/**
 * Demonstrativos gravados. DMPL fica de fora: tem uma coluna de valor por
 * componente do patrimonio, o que quebra a chave por conta, e nenhum indicador
 * usa. DRA (resultado abrangente) tambem nao entra em indicador.
 */
const TIPO_POR_ARQUIVO: Record<string, string> = {
  BPA: "BPA",
  BPP: "BPP",
  DRE: "DRE",
  DFC_MI: "DFC",
  DFC_MD: "DFC",
  DVA: "DVA",
};

const ARQUIVO_DE_DEMONSTRATIVO = /_(BPA|BPP|DRE|DFC_MI|DFC_MD|DVA)_(con|ind)_\d{4}\.csv$/;

export class CvmAdapter {
  constructor(private readonly buscar: Buscar) {}

  async cadastro(): Promise<{ arquivo: ArquivoBaixado; companhias: Companhia[] }> {
    const res = await this.buscar(`${BASE}/CAD/DADOS/cad_cia_aberta.csv`, {
      signal: AbortSignal.timeout(120_000),
    }).catch((e: unknown) => {
      throw new BolsiqError("source_unavailable", "cadastro da CVM inalcancavel", {
        erro: String(e),
      });
    });
    if (!res.ok)
      throw new BolsiqError("source_unavailable", `CVM respondeu ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const texto = new TextDecoder("latin1").decode(bytes);
    const [cabecalho = "", ...linhas] = texto.split(/\r?\n/);
    const ler = leitorDeColunas(cabecalho);

    const companhias: Companhia[] = [];
    for (const linha of linhas) {
      if (linha.trim() === "") continue;
      const c = ler(linha);
      const cnpj = tentarCnpj(c("CNPJ_CIA"));
      if (!cnpj || !c("CD_CVM")) continue;
      companhias.push({
        cnpj,
        cvmCode: normalizarCodigoCvm(c("CD_CVM")),
        legalName: c("DENOM_SOCIAL"),
        name: c("DENOM_COMERC") || c("DENOM_SOCIAL"),
        sector: c("SETOR_ATIV") || null,
        status: c("SIT") || null,
        ownershipType: c("CONTROLE_ACIONARIO") || null,
        registeredAt: c("DT_REG") || null,
      });
    }

    const { createHash } = await import("node:crypto");
    return {
      arquivo: {
        caminho: "",
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
      companhias,
    };
  }

  /**
   * Ligacao ticker -> CNPJ, do FCA (formulario cadastral).
   *
   * O cadastro de companhias nao traz ticker; o FCA traz, na tabela de valores
   * mobiliarios. E a ponte que faltava entre o COTAHIST e o DFP.
   */
  async valoresMobiliarios(ano: number): Promise<ValorMobiliario[] | null> {
    const arquivo = await baixarParaArquivo(
      this.buscar,
      `${BASE}/DOC/FCA/DADOS/fca_cia_aberta_${ano}.zip`,
    );
    if (!arquivo) return null;

    const saida: ValorMobiliario[] = [];
    let ler: ReturnType<typeof leitorDeColunas> | null = null;
    for await (const { linha } of linhasDoZip(arquivo.caminho, (n) =>
      n.includes("_valor_mobiliario_"),
    )) {
      if (!ler) {
        ler = leitorDeColunas(linha);
        continue;
      }
      const c = ler(linha);
      const ticker = c("Codigo_Negociacao").toUpperCase();
      const cnpj = tentarCnpj(c("CNPJ_Companhia"));
      if (!cnpj || !/^[A-Z0-9]{4,12}$/.test(ticker)) continue;
      saida.push({ cnpj, ticker });
    }
    return saida;
  }

  /**
   * Classes de fundo do registro da CVM (RCVM 175). So `registro_classe.csv`:
   * e a classe que o informe diario identifica.
   */
  async cadastroDeFundos(): Promise<{
    arquivo: ArquivoBaixado;
    classes: () => AsyncGenerator<ClasseDeFundo>;
  } | null> {
    const arquivo = await baixarParaArquivo(
      this.buscar,
      `${BASE_FI}/CAD/DADOS/registro_fundo_classe.zip`,
    );
    if (!arquivo) return null;
    return { arquivo, classes: () => lerClasses(arquivo.caminho) };
  }

  /** Informe diario de um mes (AAAAMM). `null` se o mes ainda nao foi publicado. */
  async informeDiario(aaaamm: string): Promise<ArquivoDeCotas | null> {
    const nome = `inf_diario_fi_${aaaamm}.zip`;
    const arquivo = await baixarParaArquivo(
      this.buscar,
      `${BASE_FI}/DOC/INF_DIARIO/DADOS/${nome}`,
    );
    if (!arquivo) return null;
    const contagem = { descartadas: 0 };
    return {
      ...arquivo,
      sourceRef: nome,
      cotas: () => lerCotas(arquivo.caminho, contagem),
      descartadas: () => contagem.descartadas,
    };
  }

  /** DFP (anual) ou ITR (trimestral) de um ano. `null` se o ano nao existe. */
  async demonstracoes(
    tipo: "DFP" | "ITR",
    ano: number,
  ): Promise<ArquivoDeDemonstrativos | null> {
    const nome = `${tipo.toLowerCase()}_cia_aberta_${ano}.zip`;
    const arquivo = await baixarParaArquivo(
      this.buscar,
      `${BASE}/DOC/${tipo}/DADOS/${nome}`,
    );
    if (!arquivo) return null;
    return {
      ...arquivo,
      sourceRef: nome,
      linhas: () => lerDemonstrativos(arquivo.caminho, nome),
      composicao: () => lerComposicao(arquivo.caminho),
    };
  }
}

/** Decimal da CVM ("44.636723400000") sem zeros a direita; vazio vira null. */
function decimalOuNulo(v: string): string | null {
  if (v === "") return null;
  return /^-?\d+(\.\d+)?$/.test(v)
    ? v.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")
    : null;
}

function tentarCnpj(valor: string): string | null {
  try {
    return normalizeCnpj(valor);
  } catch {
    return null;
  }
}

async function* lerDemonstrativos(
  caminho: string,
  nomeDoZip: string,
): AsyncGenerator<LinhaDeDemonstrativo> {
  let entradaAtual = "";
  let ler: ReturnType<typeof leitorDeColunas> | null = null;

  for await (const { entrada, linha } of linhasDoZip(caminho, (n) =>
    ARQUIVO_DE_DEMONSTRATIVO.test(n),
  )) {
    if (entrada !== entradaAtual) {
      entradaAtual = entrada;
      ler = leitorDeColunas(linha);
      continue;
    }
    if (!ler || linha.trim() === "") continue;

    const c = ler(linha);
    // As duas regras que definem se o numero esta certo: so ULTIMO, e a maior
    // VERSAO (resolvida na gravacao, pela chave natural).
    if (c("ORDEM_EXERC") !== ORDEM_EXERC_VALIDA) continue;

    const [, arquivoTipo = "", variante = ""] =
      ARQUIVO_DE_DEMONSTRATIVO.exec(entrada) ?? [];
    const cnpj = tentarCnpj(c("CNPJ_CIA"));
    const valor = c("VL_CONTA");
    if (!cnpj || valor === "") continue;

    yield {
      cnpj,
      cvmCode: normalizarCodigoCvm(c("CD_CVM")),
      referenceDate: c("DT_REFER"),
      periodStart: ler.tem("DT_INI_EXERC") ? c("DT_INI_EXERC") || null : null,
      periodEnd: c("DT_FIM_EXERC") || null,
      statementType: TIPO_POR_ARQUIVO[arquivoTipo] ?? arquivoTipo,
      isConsolidated: variante === "con",
      accountCode: c("CD_CONTA"),
      accountLabel: c("DS_CONTA"),
      amount: applyCvmScale(valor, c("ESCALA_MOEDA")),
      currency: c("MOEDA"),
      version: Number(c("VERSAO")),
      sourceRef: `${nomeDoZip}#${entrada}`,
    };
  }
}

async function* lerComposicao(caminho: string): AsyncGenerator<ComposicaoDeCapital> {
  let ler: ReturnType<typeof leitorDeColunas> | null = null;
  for await (const { linha } of linhasDoZip(caminho, (n) =>
    n.includes("_composicao_capital_"),
  )) {
    if (!ler) {
      ler = leitorDeColunas(linha);
      continue;
    }
    if (linha.trim() === "") continue;
    const c = ler(linha);
    const cnpj = tentarCnpj(c("CNPJ_CIA"));
    if (!cnpj) continue;
    const n = (col: string) => BigInt(c(col) || "0");
    yield {
      cnpj,
      referenceDate: c("DT_REFER"),
      common: n("QT_ACAO_ORDIN_CAP_INTEGR"),
      preferred: n("QT_ACAO_PREF_CAP_INTEGR"),
      total: n("QT_ACAO_TOTAL_CAP_INTEGR"),
      treasuryTotal: n("QT_ACAO_TOTAL_TESOURO"),
      version: Number(c("VERSAO")),
    };
  }
}

async function* lerClasses(caminho: string): AsyncGenerator<ClasseDeFundo> {
  let ler: ReturnType<typeof leitorDeColunas> | null = null;
  for await (const { linha } of linhasDoZip(
    caminho,
    (n) => n === "registro_classe.csv",
  )) {
    if (!ler) {
      ler = leitorDeColunas(linha);
      continue;
    }
    if (linha.trim() === "") continue;
    const c = ler(linha);
    const cnpj = tentarCnpj(c("CNPJ_Classe"));
    if (!cnpj || !c("Denominacao_Social")) continue;
    yield {
      cnpj,
      name: c("Denominacao_Social"),
      classType: c("Tipo_Classe") || null,
      classification: c("Classificacao") || null,
      anbimaClass: c("Classificacao_Anbima") || null,
      status: c("Situacao") || null,
      aum: cabeNoNumeric(decimalOuNulo(c("Patrimonio_Liquido")))
        ? decimalOuNulo(c("Patrimonio_Liquido"))
        : null,
      aumDate: c("Data_Patrimonio_Liquido") || null,
    };
  }
}

/**
 * Cotas do informe diario. So a linha da classe (ID_SUBCLASSE vazio): a
 * subclasse repetiria o mesmo CNPJ e data, e a chave da tabela e (cnpj, data).
 */
async function* lerCotas(
  caminho: string,
  contagem: { descartadas: number },
): AsyncGenerator<CotaDiaria> {
  let ler: ReturnType<typeof leitorDeColunas> | null = null;
  for await (const { linha } of linhasDoZip(caminho, (n) => n.endsWith(".csv"))) {
    if (!ler) {
      ler = leitorDeColunas(linha);
      continue;
    }
    if (linha.trim() === "") continue;
    const c = ler(linha);
    if (ler.tem("ID_SUBCLASSE") && c("ID_SUBCLASSE") !== "") continue;
    const cnpj = tentarCnpj(
      ler.tem("CNPJ_FUNDO_CLASSE") ? c("CNPJ_FUNDO_CLASSE") : c("CNPJ_FUNDO"),
    );
    const nav = decimalOuNulo(c("VL_QUOTA"));
    const aum = decimalOuNulo(c("VL_PATRIM_LIQ"));
    if (!cnpj || nav === null || aum === null || Number(nav) <= 0) continue;
    const cotistas = c("NR_COTST");
    const inflows = decimalOuNulo(c("CAPTC_DIA"));
    const outflows = decimalOuNulo(c("RESG_DIA"));
    const totalPortfolio = decimalOuNulo(c("VL_TOTAL"));
    if (!cabeNoNumeric(nav, aum, inflows, outflows, totalPortfolio)) {
      contagem.descartadas++;
      continue;
    }
    yield {
      cnpj,
      date: c("DT_COMPTC"),
      nav,
      aum,
      inflows,
      outflows,
      holders: cotistas === "" ? null : Number(cotistas),
      totalPortfolio,
    };
  }
}
