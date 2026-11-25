/**
 * Fixtures do eval da leitura de faturas e extratos do Bolsiq Financas (ADR 0040).
 * Anonimas por construcao: titular, cartao, estabelecimentos e valores sao
 * inventados, no desenho da fatura de cada banco. O PDF e gerado no teste (pdf.ts)
 * a partir das mesmas linhas da resposta gravada: o que o atalho le e o que um
 * modelo correto devolveria sao a mesma coisa.
 *
 * - Nubank, Itau, Inter (com senha) e C6: layout conhecido (atalho sem IA) e,
 *   com `sem_atalho`, a IA no mesmo documento;
 * - Santander (fatura) e Bradesco (extrato de conta): so pela IA.
 */
import type {
  DocumentoFinancas,
  LancamentoDaIA,
  SaidaDaIA,
} from "../../src/importacao/esquema.js";
import { saidaVazia } from "../../src/importacao/esquema.js";
import type { Entrada } from "../../src/importacao/pipeline.js";
import { pdfDeTexto, type LinhaDoPdf } from "./pdf.js";

/** Uma linha da fatura: como esta no PDF e o que a revisao precisa mostrar. */
interface Linha {
  /** Como no documento: "05 OUT", "05/10", "05/10/2026". */
  dia: string;
  descricao: string;
  /** Como no documento: "R$ 23,50", "-R$ 49,90", "+ R$ 500,00", "58,10". */
  valor: string;
  moeda?: string;
  /** Esperado. */
  data: string;
  sentido: "debito" | "credito";
  marcacao?: "pagamento" | "estorno" | "saldo_anterior" | "iof";
  parcela?: [number, number];
}

export interface FixtureDeFinancas {
  id: string;
  banco: string;
  descricao: string;
  arquivo: () => Entrada;
  /** O que um modelo correto devolve (e o atalho le, quando ha layout). */
  resposta: SaidaDaIA;
  /** Lida pelo layout conhecido, sem IA. */
  layout: boolean;
  senha?: string;
  decifrado?: () => Uint8Array;
  esperado: {
    linhas: {
      data: string;
      valor: string;
      sentido: "debito" | "credito";
      marcacao: string | null;
      parcela: [number, number] | null;
    }[];
    /** null: extrato, sem total para conferir. */
    total_confere: boolean | null;
  };
}

