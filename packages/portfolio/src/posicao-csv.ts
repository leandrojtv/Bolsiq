import type { Decimal } from "decimal.js";
import {
  detectarSeparador,
  normalizarData,
  normalizarNumero,
  type LinhaRejeitada,
} from "./csv.js";
import { d, moeda } from "./decimal.js";
import { CLASSES_COM_TICKER, LinhaDePosicao, type ClasseDePosicao } from "./tipos.js";

/** Cabecalho exato do layout de posicao, documentado em docs/services/portfolio.md. */
export const COLUNAS_POSICAO = [
  "data_posicao",
  "corretora",
  "classe",
  "subclasse",
  "ativo",
  "codigo",
  "cnpj",
  "emissor",
  "indexador",
  "pct_indexador",
  "taxa_aa",
  "data_aplicacao",
  "vencimento",
  "liquidez_diaria",
  "quantidade",
  "preco_unitario",
  "preco_medio",
  "valor_aplicado",
  "saldo_bruto",
  "ir",
  "iof",
  "saldo_liquido",
  "valorizacao",
  "observacao",
] as const;

export interface PosicaoLida extends LinhaDePosicao {
  linha: number;
  chave_ativo: string;
}

export interface PendenciaDePosicao {
  linha: number;
  corretora: string;
  ativo: string;
  motivo: string;
}

export interface TotalDaCorretora {
  corretora: string;
  data_posicao: string;
  saldo_bruto: string;
  linhas: number;
}

export interface RelatorioDeImportacaoDePosicao {
  posicoes: PosicaoLida[];
  rejeicoes: LinhaRejeitada[];
  pendencias: PendenciaDePosicao[];
  /** Soma de `saldo_bruto` das linhas aceitas, para conferir com o extrato. */
  totais_por_corretora: TotalDaCorretora[];
  linhas_lidas: number;
  duracao_ms: number;
}

/** Classes em que `codigo` identifica o ativo. */
const CLASSES_COM_CODIGO: readonly ClasseDePosicao[] = [
  ...CLASSES_COM_TICKER,
  "titulo_publico",
  "coe",
];

