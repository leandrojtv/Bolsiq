import { Decimal } from "decimal.js";
import {
  CLASSES_COM_TICKER,
  COLUNAS_BOLSIQ,
  COLUNAS_POSICAO,
  importarCsvBolsiq,
  importarPosicaoBolsiq,
  type ClasseDePosicao,
  type PendenciaDePosicao,
} from "@bolsiq/portfolio";
import {
  conciliar,
  csvDePosicoes,
  csvDeTransacoes,
  lerValor,
  TOLERANCIA_PADRAO,
  type ConciliacaoDaCorretora,
  type TotalDeclarado,
} from "./conciliacao.js";
import type {
  Confianca,
  NotaDaIA,
  Origem,
  PosicaoDaIA,
  ProventoDaIA,
  SaidaDaIA,
  TransacaoDaIA,
} from "./esquema.js";
import {
  classe as normalizarClasse,
  data,
  normalizarPosicao,
  normalizarTransacao,
  numero,
  PARECE_TOTAL,
  ticker,
} from "./normalizar.js";
import {
  preencherPosicao,
  preencherTransacao,
  type ContextoDoPreenchimento,
} from "./padroes.js";
import type { Parte } from "./texto.js";

/** O que o market-data sabe para conferir transacao. Implementado no BFF pelo /v1. */
export interface Verificador {
  /** Os que existem. `null`: market-data indisponivel. */
  tickersExistentes(tickers: string[]): Promise<Set<string> | null>;
  /** Minima e maxima do pregao (COTAHIST). `null`: sem candle no dia. */
  faixaDoDia(
    ticker: string,
    data: string,
  ): Promise<{ minima: string; maxima: string } | null>;
}

export interface OpcoesDaValidacao {
  /** AAAA-MM-DD em Sao Paulo. */
  hoje: string;
  /** Corretora escolhida no envio e nome do arquivo, para a politica de preenchimento. */
  preenchimento?: Partial<ContextoDoPreenchimento>;
  tolerancia?: number;
  /** Origens sem texto (pagina escaneada, imagem): conferidas so pelo trecho. */
  sem_texto?: string[];
}

export type TipoDeLinha = "posicao" | "transacao" | "provento";

/**
 * Pronta, preenchida pela politica de padroes, precisa de ajuste do usuario, ou
 * provento provisionado (pagamento futuro), que nao entra na carteira agora.
 */
export type GrupoDaLinha = "pronta" | "preenchida" | "ajuste" | "a_receber";

export interface LinhaProposta {
  id: string;
  tipo: TipoDeLinha;
  grupo: GrupoDaLinha;
  /** Campos no layout de destino, como texto: o que a tela edita e devolve. */
  dados: Record<string, string>;
  origem: Origem;
  confianca: Confianca;
  /** Vem marcada? Ajuste, confianca baixa ou carga divergente vem desmarcada. */
  marcada: boolean;
  /** Campos que a politica de padroes preencheu ("preenchido automaticamente"). */
  preenchidos: string[];
  /** Campos a destacar na revisao: o que impede a linha de ser importada. */
  problemas: string[];
  /** Por que precisa de ajuste. */
  motivo: string | null;
  avisos: string[];
}

/** Linha que a autocorrecao manda de volta ao modelo, com o motivo. */
export interface ParaCorrigir {
  tipo: TipoDeLinha;
  original: PosicaoDaIA | TransacaoDaIA | ProventoDaIA;
  motivo: string;
}

export interface ConciliacaoDaSecao {
  secao: string;
  classe: string;
  declarado: string;
  soma: string;
  diferenca: string;
  confere: boolean;
}

export interface ConciliacaoComSituacao extends ConciliacaoDaCorretora {
  /** Sem total no documento nao bloqueia a carga. */
  situacao: "conciliada" | "divergente" | "sem_total";
  /** Na divergencia, as secoes do documento que nao batem, para saber onde olhar. */
  secoes: ConciliacaoDaSecao[];
}

export interface RejeicaoDaIA {
  tipo: TipoDeLinha | "nota" | "total";
  motivo: string;
  origem: Origem | null;
  /** O que o modelo propos, para a tela mostrar. */
  conteudo: string;
}

export interface ConciliacaoDaNota {
  numero: string;
  data_pregao: string | null;
  compras: string;
  vendas: string;
  taxas: string;
  irrf: string;
  liquido_calculado: string;
  liquido_declarado: string | null;
  sentido_declarado: "debito" | "credito" | null;
  conciliada: boolean;
  motivo: string | null;
}

export interface ResultadoDaValidacao {
  documento: {
    tipo: SaidaDaIA["documento"]["tipo"];
    corretora: string | null;
    data_referencia: string | null;
    totais_declarados: TotalDeclarado[];
  };
  linhas: LinhaProposta[];
  rejeicoes: RejeicaoDaIA[];
  pendencias: PendenciaDePosicao[];
  conciliacao: ConciliacaoComSituacao[];
  notas: ConciliacaoDaNota[];
  /** Nenhuma divergencia (posicao contra totais, nota contra liquido). Sem total nao conta. */
  conciliada: boolean;
  /** Linhas que a autocorrecao manda ao modelo. Nao vai para a tela. */
  para_corrigir: ParaCorrigir[];
  avisos: string[];
}