const valorDe = (v: string) =>
  v
    .replace(/[^\d,]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");

/** A linha como o pdf.js monta: colunas com mais de 12 pt de distancia viram " | ". */
const comoNoPdf = (l: Linha) =>
  [l.dia, l.descricao, l.moeda, l.valor].filter(Boolean).join(" | ");

const colunasDoPdf = (l: Linha): LinhaDoPdf => [
  l.dia,
  l.descricao,
  "",
  l.moeda ?? "",
  l.valor,
];

function montar(
  id: string,
  banco: string,
  descricao: string,
  nome: string,
  cabecalho: LinhaDoPdf[],
  linhas: Linha[],
  documento: DocumentoFinancas,
  o: { layout: boolean; senha?: string; rodape?: LinhaDoPdf[] },
): FixtureDeFinancas {
  // Pagina 1: o cabecalho; pagina 2: os lancamentos (e o rodape).
  const paginas: LinhaDoPdf[][] = [
    cabecalho,
    [...linhas.map(colunasDoPdf), ...(o.rodape ?? [])],
  ];
  const lancamentos: LancamentoDaIA[] = linhas.map((l) => ({
    data: l.data,
    descricao: l.descricao.replace(/\s*-?\s*Parcela \d+\/\d+$/i, ""),
    valor: valorDe(l.valor),
    sinal: l.sentido,
    parcela_atual: l.parcela ? String(l.parcela[0]) : "",
    parcela_total: l.parcela ? String(l.parcela[1]) : "",
    moeda_original: l.moeda ? (l.moeda.startsWith("USD") ? "USD" : "EUR") : "",
    valor_moeda_original: l.moeda ? valorDe(l.moeda) : "",
    origem: { pagina_ou_aba: "página 2", trecho_original: comoNoPdf(l) },
    confianca: "alta",
  }));
  return {
    id,
    banco,
    descricao,
    layout: o.layout,
    ...(o.senha ? { senha: o.senha, decifrado: () => pdfDeTexto(paginas) } : {}),
    arquivo: () => ({
      nome,
      mime: "application/pdf",
      bytes: pdfDeTexto(paginas, o.senha),
    }),
    resposta: {
      ...saidaVazia(),
      documento: {
        tipo: documento.tipo,
        corretora: documento.banco,
        data_referencia: documento.data_vencimento || documento.periodo_fim,
        totais_declarados: documento.total_fatura
          ? [{ descricao: "total da fatura", valor: documento.total_fatura }]
          : [],
        financas: documento,
      },
      lancamentos,
    },
    esperado: {
      linhas: linhas.map((l) => ({
        data: l.data,
        valor: valorDe(l.valor),
        sentido: l.sentido,
        marcacao: l.marcacao ?? null,
        parcela: l.parcela ?? null,
      })),
      total_confere: documento.tipo === "fatura_cartao" ? true : null,
    },
  };
}

const fatura = (
  banco: string,
  vencimento: string,
  fechamento: string,
  total: string,
  final = "",
): DocumentoFinancas => ({
  banco,
  tipo: "fatura_cartao",
  final_cartao: final,
  data_fechamento: fechamento,
  data_vencimento: vencimento,
  total_fatura: total,
  periodo_inicio: "",
  periodo_fim: "",
});

// Nubank ----------------------------------------------------------------------

const NUBANK: Linha[] = [
  {
    dia: "05 OUT",
    descricao: "Padaria Pao Quente",
    valor: "R$ 23,50",
    data: "2026-10-05",
    sentido: "debito",
  },
  {
    dia: "07 OUT",
    descricao: "Mercado Bom Preco",
    valor: "R$ 312,87",
    data: "2026-10-07",
    sentido: "debito",
  },
  {
    dia: "08 OUT",
    descricao: "Loja Exemplo - Parcela 2/6",
    valor: "R$ 150,00",
    data: "2026-10-08",
    sentido: "debito",
    parcela: [2, 6],
  },
  {
    dia: "10 OUT",
    descricao: "Amazon Web Services",
    moeda: "USD 10,00",
    valor: "R$ 58,10",
    data: "2026-10-10",
    sentido: "debito",
  },
  {
    dia: "10 OUT",
    descricao: "IOF de compra internacional",
    valor: "R$ 2,03",
    data: "2026-10-10",
    sentido: "debito",
    marcacao: "iof",
  },
  {
    dia: "12 OUT",
    descricao: "Pagamento recebido",
    valor: "-R$ 1.873,40",
    data: "2026-10-12",
    sentido: "credito",
    marcacao: "pagamento",
  },
  {
    dia: "14 OUT",
    descricao: "Estorno de Loja Exemplo",
    valor: "-R$ 49,90",
    data: "2026-10-14",
    sentido: "credito",
    marcacao: "estorno",
  },
  {
    dia: "20 OUT",
    descricao: "Posto Avenida",
    valor: "R$ 210,00",
    data: "2026-10-20",
    sentido: "debito",
  },
  {
    dia: "03 NOV",
    descricao: "Streaming Filmes",
    valor: "R$ 39,90",
    data: "2026-11-03",
    sentido: "debito",
  },
];

export const FATURA_NUBANK = montar(
  "nubank-fatura-pdf",
  "Nubank",
  "Fatura do cartão Nubank: datas DD MMM, compra internacional com IOF, parcela, pagamento e estorno",
  "Nubank_2026-11-15.pdf",
  [
    "Nu Pagamentos S.A. - Fatura do cartão de crédito",
    "Titular: Pessoa Exemplo da Silva",
    "Cartão final 4321",
    ["Data de vencimento:", "15 NOV 2026"],
    "Fechamento em 08 NOV 2026",
    ["Total a pagar", "R$ 746,50"],
  ],
  NUBANK,
  fatura("Nubank", "2026-11-15", "2026-11-08", "746.50", "4321"),
  { layout: true },
);

// Itau ------------------------------------------------------------------------

const ITAU: Linha[] = [
  {
    dia: "08/10",
    descricao: "SALDO ANTERIOR",
    valor: "1.200,00",
    data: "2026-10-08",
    sentido: "debito",
    marcacao: "saldo_anterior",
  },
  {
    dia: "09/10",
    descricao: "PAGAMENTO EFETUADO",
    valor: "-1.200,00",
    data: "2026-10-09",
    sentido: "credito",
    marcacao: "pagamento",
  },
  {
    dia: "11/10",
    descricao: "RESTAURANTE SABOR",
    valor: "87,40",
    data: "2026-10-11",
    sentido: "debito",
  },
  {
    dia: "13/10",
    descricao: "ELETRO CASA 03/10",
    valor: "299,90",
    data: "2026-10-13",
    sentido: "debito",
    parcela: [3, 10],
  },
  {
    dia: "15/10",
    descricao: "HOTEL LISBOA",
    moeda: "EUR 80,00",
    valor: "512,32",
    data: "2026-10-15",
    sentido: "debito",
  },
  {
    dia: "15/10",
    descricao: "HOTEL LISBOA",
    valor: "17,93",
    data: "2026-10-15",
    sentido: "debito",
    marcacao: "iof",
  },
  {
    dia: "28/10",
    descricao: "FARMACIA SAUDE",
    valor: "64,15",
    data: "2026-10-28",
    sentido: "debito",
  },
];

export const FATURA_ITAU = montar(
  "itau-fatura-pdf",
  "Itaú",
  "Fatura Itaú: saldo anterior e pagamento, parcela na descrição e IOF com o nome da compra em euro",
  "fatura-itau-novembro.pdf",
  [
    "Itaú Unibanco - Fatura do cartão Itaucard",
    ["Emissão:", "02/11/2026"],
    ["Vencimento:", "10/11/2026"],
    ["Total desta fatura", "981,70"],
  ],
  ITAU,
  fatura("Itaú", "2026-11-10", "2026-11-02", "981.70"),
  { layout: true },
);

// Inter (com senha) -----------------------------------------------------------

const INTER: Linha[] = [
  {
    dia: "05/10/2026",
    descricao: "PAGAMENTO ON LINE",
    valor: "+ R$ 640,00",
    data: "2026-10-05",
    sentido: "credito",
    marcacao: "pagamento",
  },
  {
    dia: "06/10/2026",
    descricao: "SUPERMERCADO CENTRAL",
    valor: "R$ 402,18",
    data: "2026-10-06",
    sentido: "debito",
  },
  {
    dia: "09/10/2026",
    descricao: "CURSO ONLINE PARC 04/12",
    valor: "R$ 89,00",
    data: "2026-10-09",
    sentido: "debito",
    parcela: [4, 12],
  },
  {
    dia: "21/10/2026",
    descricao: "UBER TRIP",
    valor: "R$ 31,72",
    data: "2026-10-21",
    sentido: "debito",
  },
];

export const FATURA_INTER = montar(
  "inter-fatura-pdf-senha",
  "Inter",
  "Fatura Inter com senha (dígitos do CPF): datas completas e crédito com +",
  "fatura-inter.pdf",
  [
    "Banco Inter - Fatura do cartão",
    ["Data de fechamento", "05/11/2026"],
    ["Data de vencimento", "15/11/2026"],
    ["Total da sua fatura", "R$ 522,90"],
  ],
  INTER,
  fatura("Inter", "2026-11-15", "2026-11-05", "522.90"),
  { layout: true, senha: "12345" },
);

// C6 --------------------------------------------------------------------------

const C6: Linha[] = [
  {
    dia: "30 out",
    descricao: "CLINICA SORRISO - Parcela 6/7",
    valor: "155,71",
    data: "2026-10-30",
    sentido: "debito",
    parcela: [6, 7],
  },
  {
    dia: "31 out",
    descricao: "ANUIDADE DIFERENCIADA",
    valor: "39,00",
    data: "2026-10-31",
    sentido: "debito",
  },
  {
    dia: "01 nov",
    descricao: "PADARIA DO BAIRRO",
    valor: "18,90",
    data: "2026-11-01",
    sentido: "debito",
  },
  {
    dia: "02 nov",
    descricao: "ESTORNO PADARIA DO BAIRRO",
    valor: "-18,90",
    data: "2026-11-02",
    sentido: "credito",
    marcacao: "estorno",
  },
];

export const FATURA_C6 = montar(
  "c6-fatura-pdf",
  "C6",
  "Fatura do C6 em PDF: datas DD mmm em minúsculas, parcela, anuidade e estorno",
  "Fatura_C6_2026-11-10.pdf",
  [
    "C6 Bank - Fatura do cartão C6 Carbon",
    ["Fechamento:", "03/11/2026"],
    ["Vencimento:", "10/11/2026"],
    ["Valor total da fatura:", "R$ 194,71"],
  ],
  C6,
  fatura("C6", "2026-11-10", "2026-11-03", "194.71"),
  { layout: true },
);

// Santander (so IA) -----------------------------------------------------------

const SANTANDER: Linha[] = [
  {
    dia: "02/10",
    descricao: "ACADEMIA FORMA",
    valor: "119,90",
    data: "2026-10-02",
    sentido: "debito",
  },
  {
    dia: "04/10",
    descricao: "NOTEBOOK LOJA PARC 01/05",
    valor: "780,00",
    data: "2026-10-04",
    sentido: "debito",
    parcela: [1, 5],
  },
  {
    dia: "06/10",
    descricao: "PAGAMENTO DE FATURA",
    valor: "-950,00",
    data: "2026-10-06",
    sentido: "credito",
    marcacao: "pagamento",
  },
  {
    dia: "18/10",
    descricao: "POSTO RODOVIA",
    valor: "185,30",
    data: "2026-10-18",
    sentido: "debito",
  },
];

export const FATURA_SANTANDER = montar(
  "santander-fatura-pdf",
  "Santander",
  "Fatura Santander: layout sem atalho, só pela IA",
  "Santander_Fatura.pdf",
  [
    "Santander - Resumo da fatura",
    ["Vencimento da fatura", "12/11/2026"],
    ["Saldo desta fatura", "R$ 1.085,20"],
  ],
  SANTANDER,
  fatura("Santander", "2026-11-12", "", "1085.20"),
  { layout: false },
);

// Bradesco: extrato de conta (so IA) -----------------------------------------

const BRADESCO: Linha[] = [
  {
    dia: "01/10/2026",
    descricao: "SALDO ANTERIOR",
    valor: "2.410,00",
    data: "2026-10-01",
    sentido: "credito",
    marcacao: "saldo_anterior",
  },
  {
    dia: "05/10/2026",
    descricao: "TRANSF PIX REM EMPRESA EXEMPLO",
    valor: "6.100,00",
    data: "2026-10-05",
    sentido: "credito",
  },
  {
    dia: "07/10/2026",
    descricao: "PAGTO ELETRON COBRANCA ENERGIA",
    valor: "-213,44",
    data: "2026-10-07",
    sentido: "debito",
  },
  {
    dia: "10/10/2026",
    descricao: "TARIFA BANCARIA CESTA",
    valor: "-39,90",
    data: "2026-10-10",
    sentido: "debito",
  },
];

export const EXTRATO_BRADESCO = montar(
  "bradesco-extrato-pdf",
  "Bradesco",
  "Extrato de conta Bradesco: saldo anterior marcado, sem total de fatura",
  "Bradesco_Extrato.pdf",
  ["Bradesco - Extrato de conta corrente", ["Período:", "01/10/2026 a 31/10/2026"]],
  BRADESCO,
  {
    banco: "Bradesco",
    tipo: "extrato_conta",
    final_cartao: "",
    data_fechamento: "",
    data_vencimento: "",
    total_fatura: "",
    periodo_inicio: "2026-10-01",
    periodo_fim: "2026-10-31",
  },
  { layout: false },
);

export const FIXTURES_DE_FINANCAS: FixtureDeFinancas[] = [
  FATURA_NUBANK,
  FATURA_ITAU,
  FATURA_INTER,
  FATURA_C6,
  FATURA_SANTANDER,
  EXTRATO_BRADESCO,
];
