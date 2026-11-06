import { randomUUID } from "node:crypto";
import { Transacao, TipoDeTransacao } from "./tipos.js";
import type { Transacao as TTransacao } from "./tipos.js";

export interface LinhaRejeitada {
  linha: number;
  motivo: string;
  conteudo: string;
}

export interface RelatorioDeImportacao {
  transacoes: TTransacao[];
  rejeicoes: LinhaRejeitada[];
  linhas_lidas: number;
  duracao_ms: number;
}

/** Cabecalho do layout proprio, documentado em docs/services/portfolio.md. */
export const COLUNAS_BOLSIQ = [
  "data",
  "ticker",
  "tipo",
  "quantidade",
  "preco",
  "taxas",
  "corretora",
] as const;

/**
 * Le o layout proprio: CSV com cabecalho, `;` ou `,` como separador.
 *
 * Nao para na primeira linha ruim. Uma planilha de 500 linhas com tres datas
 * digitadas errado deve importar 497 e dizer quais tres falharam -- abortar
 * tudo obriga o usuario a caçar o erro sem ajuda.
 */
export function importarCsvBolsiq(conteudo: string): RelatorioDeImportacao {
  const inicio = Date.now();
  const linhas = conteudo.split(/\r?\n/).filter((l) => l.trim() !== "");
  const transacoes: TTransacao[] = [];
  const rejeicoes: LinhaRejeitada[] = [];

  if (linhas.length === 0) {
    return { transacoes, rejeicoes, linhas_lidas: 0, duracao_ms: Date.now() - inicio };
  }

  const separador = detectarSeparador(linhas[0] ?? "");
  const cabecalho = dividir(linhas[0] ?? "", separador).map((c) =>
    c.trim().toLowerCase(),
  );
  const indice = indicesDoCabecalho(cabecalho);

  if (typeof indice === "string") {
    return {
      transacoes,
      rejeicoes: [{ linha: 1, motivo: indice, conteudo: linhas[0] ?? "" }],
      linhas_lidas: linhas.length - 1,
      duracao_ms: Date.now() - inicio,
    };
  }

  for (let i = 1; i < linhas.length; i++) {
    const bruta = linhas[i] ?? "";
    const campos = dividir(bruta, separador);

    const candidato = {
      id: randomUUID(),
      data: normalizarData(campos[indice.data] ?? ""),
      ticker: (campos[indice.ticker] ?? "").trim().toUpperCase(),
      tipo: (campos[indice.tipo] ?? "").trim().toLowerCase(),
      quantidade: normalizarNumero(campos[indice.quantidade] ?? ""),
      preco: normalizarNumero(campos[indice.preco] ?? ""),
      taxas:
        indice.taxas === undefined ? "0" : normalizarNumero(campos[indice.taxas] ?? "0"),
      ...(indice.corretora !== undefined && campos[indice.corretora]?.trim()
        ? { corretora: campos[indice.corretora]?.trim() }
        : {}),
    };

    const validado = Transacao.safeParse(candidato);
    if (validado.success) {
      transacoes.push(validado.data);
    } else {
      const primeiro = validado.error.issues[0];
      rejeicoes.push({
        linha: i + 1,
        motivo: primeiro
          ? `${primeiro.path.join(".") || "linha"}: ${primeiro.message}`
          : "linha invalida",
        conteudo: bruta,
      });
    }
  }

  return {
    transacoes,
    rejeicoes,
    linhas_lidas: linhas.length - 1,
    duracao_ms: Date.now() - inicio,
  };
}

export function detectarSeparador(cabecalho: string): string {
  // Conta no cabecalho, nao numa linha de dados: valor em pt-BR usa virgula
  // decimal, e contar virgulas num numero detectaria o separador errado.
  return (cabecalho.match(/;/g)?.length ?? 0) >= (cabecalho.match(/,/g)?.length ?? 0)
    ? ";"
    : ",";
}

function dividir(linha: string, separador: string): string[] {
  return linha.split(separador).map((c) => c.replace(/^"|"$/g, ""));
}

interface Indices {
  data: number;
  ticker: number;
  tipo: number;
  quantidade: number;
  preco: number;
  taxas?: number;
  corretora?: number;
}

function indicesDoCabecalho(cabecalho: string[]): Indices | string {
  const achar = (nome: string) => cabecalho.indexOf(nome);
  const obrigatorias = ["data", "ticker", "tipo", "quantidade", "preco"] as const;
  const faltando = obrigatorias.filter((c) => achar(c) === -1);

  if (faltando.length > 0) {
    return `cabecalho sem as colunas: ${faltando.join(", ")}`;
  }

  const taxas = achar("taxas");
  const corretora = achar("corretora");

  return {
    data: achar("data"),
    ticker: achar("ticker"),
    tipo: achar("tipo"),
    quantidade: achar("quantidade"),
    preco: achar("preco"),
    ...(taxas === -1 ? {} : { taxas }),
    ...(corretora === -1 ? {} : { corretora }),
  };
}