// ---------------------------------------------------------------------------
// Origem: o que nao aparece no documento e invencao
// ---------------------------------------------------------------------------

/** So letra e digito, sem acento: separador de coluna e espaco nao contam. */
export const compacto = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/** Todas as leituras de cada numero do texto: "1.234" pode ser mil ou um e pouco. */
export function numerosDoTexto(texto: string): Decimal[] {
  const lidos: Decimal[] = [];
  const tenta = (s: string) => {
    try {
      lidos.push(new Decimal(s).abs());
    } catch {
      /* token que nao e numero */
    }
  };
  for (const t of texto.match(/\d[\d.,]*\d|\d/g) ?? []) {
    const ponto = t.lastIndexOf(".");
    const virgula = t.lastIndexOf(",");
    if (ponto !== -1 && virgula !== -1) {
      if (virgula > ponto) tenta(t.replace(/\./g, "").replace(",", "."));
      else tenta(t.replace(/,/g, ""));
    } else if (virgula !== -1) {
      tenta(t.replace(/\./g, "").replace(",", "."));
      if (/^\d{1,3}(,\d{3})+$/.test(t)) tenta(t.replace(/,/g, ""));
    } else if (ponto !== -1) {
      tenta(t);
      if (/^\d{1,3}(\.\d{3})+$/.test(t)) tenta(t.replace(/\./g, ""));
    } else tenta(t);
  }
  return lidos;
}

const aparece = (valor: string, numeros: Decimal[]): boolean => {
  const v = lerValor(valor);
  return v !== null && numeros.some((n) => n.eq(v.abs()));
};

/** Fracao (0.1469) aparece como percentual (14,69). */
const apareceComoPercentual = (valor: string, numeros: Decimal[]): boolean => {
  const v = lerValor(valor);
  return v !== null && numeros.some((n) => n.eq(v.abs().times(100)));
};

interface Fonte {
  /** Texto da origem, compacto, para achar o trecho. */
  compacta: string;
  linhas: { texto: string; compacta: string }[];
}

class Fontes {
  private readonly porOrigem = new Map<string, Fonte>();
  readonly numerosDoDocumento: Decimal[];

  constructor(
    partes: Parte[],
    private readonly semTexto: Set<string>,
  ) {
    for (const p of partes) {
      const atual = this.porOrigem.get(p.origem.toLowerCase()) ?? {
        compacta: "",
        linhas: [],
      };
      atual.compacta += compacto(p.texto);
      for (const l of p.texto.split("\n"))
        atual.linhas.push({ texto: l, compacta: compacto(l) });
      this.porOrigem.set(p.origem.toLowerCase(), atual);
    }
    this.numerosDoDocumento = numerosDoTexto(partes.map((p) => p.texto).join("\n"));
  }

  /** Origem sem texto extraido: pagina escaneada ou o documento todo em imagem. */
  ehImagem(o: Origem): boolean {
    const chave = o.pagina_ou_aba.trim().toLowerCase();
    return (
      this.semTexto.has(chave) || (this.porOrigem.size === 0 && this.semTexto.size > 0)
    );
  }

  /**
   * O trecho tem de estar no documento, na origem declarada (ou em qualquer uma,
   * se o modelo errou so o rotulo). Devolve o contexto onde os valores serao
   * procurados: o trecho mais as linhas inteiras do documento que o contem, porque
   * uma linha de extrato pode passar dos 200 caracteres do trecho.
   */
  contexto(o: Origem): { achado: boolean; texto: string } {
    const trecho = compacto(o.trecho_original);
    if (trecho.length < 6) return { achado: false, texto: o.trecho_original };
    const declarada = this.porOrigem.get(o.pagina_ou_aba.trim().toLowerCase());
    const fonte =
      declarada && declarada.compacta.includes(trecho)
        ? declarada
        : [...this.porOrigem.values()].find((f) => f.compacta.includes(trecho));
    if (!fonte) return { achado: false, texto: o.trecho_original };
    const linhas = fonte.linhas
      .filter(
        (l) =>
          l.compacta.length > 0 &&
          (l.compacta.includes(trecho) ||
            (l.compacta.length >= 6 && trecho.includes(l.compacta))),
      )
      .map((l) => l.texto);
    return { achado: true, texto: [o.trecho_original, ...linhas].join("\n") };
  }
}

const ORDEM_DA_CONFIANCA: Confianca[] = ["baixa", "media", "alta"];
const menor = (a: Confianca, b: Confianca): Confianca =>
  ORDEM_DA_CONFIANCA.indexOf(a) <= ORDEM_DA_CONFIANCA.indexOf(b) ? a : b;

const recorte = (o: Origem): Origem => ({
  pagina_ou_aba: o.pagina_ou_aba,
  trecho_original: o.trecho_original.slice(0, 200),
});

const texto = (v: string | null | undefined) => (v ?? "").trim();

const PARECE_INSTRUCAO =
  /\bignor[ea]\b|\bdesconsider|instru[cç][aãoõ]|\brespond[ae]\b|\badicion[ea]\b|\bacrescent[ea]\b|\binclua\b|\bprompt\b|\bsystem\b|\byou are\b|voc[eê] (?:é|deve)|\bassistente\b/i;