/** Maiusculas, sem acento e sem espaco duplicado. */
export function normalizarTexto(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Identidade do ativo entre cargas. Numero passa por `Decimal` para `1.20` e
 * `1.2` serem o mesmo CDB: senao a recarga trocaria a linha por uma "nova".
 */
export function chaveDoAtivo(
  l: Pick<
    LinhaDePosicao,
    | "classe"
    | "ativo"
    | "codigo"
    | "cnpj"
    | "emissor"
    | "indexador"
    | "pct_indexador"
    | "taxa_aa"
    | "vencimento"
    | "data_aplicacao"
  >,
): string {
  const numero = (v: string | null) => (v === null ? "" : d(v).toString());
  if (l.classe === "fundo" || l.classe === "previdencia") {
    return l.cnpj ?? `${l.classe}|${normalizarTexto(l.ativo)}`;
  }
  if (l.classe === "renda_fixa") {
    return [
      l.classe,
      normalizarTexto(l.emissor ?? l.ativo),
      l.indexador ?? "",
      numero(l.taxa_aa),
      numero(l.pct_indexador),
      l.vencimento ?? "",
      l.data_aplicacao ?? "",
    ].join("|");
  }
  if (l.codigo !== null && CLASSES_COM_CODIGO.includes(l.classe))
    return `${l.classe}|${l.codigo}`;
  return `${l.classe}|${normalizarTexto(l.ativo)}`;
}

/**
 * O que falta na linha sem impedir a carga. Taxa de renda fixa vale em `taxa_aa`
 * ou em `pct_indexador`: um CDB a 120% do CDI nao tem taxa ao ano para informar.
 */
export function pendenciasDaLinha(
  l: Pick<
    LinhaDePosicao,
    | "classe"
    | "cnpj"
    | "taxa_aa"
    | "pct_indexador"
    | "data_aplicacao"
    | "preco_medio"
    | "observacao"
  >,
): string[] {
  const motivos: string[] = [];
  if ((l.classe === "fundo" || l.classe === "previdencia") && l.cnpj === null)
    motivos.push("sem CNPJ");
  if (l.classe === "renda_fixa") {
    if (l.taxa_aa === null && l.pct_indexador === null) motivos.push("sem taxa");
    if (l.data_aplicacao === null) motivos.push("sem data de aplicação");
  }
  if (l.classe === "titulo_publico" && l.taxa_aa === null) motivos.push("sem taxa");
  if (CLASSES_COM_TICKER.includes(l.classe) && l.preco_medio === null)
    motivos.push("sem preço médio");
  if (l.observacao !== null) motivos.push(l.observacao);
  return motivos;
}

/**
 * Le o layout de posicao. Como `importarCsvBolsiq`, nao para na primeira linha
 * ruim: rejeita a linha com motivo e segue.
 *
 * Aspas valem aqui, ao contrario do CSV de transacoes: nome de fundo e de COE
 * pode ter virgula.
 */
export function importarPosicaoBolsiq(conteudo: string): RelatorioDeImportacaoDePosicao {
  const inicio = Date.now();
  const numeradas = conteudo
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((texto, i) => ({ texto, linha: i + 1 }))
    .filter((l) => l.texto.trim() !== "");
  const relatorio = (
    posicoes: PosicaoLida[],
    rejeicoes: LinhaRejeitada[],
  ): RelatorioDeImportacaoDePosicao => ({
    posicoes,
    rejeicoes: [...rejeicoes].sort((a, b) => a.linha - b.linha),
    pendencias: posicoes.flatMap((p) =>
      pendenciasDaLinha(p).map((motivo) => ({
        linha: p.linha,
        corretora: p.corretora,
        ativo: p.ativo,
        motivo,
      })),
    ),
    totais_por_corretora: totais(posicoes),
    linhas_lidas: Math.max(numeradas.length - 1, 0),
    duracao_ms: Date.now() - inicio,
  });

  const primeira = numeradas[0];
  if (!primeira) return relatorio([], []);

  const separador = detectarSeparador(primeira.texto);
  const cabecalho = dividir(primeira.texto, separador).map((c) => c.trim().toLowerCase());
  if (cabecalho.join() !== COLUNAS_POSICAO.join()) {
    const faltando = COLUNAS_POSICAO.filter((c) => !cabecalho.includes(c));
    return relatorio(
      [],
      [
        {
          linha: primeira.linha,
          motivo: faltando.length
            ? `cabecalho sem as colunas: ${faltando.join(", ")}`
            : `cabecalho deve ter exatamente, nesta ordem: ${COLUNAS_POSICAO.join(", ")}`,
          conteudo: primeira.texto,
        },
      ],
    );
  }

  const validas: PosicaoLida[] = [];
  const rejeicoes: LinhaRejeitada[] = [];
  const rejeitar = (linha: number, motivo: string, bruta: string) =>
    rejeicoes.push({ linha, motivo, conteudo: bruta });

  for (const { texto, linha } of numeradas.slice(1)) {
    const campos = dividir(texto, separador);
    if (campos.length !== COLUNAS_POSICAO.length) {
      rejeitar(
        linha,
        `esperava ${COLUNAS_POSICAO.length} colunas, veio ${campos.length}`,
        texto,
      );
      continue;
    }
    const validado = LinhaDePosicao.safeParse(candidato(campos));
    if (validado.success) {
      validas.push({
        ...validado.data,
        linha,
        chave_ativo: chaveDoAtivo(validado.data),
      });
    } else {
      const primeiro = validado.error.issues[0];
      rejeitar(
        linha,
        primeiro ? `${primeiro.path.join(".")}: ${primeiro.message}` : "linha invalida",
        texto,
      );
    }
  }

  // Uma corretora, uma fotografia: linha de outra data ou repetida faria a soma
  // nao bater com extrato nenhum, e a repetida violaria o indice unico.
  const maisRecente = new Map<string, string>();
  for (const p of validas) {
    const atual = maisRecente.get(p.corretora);
    if (!atual || p.data_posicao > atual) maisRecente.set(p.corretora, p.data_posicao);
  }
  const textos = new Map(numeradas.map((n) => [n.linha, n.texto]));
  const vistas = new Set<string>();
  const posicoes = validas.filter((p) => {
    const bruta = textos.get(p.linha) ?? "";
    if (p.data_posicao !== maisRecente.get(p.corretora)) {
      rejeitar(
        p.linha,
        `data_posicao diferente da mais recente de ${p.corretora} no arquivo`,
        bruta,
      );
      return false;
    }
    const chave = `${p.corretora}|${p.chave_ativo}`;
    if (vistas.has(chave)) {
      rejeitar(p.linha, `ativo repetido em ${p.corretora}: some as duas linhas`, bruta);
      return false;
    }
    vistas.add(chave);
    return true;
  });

  return relatorio(posicoes, rejeicoes);
}

function candidato(campos: string[]) {
  const bruto = Object.fromEntries(
    COLUNAS_POSICAO.map((c, i) => [c, (campos[i] ?? "").trim()]),
  ) as Record<(typeof COLUNAS_POSICAO)[number], string>;

  // `normalizarNumero("")` devolve "0": aqui vazio e "nao informado", nao zero.
  const numero = (v: string) => (v === "" ? null : normalizarNumero(v));
  const data = (v: string) => (v === "" ? null : normalizarData(v));
  const texto = (v: string) => (v === "" ? null : v);
  const liquidez = bruto.liquidez_diaria.toUpperCase();
  const indexador = bruto.indexador.toUpperCase();

  return {
    data_posicao: normalizarData(bruto.data_posicao),
    corretora: bruto.corretora,
    classe: bruto.classe.toLowerCase(),
    subclasse: texto(bruto.subclasse),
    ativo: bruto.ativo || bruto.codigo,
    codigo: texto(bruto.codigo.toUpperCase()),
    cnpj: bruto.cnpj === "" ? null : bruto.cnpj.replace(/[./-]/g, ""),
    emissor: texto(bruto.emissor),
    indexador: indexador === "" ? null : indexador,
    pct_indexador: numero(bruto.pct_indexador),
    taxa_aa: numero(bruto.taxa_aa),
    data_aplicacao: data(bruto.data_aplicacao),
    vencimento: data(bruto.vencimento),
    liquidez_diaria:
      liquidez === "S" ? true : liquidez === "N" ? false : liquidez || null,
    quantidade: numero(bruto.quantidade),
    preco_unitario: numero(bruto.preco_unitario),
    preco_medio: numero(bruto.preco_medio),
    valor_aplicado: numero(bruto.valor_aplicado),
    saldo_bruto: bruto.saldo_bruto === "" ? "" : normalizarNumero(bruto.saldo_bruto),
    ir: numero(bruto.ir),
    iof: numero(bruto.iof),
    saldo_liquido: numero(bruto.saldo_liquido),
    valorizacao: bruto.valorizacao.toLowerCase(),
    observacao: texto(bruto.observacao),
  };
}

function totais(posicoes: PosicaoLida[]): TotalDaCorretora[] {
  const soma = new Map<string, { data: string; valor: Decimal; linhas: number }>();
  for (const p of posicoes) {
    const atual = soma.get(p.corretora) ?? {
      data: p.data_posicao,
      valor: d(0),
      linhas: 0,
    };
    atual.valor = atual.valor.plus(d(p.saldo_bruto));
    atual.linhas++;
    soma.set(p.corretora, atual);
  }
  return [...soma.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([corretora, t]) => ({
      corretora,
      data_posicao: t.data,
      saldo_bruto: moeda(t.valor),
      linhas: t.linhas,
    }));
}

/** Separa respeitando aspas: `"COE, Ouro"` e um campo so, e `""` e aspa literal. */
function dividir(linha: string, separador: string): string[] {
  const campos: string[] = [];
  let atual = "";
  let entreAspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (entreAspas) {
      if (c !== '"') atual += c;
      else if (linha[i + 1] === '"') {
        atual += '"';
        i++;
      } else entreAspas = false;
    } else if (c === '"') entreAspas = true;
    else if (c === separador) {
      campos.push(atual);
      atual = "";
    } else atual += c;
  }
  campos.push(atual);
  return campos;
}