/** Aceita YYYY-MM-DD e DD/MM/YYYY. O segundo e o que a B3 e o Excel exportam. */
export function normalizarData(valor: string): string {
  const texto = valor.trim();
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto);
  return br ? `${br[3]}-${br[2]}-${br[1]}` : texto;
}

/**
 * Normaliza numero em pt-BR para string decimal.
 *
 * "1.234,56" vira "1234.56". A ordem importa: remover o ponto de milhar antes
 * de trocar a virgula decimal. Na ordem inversa, "1.234,56" viraria "1.234.56".
 */
export function normalizarNumero(valor: string): string {
  const texto = valor.trim().replace(/\s/g, "");
  if (texto === "") return "0";

  if (texto.includes(",")) {
    return texto.replace(/\./g, "").replace(",", ".");
  }
  return texto;
}

/**
 * Le o extrato de negociacao exportado da area do investidor da B3.
 *
 * O arquivo tem cabecalho proprio e usa "Debito"/"Credito" em vez de
 * compra/venda. Mapeia para o layout interno e delega a validacao.
 */
export function importarExtratoB3(conteudo: string): RelatorioDeImportacao {
  const inicio = Date.now();
  const linhas = conteudo.split(/\r?\n/).filter((l) => l.trim() !== "");

  if (linhas.length <= 1) {
    return {
      transacoes: [],
      rejeicoes: [],
      linhas_lidas: 0,
      duracao_ms: Date.now() - inicio,
    };
  }

  const separador = detectarSeparador(linhas[0] ?? "");
  const cabecalho = dividir(linhas[0] ?? "", separador).map((c) =>
    c.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""),
  );

  const col = (nomes: string[]) => {
    for (const n of nomes) {
      const i = cabecalho.findIndex((c) => c.includes(n));
      if (i !== -1) return i;
    }
    return -1;
  };

  const iData = col(["data do negocio", "data"]);
  const iTipo = col(["tipo de movimentacao", "tipo"]);
  const iTicker = col(["codigo de negociacao", "codigo", "ticker"]);
  const iQtd = col(["quantidade"]);
  const iPreco = col(["preco", "preco unitario"]);

  if ([iData, iTipo, iTicker, iQtd, iPreco].some((i) => i === -1)) {
    return {
      transacoes: [],
      rejeicoes: [
        {
          linha: 1,
          motivo: "cabecalho nao parece ser do extrato da B3",
          conteudo: linhas[0] ?? "",
        },
      ],
      linhas_lidas: linhas.length - 1,
      duracao_ms: Date.now() - inicio,
    };
  }

  const cabecalhoInterno = "data;ticker;tipo;quantidade;preco";
  const convertidas: string[] = [cabecalhoInterno];
  const rejeicoes: LinhaRejeitada[] = [];

  for (let i = 1; i < linhas.length; i++) {
    const campos = dividir(linhas[i] ?? "", separador);
    const bruto = (campos[iTipo] ?? "").trim().toLowerCase();
    const tipo = bruto.startsWith("c")
      ? "compra"
      : bruto.startsWith("v")
        ? "venda"
        : null;

    if (tipo === null) {
      rejeicoes.push({
        linha: i + 1,
        motivo: `tipo de movimentacao nao reconhecido: "${campos[iTipo] ?? ""}"`,
        conteudo: linhas[i] ?? "",
      });
      continue;
    }

    convertidas.push(
      [
        campos[iData] ?? "",
        // O extrato traz "PETR4F" no fracionario; o F nao e parte do ticker.
        (campos[iTicker] ?? "").trim().toUpperCase().replace(/F$/, ""),
        tipo,
        campos[iQtd] ?? "",
        campos[iPreco] ?? "",
      ].join(";"),
    );
  }

  const relatorio = importarCsvBolsiq(convertidas.join("\n"));

  return {
    transacoes: relatorio.transacoes,
    // Renumera: a linha do relatorio interno nao corresponde a do arquivo.
    rejeicoes: [...rejeicoes, ...relatorio.rejeicoes],
    linhas_lidas: linhas.length - 1,
    duracao_ms: Date.now() - inicio,
  };
}

export const TIPOS_ACEITOS = TipoDeTransacao.options;