interface Conferida {
  ok: boolean;
  motivo: string | null;
  confianca: Confianca;
  avisos: string[];
}

/**
 * Confere uma linha contra o documento. `valores` sao os numeros que precisam
 * aparecer; `ativo` sao as grafias aceitas do ativo (uma basta).
 */
function conferirOrigem(
  fontes: Fontes,
  origem: Origem,
  confianca: Confianca,
  valores: { campo: string; valor: string | null; percentual?: boolean }[],
  ativo: { grafias: string[]; rotulo: string },
): Conferida {
  const avisos: string[] = [];
  let conf = confianca;
  let contexto: string;
  // Linha que nasce de texto com cara de instrucao e o documento tentando mandar
  // no modelo, nao um ativo do extrato.
  if (PARECE_INSTRUCAO.test(origem.trecho_original))
    return {
      ok: false,
      motivo: "trecho_original parece instrução, não dado do extrato",
      confianca: conf,
      avisos,
    };
  if (fontes.ehImagem(origem)) {
    // Sem texto do documento para conferir: vale so o trecho, e a linha vem
    // desmarcada para o usuario olhar.
    contexto = origem.trecho_original;
    conf = "baixa";
    avisos.push("Lida de imagem: confira com o documento.");
  } else {
    const c = fontes.contexto(origem);
    if (!c.achado)
      return {
        ok: false,
        motivo: "trecho_original não aparece no documento",
        confianca: conf,
        avisos,
      };
    contexto = c.texto;
  }
  const numeros = numerosDoTexto(contexto);
  for (const { campo, valor, percentual } of valores) {
    if (!texto(valor)) continue;
    const ok = percentual
      ? apareceComoPercentual(valor as string, numeros) ||
        aparece(valor as string, numeros)
      : aparece(valor as string, numeros);
    if (!ok)
      return {
        ok: false,
        motivo: `${campo} ${valor} não aparece no trecho original`,
        confianca: conf,
        avisos,
      };
  }
  const compactoDoContexto = compacto(contexto);
  const grafias = ativo.grafias.map(compacto).filter((g) => g.length >= 3);
  if (grafias.length === 0 || !grafias.some((g) => compactoDoContexto.includes(g)))
    return {
      ok: false,
      motivo: `${ativo.rotulo} não aparece no trecho original`,
      confianca: conf,
      avisos,
    };
  return { ok: true, motivo: null, confianca: conf, avisos };
}

/** Palavras do nome que identificam o ativo: "CDB BANCO XYZ" aceita "BANCO" ou "XYZ". */
const palavrasDoNome = (nome: string) =>
  nome.split(/[\s\-/]+/).filter((p) => compacto(p).length >= 4 && !/^\d+$/.test(p));

// ---------------------------------------------------------------------------
// Posicoes
// ---------------------------------------------------------------------------

const NUMERICOS_DA_POSICAO = [
  "quantidade",
  "preco_unitario",
  "preco_medio",
  "valor_aplicado",
  "saldo_bruto",
  "ir",
  "iof",
  "saldo_liquido",
] as const;

function conferirPosicao(fontes: Fontes, p: PosicaoDaIA): Conferida {
  const classe = texto(p.classe).toLowerCase() as ClasseDePosicao;
  const comTicker = CLASSES_COM_TICKER.includes(classe);
  return conferirOrigem(
    fontes,
    p.origem,
    p.confianca,
    [
      ...NUMERICOS_DA_POSICAO.map((c) => ({ campo: c, valor: p[c] })),
      { campo: "taxa_aa", valor: p.taxa_aa, percentual: true },
      { campo: "pct_indexador", valor: p.pct_indexador, percentual: true },
    ],
    comTicker
      ? { grafias: [texto(p.codigo)], rotulo: `ticker ${texto(p.codigo)}` }
      : {
          // O nome inteiro tambem vale: "CDB Nu 110% CDI" nao tem palavra de 4 letras.
          grafias: [texto(p.codigo), texto(p.ativo), ...palavrasDoNome(texto(p.ativo))],
          rotulo: `ativo ${texto(p.ativo)}`,
        },
  );
}

const dadosDaPosicao = (p: PosicaoDaIA): Record<string, string> =>
  Object.fromEntries(COLUNAS_POSICAO.map((c) => [c, texto(p[c])]));

// ---------------------------------------------------------------------------
// Transacoes, notas e proventos
// ---------------------------------------------------------------------------

interface Candidata {
  tipo: "transacao" | "provento";
  original: TransacaoDaIA | ProventoDaIA;
  dados: Record<string, string>;
  preenchidos: string[];
  origem: Origem;
  confianca: Confianca;
  avisos: string[];
  nota: string | null;
  motivo: string | null;
  /** Provento com pagamento futuro: informativo, nao e lancado. */
  a_receber?: boolean;
}

