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
  tolerancia?: number;
  /** Origens sem texto (pagina escaneada, imagem): conferidas so pelo trecho. */
  sem_texto?: string[];
}

export type TipoDeLinha = "posicao" | "transacao" | "provento";

export interface LinhaProposta {
  id: string;
  tipo: TipoDeLinha;
  /** Campos no layout de destino, como texto: o que a tela edita e devolve. */
  dados: Record<string, string>;
  origem: Origem;
  confianca: Confianca;
  /** Vem marcada para importar? Confianca baixa ou carga nao conciliada vem desmarcada. */
  marcada: boolean;
  avisos: string[];
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
  conciliacao: ConciliacaoDaCorretora[];
  notas: ConciliacaoDaNota[];
  /** Tudo conciliado: posicao contra os totais e cada nota contra o liquido. */
  conciliada: boolean;
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
  dados: Record<string, string>;
  origem: Origem;
  confianca: Confianca;
  avisos: string[];
  nota: string | null;
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

/** PETR4F e PETR4: o F do fracionario nao e parte do ticker. */
const semFracionario = (t: string) =>
  t.toUpperCase().replace(/^(.{4,11}\d{1,2})F$/, "$1");

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

/**
 * Passa a proposta do modelo pelos validadores de sempre e pelas conferencias da
 * IA. Nada aqui grava: o resultado vai para a tela de revisao.
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
  const fontes = new Fontes(
    partes,
    new Set((o.sem_texto ?? []).map((s) => s.toLowerCase())),
  );
  const rejeicoes: RejeicaoDaIA[] = [];
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

  // Total declarado que nao esta no documento foi inventado: sai da conciliacao.
  // Linha de bloco CSV que nao se leu: rejeicao com o motivo, como no CSV de sempre.
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

  // Documento todo em imagem nao tem texto para conferir: o total fica, com aviso.
  const semTextoNenhum = fontes.numerosDoDocumento.length === 0;
  if (semTextoNenhum && saida.documento.totais_declarados.length > 0)
    avisos.push("Totais lidos de imagem: confira com o documento.");
  const totais = saida.documento.totais_declarados.filter((t) => {
    if (semTextoNenhum || aparece(t.valor, fontes.numerosDoDocumento)) return true;
    rejeitar("total", `total declarado ${t.valor} não aparece no documento`, null, t);
    return false;
  });

  // Posicoes: origem, depois os validadores do layout posicao_bolsiq.
  const posicoesConferidas: { p: PosicaoDaIA; c: Conferida }[] = [];
  for (const p of saida.posicoes) {
    const c = conferirPosicao(fontes, p);
    if (c.ok) posicoesConferidas.push({ p, c });
    else rejeitar("posicao", c.motivo ?? "linha inválida", p.origem, dadosDaPosicao(p));
  }
  const relatorio = importarPosicaoBolsiq(
    csvDePosicoes(
      COLUNAS_POSICAO,
      posicoesConferidas.map(({ p }) => dadosDaPosicao(p)),
    ),
  );
  for (const r of relatorio.rejeicoes) {
    const item = posicoesConferidas[r.linha - 2];
    rejeitar(
      "posicao",
      r.motivo,
      item?.p.origem ?? null,
      item ? dadosDaPosicao(item.p) : r.conteudo,
    );
  }

  const verificaveis = new Set<string>(
    [
      ...relatorio.posicoes
        .filter((p) => CLASSES_COM_TICKER.includes(p.classe))
        .map((p) => p.codigo ?? ""),
      ...saida.transacoes.map((t) => semFracionario(texto(t.ticker))),
      ...saida.proventos.map((p) => texto(p.ticker).toUpperCase()),
    ].filter(Boolean),
  );
  const existentes = await verificador
    .tickersExistentes([...verificaveis])
    .catch(() => null);
  if (existentes === null && verificaveis.size > 0)
    avisos.push("Market-data indisponível: tickers e preços não foram conferidos.");

  const conciliacao = relatorio.totais_por_corretora.map((t) =>
    conciliar(
      t.corretora,
      relatorio.posicoes
        .filter((p) => p.corretora === t.corretora)
        .map((p) => p.saldo_bruto),
      totais,
      tolerancia,
    ),
  );
  const conciliadaDe = new Map(conciliacao.map((c) => [c.corretora, c.conciliada]));

  const linhas: LinhaProposta[] = [];
  for (const p of relatorio.posicoes) {
    const item = posicoesConferidas[p.linha - 2];
    if (!item) continue;
    const dados = dadosDaPosicao(item.p);
    if (p.data_posicao > o.hoje) {
      rejeitar(
        "posicao",
        `data_posicao ${p.data_posicao} no futuro`,
        item.p.origem,
        dados,
      );
      continue;
    }
    if (
      existentes &&
      CLASSES_COM_TICKER.includes(p.classe) &&
      !existentes.has(p.codigo ?? "")
    ) {
      rejeitar(
        "posicao",
        `ticker ${p.codigo} não existe no market-data`,
        item.p.origem,
        dados,
      );
      continue;
    }
    const pendencias = relatorio.pendencias
      .filter((x) => x.linha === p.linha)
      .map((x) => x.motivo);
    linhas.push({
      id: novoId("posicao"),
      tipo: "posicao",
      dados,
      origem: recorte(item.p.origem),
      confianca: item.c.confianca,
      marcada: item.c.confianca !== "baixa" && conciliadaDe.get(p.corretora) === true,
      avisos: [...item.c.avisos, ...pendencias],
    });
  }

  // Transacoes e proventos: origem primeiro, depois rateio das notas.
  const candidatas: Candidata[] = [];
  for (const t of saida.transacoes) {
    const c = conferirTransacao(fontes, t);
    const dados = Object.fromEntries(COLUNAS_BOLSIQ.map((k) => [k, texto(t[k])]));
    dados.ticker = semFracionario(dados.ticker ?? "");
    if (!c.ok) {
      rejeitar("transacao", c.motivo ?? "linha inválida", t.origem, dados);
      continue;
    }
    candidatas.push({
      tipo: "transacao",
      dados,
      origem: t.origem,
      confianca: c.confianca,
      avisos: c.avisos,
      nota: texto(t.nota) || null,
    });
  }
  for (const p of saida.proventos) {
    const { dados, aviso } = proventoComoTransacao(p);
    const c = conferirOrigem(
      fontes,
      p.origem,
      p.confianca,
      [
        { campo: "quantidade", valor: p.quantidade },
        { campo: "valor_por_cota", valor: p.valor_por_cota },
        { campo: "valor_total", valor: p.valor_total },
      ],
      { grafias: [texto(p.ticker)], rotulo: `ticker ${texto(p.ticker)}` },
    );
    if (!c.ok) {
      rejeitar("provento", c.motivo ?? "linha inválida", p.origem, dados);
      continue;
    }
    candidatas.push({
      tipo: "provento",
      dados,
      origem: p.origem,
      confianca: c.confianca,
      avisos: aviso ? [...c.avisos, aviso] : c.avisos,
      nota: null,
    });
  }

  const notas = saida.notas.map((n) => {
    const operacoes = candidatas.filter(
      (c) => c.nota !== null && compacto(c.nota) === compacto(n.numero),
    );
    const r = ratearNota(n, operacoes, fontes.numerosDoDocumento);
    for (const op of operacoes) {
      if (!r.conciliada) op.avisos.push(`Nota ${n.numero} não conciliada: ${r.motivo}.`);
      // Data do pregao vale para todos os negocios da nota.
      if (!op.dados.data && n.data_pregao) op.dados.data = n.data_pregao;
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
  const rejeitadas = new Set(csv.rejeicoes.map((r) => r.linha));
  for (const r of csv.rejeicoes) {
    const c = candidatas[r.linha - 2];
    rejeitar(c?.tipo ?? "transacao", r.motivo, c?.origem ?? null, c?.dados ?? r.conteudo);
  }
  for (const [i, c] of candidatas.entries()) {
    if (rejeitadas.has(i + 2)) continue;
    const ticker = c.dados.ticker ?? "";
    const data = c.dados.data ?? "";
    if (data > o.hoje) {
      rejeitar(c.tipo, `data ${data} no futuro`, c.origem, c.dados);
      continue;
    }
    if (existentes && !existentes.has(ticker)) {
      rejeitar(c.tipo, `ticker ${ticker} não existe no market-data`, c.origem, c.dados);
      continue;
    }
    if (c.tipo === "transacao" && existentes) {
      const faixa = await verificador.faixaDoDia(ticker, data).catch(() => null);
      const preco = lerValor(c.dados.preco ?? "");
      if (faixa === null)
        c.avisos.push(`Sem cotação de ${ticker} em ${data} para conferir o preço.`);
      else if (preco && (preco.lt(faixa.minima) || preco.gt(faixa.maxima))) {
        rejeitar(
          c.tipo,
          `preço ${preco.toFixed(2)} fora da faixa do dia (${faixa.minima} a ${faixa.maxima})`,
          c.origem,
          c.dados,
        );
        continue;
      }
    }
    const notaOk = c.nota === null || notaConciliada.get(compacto(c.nota)) === true;
    linhas.push({
      id: novoId(c.tipo),
      tipo: c.tipo,
      dados: c.dados,
      origem: recorte(c.origem),
      confianca: c.confianca,
      marcada: c.confianca !== "baixa" && notaOk,
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
    conciliada:
      conciliacao.every((c) => c.conciliada) && notas.every((n) => n.conciliada),
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