function conferirTransacao(fontes: Fontes, t: TransacaoDaIA): Conferida {
  const r = conferirOrigem(
    fontes,
    t.origem,
    t.confianca,
    [
      { campo: "quantidade", valor: t.quantidade },
      { campo: "preco", valor: t.preco },
      // Taxa de nota e rateada pelo Bolsiq: nao esta escrita por operacao.
      ...(t.nota
        ? []
        : [
            {
              campo: "taxas",
              valor: lerValor(texto(t.taxas))?.isZero() ? null : t.taxas,
            },
          ]),
    ],
    {
      grafias: [
        texto(t.ticker),
        texto(t.ticker).replace(/F$/, ""),
        ...palavrasDoNome(texto(t.ativo_no_documento)),
      ],
      rotulo: `ativo ${texto(t.ticker) || texto(t.ativo_no_documento)}`,
    },
  );
  // Ticker deduzido do nome do papel: plausivel, mas nao esta escrito.
  if (
    r.ok &&
    !compacto(t.origem.trecho_original + texto(t.ativo_no_documento)).includes(
      compacto(texto(t.ticker)),
    )
  ) {
    r.confianca = menor(r.confianca, "media");
    r.avisos.push(
      `Ticker ${texto(t.ticker)} deduzido de "${texto(t.ativo_no_documento)}".`,
    );
  }
  return r;
}

const ZERO = new Decimal(0);
const valorOuZero = (v: string | null) => lerValor(texto(v)) ?? ZERO;

/**
 * Rateia as taxas da nota pelo volume de cada negocio e confere o liquido:
 * compras - vendas + taxas + IRRF = liquido a debito (negativo: a credito).
 * O ultimo negocio leva o centavo do arredondamento, para a soma fechar.
 */
export function ratearNota(
  nota: NotaDaIA,
  operacoes: { dados: Record<string, string> }[],
  numerosDoDocumento: Decimal[],
): ConciliacaoDaNota {
  const volume = (o: { dados: Record<string, string> }) =>
    valorOuZero(o.dados.quantidade ?? null).times(valorOuZero(o.dados.preco ?? null));
  const tipo = (o: { dados: Record<string, string> }) =>
    (o.dados.tipo ?? "").toLowerCase();
  const compras = operacoes
    .filter((o) => tipo(o) === "compra")
    .reduce((s, o) => s.plus(volume(o)), ZERO);
  const vendas = operacoes
    .filter((o) => tipo(o) === "venda")
    .reduce((s, o) => s.plus(volume(o)), ZERO);
  const taxas = valorOuZero(nota.taxas_total);
  const irrf = valorOuZero(nota.irrf);
  const total = compras.plus(vendas);

  let distribuido = ZERO;
  operacoes.forEach((o, i) => {
    const parte =
      i === operacoes.length - 1
        ? taxas.minus(distribuido)
        : total.isZero()
          ? ZERO
          : taxas.times(volume(o)).div(total).toDecimalPlaces(2);
    distribuido = distribuido.plus(parte);
    o.dados.taxas = parte.toFixed(2);
  });

  const calculado = compras.minus(vendas).plus(taxas).plus(irrf);
  const declarado = lerValor(texto(nota.valor_liquido));
  let motivo: string | null = null;
  if (declarado === null) motivo = "a nota não traz o valor líquido";
  // Documento sem texto (nota escaneada): o valor so pode ser conferido na conta.
  else if (
    numerosDoDocumento.length > 0 &&
    !numerosDoDocumento.some((n) => n.eq(declarado.abs()))
  )
    motivo = `valor líquido ${declarado.toFixed(2)} não aparece no documento`;
  else if (calculado.abs().minus(declarado.abs()).abs().gt("0.02"))
    motivo = `operações + taxas = ${calculado.abs().toFixed(2)}, a nota diz ${declarado.abs().toFixed(2)}`;
  else if (
    nota.sentido_liquido &&
    !calculado.isZero() &&
    (calculado.gt(0) ? "debito" : "credito") !== nota.sentido_liquido
  )
    motivo = `o líquido calculado é a ${calculado.gt(0) ? "débito" : "crédito"}, a nota diz ${nota.sentido_liquido === "debito" ? "débito" : "crédito"}`;

  return {
    numero: nota.numero,
    data_pregao: nota.data_pregao,
    compras: compras.toFixed(2),
    vendas: vendas.toFixed(2),
    taxas: taxas.toFixed(2),
    irrf: irrf.toFixed(2),
    liquido_calculado: calculado.toFixed(2),
    liquido_declarado: declarado?.toFixed(2) ?? null,
    sentido_declarado: nota.sentido_liquido || null,
    conciliada: motivo === null,
    motivo,
  };
}

function proventoComoTransacao(p: ProventoDaIA): {
  dados: Record<string, string>;
  aviso: string | null;
} {
  const qtd = lerValor(texto(p.quantidade));
  const porCota = lerValor(texto(p.valor_por_cota));
  const total = lerValor(texto(p.valor_total));
  let quantidade = qtd;
  let preco = porCota;
  let aviso: string | null = null;
  if (preco === null && total && qtd && !qtd.isZero())
    preco = total.div(qtd).toDecimalPlaces(8);
  if (quantidade === null && total && porCota && !porCota.isZero())
    quantidade = total.div(porCota).toDecimalPlaces(8);
  if ((quantidade === null || preco === null) && total) {
    quantidade = new Decimal(1);
    preco = total;
    aviso = "Sem quantidade: lançado como valor total.";
  }
  return {
    dados: {
      data: texto(p.data_pagamento),
      ticker: texto(p.ticker).toUpperCase(),
      tipo: "provento",
      quantidade: quantidade?.toString() ?? "",
      preco: preco?.toString() ?? "",
      taxas: "0",
      corretora: texto(p.corretora),
    },
    aviso,
  };
}

// ---------------------------------------------------------------------------
// Validacao
// ---------------------------------------------------------------------------

/** Campos de preenchimento menor: marcados, mas nao tiram a linha de "pronta". */
const PREENCHIMENTO_MENOR = new Set([
  "ir",
  "iof",
  "liquidez_diaria",
  "valorizacao",
  "saldo_liquido",
  "taxas",
]);

const grupoDe = (preenchidos: string[], ajuste: boolean): GrupoDaLinha =>
  ajuste
    ? "ajuste"
    : preenchidos.some((c) => !PREENCHIMENTO_MENOR.has(c))
      ? "preenchida"
      : "pronta";

/** "classe: deve ser..." aponta o campo `classe`. */
const campoDoMotivo = (motivo: string) =>
  /^([a-z_]+)(?:\.\d+)?:/.exec(motivo)?.[1] ?? null;

/** O que o modelo pode corrigir: tudo, menos o trecho com cara de instrucao. */
const corrigivel = (motivo: string) => !/parece instrução/.test(motivo);

/** Secoes do documento ("Renda Fixa", "Ações") pela classe que representam. */
function classeDaSecao(descricao: string): string | null {
  const c = normalizarClasse(descricao);
  return CLASSES_CANONICAS.includes(c) ? c : null;
}
const CLASSES_CANONICAS = [
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
];

/**
 * Soma por secao contra o total declarado de cada secao, para apontar onde a
 * carga diverge do documento ("Renda Fixa: faltam R$ 1.234,56").
 */
export function conciliarPorSecao(
  linhas: { classe: string; saldo_bruto: string }[],
  totais: TotalDeclarado[],
  tolerancia = TOLERANCIA_PADRAO,
): ConciliacaoDaSecao[] {
  return totais.flatMap((t) => {
    const classe = classeDaSecao(t.descricao);
    const declarado = lerValor(t.valor);
    if (!classe || !declarado) return [];
    const soma = linhas
      .filter((l) => l.classe === classe)
      .reduce((s, l) => s.plus(lerValor(l.saldo_bruto) ?? 0), new Decimal(0));
    const diferenca = soma.minus(declarado);
    return [
      {
        secao: t.descricao,
        classe,
        declarado: declarado.toFixed(2),
        soma: soma.toFixed(2),
        diferenca: diferenca.toFixed(2),
        confere: diferenca.abs().lte(declarado.times(tolerancia)),
      },
    ];
  });
}

/**
 * Passa a proposta do modelo pela correcao deterministica, pela conferencia de
 * origem, pela politica de preenchimento e pelos validadores de sempre. Nada
 * aqui grava: o resultado vai para a revisao, em tres grupos.
 *
 * Ordem: normaliza; confere a origem nos valores que vieram do documento (o que
 * a politica preenche nao esta no trecho, e nao e conferido); preenche; valida o
 * layout. Falha de origem rejeita (e invencao); falha de layout e "precisa de
 * ajuste", editavel. Os dois casos voltam em `para_corrigir`, para a
 * autocorrecao mandar ao modelo.
 */
export async function validarExtracao(
  saida: SaidaDaIA,
  partes: Parte[],
  verificador: Verificador,
  o: OpcoesDaValidacao,
): Promise<ResultadoDaValidacao> {
  let sequencia = 0;
  const novoId = (tipo: string) => `${tipo}-${++sequencia}`;
  const tolerancia = o.tolerancia ?? TOLERANCIA_PADRAO;
  const ctx: ContextoDoPreenchimento = {
    data_documento: data(texto(saida.documento.data_referencia)),
    hoje: o.hoje,
    corretora_escolhida: o.preenchimento?.corretora_escolhida ?? "",
    nome_do_arquivo: o.preenchimento?.nome_do_arquivo ?? "",
    ...(o.preenchimento?.data_documento
      ? { data_documento: o.preenchimento.data_documento }
      : {}),
  };
  if (!ctx.corretora_escolhida && texto(saida.documento.corretora))
    ctx.corretora_escolhida = texto(saida.documento.corretora);
  const fontes = new Fontes(
    partes,
    new Set((o.sem_texto ?? []).map((s) => s.toLowerCase())),
  );
  const rejeicoes: RejeicaoDaIA[] = [];
  const para_corrigir: ParaCorrigir[] = [];
  const avisos = [...saida.avisos];
  const rejeitar = (
    tipo: RejeicaoDaIA["tipo"],
    motivo: string,
    origem: Origem | null,
    conteudo: unknown,
  ) =>
    rejeicoes.push({
      tipo,
      motivo,
      origem: origem && recorte(origem),
      conteudo: JSON.stringify(conteudo),
    });

  for (const m of saida.malformadas)
    rejeitar(
      m.tipo === "posicoes"
        ? "posicao"
        : m.tipo === "proventos"
          ? "provento"
          : "transacao",
      `linha do bloco ${m.tipo}: ${m.motivo}`,
      null,
      m.conteudo,
    );

  // Total declarado que nao esta no documento foi inventado: sai da conciliacao.
  // Documento todo em imagem nao tem texto para conferir: o total fica, com aviso.
  const semTextoNenhum = fontes.numerosDoDocumento.length === 0;
  if (semTextoNenhum && saida.documento.totais_declarados.length > 0)
    avisos.push("Totais lidos de imagem: confira com o documento.");
  const totais = saida.documento.totais_declarados.filter((t) => {
    if (semTextoNenhum || aparece(t.valor, fontes.numerosDoDocumento)) return true;
    rejeitar("total", `total declarado ${t.valor} não aparece no documento`, null, t);
    return false;
  });

  // ------------------------------------------------------------------ posicoes
  interface PosicaoEmAndamento {
    original: PosicaoDaIA;
    dados: Record<string, string>;
    conferida: Conferida;
    preenchidos: string[];
    avisos: string[];
    motivo: string | null;
  }
  const emAndamento: PosicaoEmAndamento[] = [];
  let totaisIgnorados = 0;
  for (const p of saida.posicoes) {
    if (
      !texto(p.codigo) &&
      (PARECE_TOTAL.test(texto(p.ativo)) || PARECE_TOTAL.test(texto(p.classe)))
    ) {
      totaisIgnorados++;
      continue;
    }
    const normal = normalizarPosicao(dadosDaPosicao(p));
    const conferida = conferirPosicao(fontes, { ...p, ...normal });
    if (!conferida.ok) {
      const motivo = conferida.motivo ?? "linha inválida";
      rejeitar("posicao", motivo, p.origem, normal);
      if (corrigivel(motivo))
        para_corrigir.push({ tipo: "posicao", original: p, motivo });
      continue;
    }
    const f = preencherPosicao(normal, ctx);
    emAndamento.push({
      original: p,
      dados: f.dados,
      conferida,
      preenchidos: f.preenchidos,
      avisos: f.avisos,
      motivo: null,
    });
  }
  if (totaisIgnorados > 0)
    avisos.push(
      `${totaisIgnorados} linha(s) de total ou subtotal do documento não viraram posição.`,
    );

  // Os validadores do layout, linha a linha (motivo por linha) e no conjunto
  // (data por corretora e ativo repetido).
  const relatorio = importarPosicaoBolsiq(
    csvDePosicoes(
      COLUNAS_POSICAO,
      emAndamento.map((x) => x.dados),
    ),
  );
  for (const r of relatorio.rejeicoes) {
    const x = emAndamento[r.linha - 2];
    if (x) x.motivo = r.motivo;
  }
  const lidas = new Map(relatorio.posicoes.map((p) => [p.linha - 2, p]));

  const verificaveis = new Set<string>(
    [
      ...relatorio.posicoes
        .filter((p) => CLASSES_COM_TICKER.includes(p.classe))
        .map((p) => p.codigo ?? ""),
      ...saida.transacoes.map((t) =>
        ticker(texto(t.ticker)).replace(/^(.{4,11}\d{1,2})F$/, "$1"),
      ),
      ...saida.proventos.map((p) => ticker(texto(p.ticker))),
    ].filter(Boolean),
  );
  const existentes = await verificador
    .tickersExistentes([...verificaveis])
    .catch(() => null);
  if (existentes === null && verificaveis.size > 0)
    avisos.push("Market-data indisponível: tickers e preços não foram conferidos.");

  for (const [i, x] of emAndamento.entries()) {
    const lida = lidas.get(i);
    if (!lida) continue;
    if (lida.data_posicao > o.hoje)
      x.motivo = `data_posicao: ${lida.data_posicao} no futuro`;
    else if (
      existentes &&
      CLASSES_COM_TICKER.includes(lida.classe) &&
      !existentes.has(lida.codigo ?? "")
    )
      x.motivo = `codigo: ticker ${lida.codigo} não existe no market-data`;
  }

  const validas = emAndamento.flatMap((x, i) => {
    const lida = lidas.get(i);
    return x.motivo === null && lida ? [{ x, lida }] : [];
  });
  const corretoras = [...new Set(validas.map((v) => v.lida.corretora))].sort();
  const conciliacao: ConciliacaoComSituacao[] = corretoras.map((corretora) => {
    const daqui = validas.filter((v) => v.lida.corretora === corretora);
    const c = conciliar(
      corretora,
      daqui.map((v) => v.lida.saldo_bruto),
      totais,
      tolerancia,
    );
    return {
      ...c,
      situacao:
        c.declarado === null ? "sem_total" : c.conciliada ? "conciliada" : "divergente",
      secoes:
        c.declarado !== null && !c.conciliada
          ? conciliarPorSecao(
              daqui.map((v) => v.lida),
              totais,
              tolerancia,
            )
          : [],
    };
  });
  const situacaoDe = new Map(conciliacao.map((c) => [c.corretora, c.situacao]));

  const linhas: LinhaProposta[] = [];
  for (const x of emAndamento) {
    const ajuste = x.motivo !== null;
    if (ajuste && x.motivo && corrigivel(x.motivo))
      para_corrigir.push({ tipo: "posicao", original: x.original, motivo: x.motivo });
    const lida = relatorio.posicoes.find((p) => p.linha - 2 === emAndamento.indexOf(x));
    const pendencias = lida
      ? relatorio.pendencias.filter((p) => p.linha === lida.linha).map((p) => p.motivo)
      : [];
    const grupo = grupoDe(x.preenchidos, ajuste);
    linhas.push({
      id: novoId("posicao"),
      tipo: "posicao",
      grupo,
      dados: x.dados,
      origem: recorte(x.original.origem),
      confianca: x.conferida.confianca,
      marcada:
        grupo !== "ajuste" &&
        x.conferida.confianca !== "baixa" &&
        situacaoDe.get(x.dados.corretora ?? "") !== "divergente",
      preenchidos: x.preenchidos,
      problemas: x.motivo ? [campoDoMotivo(x.motivo) ?? ""].filter(Boolean) : [],
      motivo: x.motivo,
      avisos: [...x.conferida.avisos, ...x.avisos, ...pendencias],
    });
  }

  // ------------------------------------------------- transacoes e proventos
  const candidatas: Candidata[] = [];
  for (const t of saida.transacoes) {
    const normal = normalizarTransacao(
      Object.fromEntries(COLUNAS_BOLSIQ.map((k) => [k, texto(t[k])])),
    );
    const c = conferirTransacao(fontes, { ...t, ...normal });
    if (!c.ok) {
      const motivo = c.motivo ?? "linha inválida";
      rejeitar("transacao", motivo, t.origem, normal);
      if (corrigivel(motivo))
        para_corrigir.push({ tipo: "transacao", original: t, motivo });
      continue;
    }
    const f = preencherTransacao(normal, ctx);
    candidatas.push({
      tipo: "transacao",
      original: t,
      dados: f.dados,
      preenchidos: f.preenchidos,
      origem: t.origem,
      confianca: c.confianca,
      avisos: c.avisos,
      nota: texto(t.nota) || null,
      motivo: null,
    });
  }
  for (const p of saida.proventos) {
    const normal: ProventoDaIA = {
      ...p,
      data_pagamento: data(texto(p.data_pagamento)),
      ticker: ticker(texto(p.ticker)),
      quantidade: numero(texto(p.quantidade)),
      valor_por_cota: numero(texto(p.valor_por_cota)),
      valor_total: numero(texto(p.valor_total)),
    };
    const { dados, aviso } = proventoComoTransacao(normal);
    const c = conferirOrigem(
      fontes,
      p.origem,
      p.confianca,
      [
        { campo: "quantidade", valor: normal.quantidade },
        { campo: "valor_por_cota", valor: normal.valor_por_cota },
        { campo: "valor_total", valor: normal.valor_total },
      ],
      { grafias: [texto(normal.ticker)], rotulo: `ticker ${texto(normal.ticker)}` },
    );
    if (!c.ok) {
      const motivo = c.motivo ?? "linha inválida";
      rejeitar("provento", motivo, p.origem, dados);
      if (corrigivel(motivo))
        para_corrigir.push({ tipo: "provento", original: p, motivo });
      continue;
    }
    const f = preencherTransacao(dados, ctx);
    candidatas.push({
      tipo: "provento",
      original: p,
      dados: f.dados,
      preenchidos: f.preenchidos,
      origem: p.origem,
      confianca: c.confianca,
      avisos: aviso ? [...c.avisos, aviso] : c.avisos,
      nota: null,
      motivo: null,
    });
  }

  const notas = saida.notas.map((n) => {
    const operacoes = candidatas.filter(
      (c) => c.nota !== null && compacto(c.nota) === compacto(n.numero),
    );
    const r = ratearNota(n, operacoes, fontes.numerosDoDocumento);
    for (const op of operacoes) {
      // Taxa da nota foi rateada pelo Bolsiq: nao e preenchimento.
      op.preenchidos = op.preenchidos.filter((c) => c !== "taxas");
      if (!r.conciliada) op.avisos.push(`Nota ${n.numero} não conciliada: ${r.motivo}.`);
      // Data do pregao vale para todos os negocios da nota.
      if (!op.dados.data && n.data_pregao) op.dados.data = data(n.data_pregao);
    }
    return r;
  });
  const notaConciliada = new Map(notas.map((n) => [compacto(n.numero), n.conciliada]));
  for (const c of candidatas)
    if (c.nota !== null && !notaConciliada.has(compacto(c.nota)))
      c.avisos.push(`Nota ${c.nota} sem o resumo financeiro: taxas não rateadas.`);

  const csv = importarCsvBolsiq(
    csvDeTransacoes(
      COLUNAS_BOLSIQ,
      candidatas.map((c) => c.dados),
    ),
  );
  for (const r of csv.rejeicoes) {
    const c = candidatas[r.linha - 2];
    if (c) c.motivo = r.motivo;
  }
  for (const c of candidatas) {
    if (c.motivo !== null) continue;
    const tk = c.dados.ticker ?? "";
    const dia = c.dados.data ?? "";
    if (c.tipo === "provento" && dia > o.hoje) {
      c.a_receber = true;
      c.avisos.push(
        `Provento provisionado, pagamento previsto em ${dia.split("-").reverse().join("/")}: não entra na carteira até ser pago. Importe o extrato depois do pagamento.`,
      );
    } else if (dia > o.hoje) c.motivo = `data: ${dia} no futuro`;
    else if (existentes && !existentes.has(tk))
      c.motivo = `ticker: ${tk} não existe no market-data`;
    else if (c.tipo === "transacao" && existentes) {
      const faixa = await verificador.faixaDoDia(tk, dia).catch(() => null);
      const preco = lerValor(c.dados.preco ?? "");
      if (faixa === null)
        c.avisos.push(`Sem cotação de ${tk} em ${dia} para conferir o preço.`);
      else if (preco && (preco.lt(faixa.minima) || preco.gt(faixa.maxima)))
        c.motivo = `preco: ${preco.toFixed(2)} fora da faixa do dia (${faixa.minima} a ${faixa.maxima})`;
    }
  }
  for (const c of candidatas) {
    const ajuste = c.motivo !== null;
    if (ajuste && c.motivo && corrigivel(c.motivo))
      para_corrigir.push({ tipo: c.tipo, original: c.original, motivo: c.motivo });
    const notaOk = c.nota === null || notaConciliada.get(compacto(c.nota)) === true;
    const grupo = c.a_receber ? "a_receber" : grupoDe(c.preenchidos, ajuste);
    linhas.push({
      id: novoId(c.tipo),
      tipo: c.tipo,
      grupo,
      dados: c.dados,
      origem: recorte(c.origem),
      confianca: c.confianca,
      marcada:
        grupo !== "ajuste" && grupo !== "a_receber" && c.confianca !== "baixa" && notaOk,
      preenchidos: c.preenchidos,
      problemas: c.motivo ? [campoDoMotivo(c.motivo) ?? ""].filter(Boolean) : [],
      motivo: c.motivo,
      avisos: c.avisos,
    });
  }

  return {
    documento: {
      tipo: saida.documento.tipo,
      corretora: saida.documento.corretora || null,
      data_referencia: saida.documento.data_referencia || null,
      totais_declarados: totais,
    },
    linhas,
    rejeicoes,
    pendencias: relatorio.pendencias,
    conciliacao,
    notas,
    // Sem total no documento nao bloqueia: so divergencia pede aceite.
    conciliada:
      conciliacao.every((c) => c.situacao !== "divergente") &&
      notas.every((n) => n.conciliada),
    para_corrigir,
    avisos,
  };
}

/**
 * Linhas que o usuario editou na revisao, antes de gravar. Sem o documento: vale
 * o que nao depende dele (layout, data, ticker e faixa do dia). O trecho de
 * origem ja foi conferido na extracao; a edicao e decisao do usuario.
 */
export async function validarLinhasEditadas(
  linhas: { tipo: TipoDeLinha; dados: Record<string, string> }[],
  verificador: Verificador,
  o: { hoje: string },
): Promise<{ rejeicoes: { motivo: string }[] }> {
  const rejeicoes: { motivo: string }[] = [];
  const posicoes = linhas.filter((l) => l.tipo === "posicao").map((l) => l.dados);
  const transacoes = linhas.filter((l) => l.tipo !== "posicao").map((l) => l.dados);

  const rp = posicoes.length
    ? importarPosicaoBolsiq(csvDePosicoes(COLUNAS_POSICAO, posicoes))
    : null;
  const rt = transacoes.length
    ? importarCsvBolsiq(csvDeTransacoes(COLUNAS_BOLSIQ, transacoes))
    : null;
  for (const r of [...(rp?.rejeicoes ?? []), ...(rt?.rejeicoes ?? [])])
    rejeicoes.push({ motivo: `linha ${r.linha - 1}: ${r.motivo}` });

  const comTicker = (rp?.posicoes ?? []).filter((p) =>
    CLASSES_COM_TICKER.includes(p.classe),
  );
  const tickers = [
    ...new Set([
      ...comTicker.map((p) => p.codigo ?? ""),
      ...(rt?.transacoes ?? []).map((t) => t.ticker),
    ]),
  ];
  const existentes = tickers.length
    ? await verificador.tickersExistentes(tickers).catch(() => null)
    : null;
  for (const p of rp?.posicoes ?? []) {
    if (p.data_posicao > o.hoje) rejeicoes.push({ motivo: `${p.ativo}: data no futuro` });
  }
  for (const t of tickers)
    if (existentes && !existentes.has(t))
      rejeicoes.push({ motivo: `ticker ${t} não existe no market-data` });
  for (const t of rt?.transacoes ?? []) {
    if (t.data > o.hoje)
      rejeicoes.push({ motivo: `${t.ticker}: data ${t.data} no futuro` });
    if (!existentes || (t.tipo !== "compra" && t.tipo !== "venda")) continue;
    const faixa = await verificador.faixaDoDia(t.ticker, t.data).catch(() => null);
    if (
      faixa &&
      (new Decimal(t.preco).lt(faixa.minima) || new Decimal(t.preco).gt(faixa.maxima))
    )
      rejeicoes.push({
        motivo: `${t.ticker}: preço ${t.preco} fora da faixa de ${t.data} (${faixa.minima} a ${faixa.maxima})`,
      });
  }
  return { rejeicoes };
}
