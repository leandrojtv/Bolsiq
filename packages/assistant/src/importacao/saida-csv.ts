import { detectarSeparador, dividirCsv, normalizarData } from "@bolsiq/portfolio";
import {
  COLUNAS_DO_BLOCO,
  TIPOS_DE_BLOCO,
  type Confianca,
  type NotaDaIA,
  type PosicaoDaIA,
  type ProventoDaIA,
  type SaidaDaIA,
  type TipoDeBloco,
  type TransacaoDaIA,
} from "./esquema.js";

/**
 * Le a resposta do modelo: blocos ```csv <tipo>``` com as linhas de cada tipo.
 * Texto em CSV, nao JSON estruturado: o schema estrito compila uma gramatica que
 * passa do limite dos provedores (ADR 0026, Revisao), e CSV e o layout que o
 * Bolsiq ja le. O resultado e a `SaidaDaIA` interna, sem o documento.
 */

export interface BlocoCsv {
  /** Tipo da cerca ou, sem ele, deduzido do cabecalho. Nulo: nao deu para saber. */
  tipo: TipoDeBloco | null;
  conteudo: string;
}

export type SaidaDasLinhas = Omit<SaidaDaIA, "documento" | "avisos" | "lotes_falhos">;

export interface LeituraDaResposta {
  saida: SaidaDasLinhas;
  /** Blocos com cabecalho que nao e o do formato: pedem uma nova tentativa. */
  cabecalhos_invalidos: { tipo: string; motivo: string }[];
  /** Algum bloco CSV na resposta. Sem nenhum, o lote nao tinha dados. */
  blocos: number;
}

/** Cercas ```csv posicoes ... ```, ```csv ... ``` ou ``` ... ```; a ultima pode vir aberta. */
const CERCA = /```[ \t]*([A-Za-z]*)[ \t]*([A-Za-z_]*)[ \t]*\r?\n([\s\S]*?)(?:```|$)/g;

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** O tipo pelo cabecalho, quando a cerca nao diz. */
export function tipoPeloCabecalho(cabecalho: string): TipoDeBloco | null {
  const c = semAcento(cabecalho);
  if (c.includes("data_posicao")) return "posicoes";
  if (c.includes("valor_liquido") && c.includes("numero")) return "notas";
  if (c.includes("data_pagamento")) return "proventos";
  if (c.includes("ticker") && c.includes("preco")) return "transacoes";
  return null;
}

export function extrairBlocos(resposta: string): BlocoCsv[] {
  const blocos: BlocoCsv[] = [];
  for (const m of resposta.matchAll(CERCA)) {
    const linguagem = (m[1] ?? "").toLowerCase();
    const nome = (m[2] ?? "").toLowerCase();
    const conteudo = (m[3] ?? "").trim();
    // Cerca de outra linguagem (```json) nao e bloco de linhas.
    if (
      linguagem &&
      linguagem !== "csv" &&
      !TIPOS_DE_BLOCO.includes(linguagem as TipoDeBloco)
    )
      continue;
    if (!conteudo) continue;
    const declarado = [nome, linguagem].find((x) =>
      TIPOS_DE_BLOCO.includes(x as TipoDeBloco),
    );
    const tipo =
      (declarado as TipoDeBloco | undefined) ??
      tipoPeloCabecalho(conteudo.split(/\r?\n/, 1)[0] ?? "");
    blocos.push({ tipo, conteudo });
  }
  return blocos;
}

/** Linhas do bloco, juntando a que tem aspas abertas com a seguinte. */
function registros(conteudo: string): string[] {
  const saida: string[] = [];
  let atual = "";
  for (const linha of conteudo.split(/\r?\n/)) {
    atual = atual ? `${atual} ${linha}` : linha;
    if ((atual.match(/"/g)?.length ?? 0) % 2 === 0) {
      if (atual.trim()) saida.push(atual);
      atual = "";
    }
  }
  if (atual.trim()) saida.push(atual);
  return saida;
}

const CONFIANCAS: Record<string, Confianca> = {
  alta: "alta",
  media: "media",
  baixa: "baixa",
};
const confianca = (v: string): Confianca => CONFIANCAS[semAcento(v.trim())] ?? "baixa";

const vazia = (): SaidaDasLinhas => ({
  posicoes: [],
  transacoes: [],
  proventos: [],
  notas: [],
  malformadas: [],
});

/**
 * Le um bloco pelos nomes do cabecalho, em qualquer ordem. Coluna obrigatoria
 * faltando invalida o bloco; linha com colunas a mais ou a menos vira rejeicao
 * com o motivo, sem derrubar as outras.
 */
function lerBloco(
  bloco: BlocoCsv & { tipo: TipoDeBloco },
  saida: SaidaDasLinhas,
): string | null {
  const linhas = registros(bloco.conteudo);
  const primeira = linhas[0] ?? "";
  const separador = detectarSeparador(primeira);
  const cabecalho = dividirCsv(primeira, separador).map((c: string) =>
    semAcento(c.trim()),
  );
  const esperado = COLUNAS_DO_BLOCO[bloco.tipo] as readonly string[];
  const faltando = esperado.filter((c) => !cabecalho.includes(c));
  if (faltando.length > 0) return `cabeçalho sem as colunas: ${faltando.join(", ")}`;

  for (const bruta of linhas.slice(1)) {
    const campos = dividirCsv(bruta, separador);
    if (campos.length !== cabecalho.length) {
      saida.malformadas.push({
        tipo: bloco.tipo,
        motivo: `esperava ${cabecalho.length} colunas, veio ${campos.length}`,
        conteudo: bruta.slice(0, 300),
      });
      continue;
    }
    const v = (nome: string) => (campos[cabecalho.indexOf(nome)] ?? "").trim();
    const origem = {
      pagina_ou_aba: v("pagina_ou_aba"),
      trecho_original: v("trecho_original"),
    };
    switch (bloco.tipo) {
      case "posicoes":
        saida.posicoes.push({
          ...(Object.fromEntries(
            COLUNAS_DO_BLOCO.posicoes.slice(0, -3).map((c) => [c, v(c)]),
          ) as Omit<PosicaoDaIA, "origem" | "confianca">),
          origem,
          confianca: confianca(v("confianca")),
        });
        break;
      case "transacoes":
        saida.transacoes.push({
          ...(Object.fromEntries(
            COLUNAS_DO_BLOCO.transacoes.slice(0, -3).map((c) => [c, v(c)]),
          ) as Omit<TransacaoDaIA, "origem" | "confianca">),
          data: normalizarData(v("data")),
          origem,
          confianca: confianca(v("confianca")),
        });
        break;
      case "proventos":
        saida.proventos.push({
          ...(Object.fromEntries(
            COLUNAS_DO_BLOCO.proventos.slice(0, -3).map((c) => [c, v(c)]),
          ) as Omit<ProventoDaIA, "origem" | "confianca">),
          data_pagamento: normalizarData(v("data_pagamento")),
          origem,
          confianca: confianca(v("confianca")),
        });
        break;
      case "notas": {
        const sentido = semAcento(v("sentido_liquido"));
        saida.notas.push({
          numero: v("numero"),
          data_pregao: normalizarData(v("data_pregao")),
          corretora: v("corretora"),
          taxas_total: v("taxas_total"),
          irrf: v("irrf"),
          valor_liquido: v("valor_liquido"),
          sentido_liquido: sentido.startsWith("d")
            ? "debito"
            : sentido.startsWith("c")
              ? "credito"
              : "",
          origem,
        } satisfies NotaDaIA);
        break;
      }
    }
  }
  return null;
}

/** A resposta inteira de um lote: texto fora dos blocos e ignorado. */
export function lerResposta(resposta: string): LeituraDaResposta {
  const saida = vazia();
  const cabecalhos_invalidos: LeituraDaResposta["cabecalhos_invalidos"] = [];
  const blocos = extrairBlocos(resposta);
  for (const b of blocos) {
    if (b.tipo === null) {
      cabecalhos_invalidos.push({
        tipo: "?",
        motivo: `bloco sem tipo e com cabeçalho desconhecido: ${b.conteudo.split("\n", 1)[0]?.slice(0, 120) ?? ""}`,
      });
      continue;
    }
    const erro = lerBloco({ ...b, tipo: b.tipo }, saida);
    if (erro) cabecalhos_invalidos.push({ tipo: b.tipo, motivo: erro });
  }
  return { saida, cabecalhos_invalidos, blocos: blocos.length };
}

/** Campo com `;`, aspas ou quebra de linha vai entre aspas, com aspas internas duplicadas. */
const campo = (v: string) =>
  /[;"\r\n]/.test(v) ? `"${v.replace(/\r?\n/g, " ").replace(/"/g, '""')}"` : v;

/**
 * O caminho inverso: a saida interna em blocos CSV. E o formato do exemplo no
 * prompt, das respostas gravadas do eval e do provedor falso do e2e.
 */
export function escreverBlocos(s: SaidaDasLinhas): string {
  const linhas = (tipo: TipoDeBloco, itens: Record<string, string>[]) => {
    if (itens.length === 0) return "";
    const colunas = COLUNAS_DO_BLOCO[tipo] as readonly string[];
    return [
      `\`\`\`csv ${tipo}`,
      colunas.join(";"),
      ...itens.map((i) => colunas.map((c) => campo(i[c] ?? "")).join(";")),
      "```",
    ].join("\n");
  };
  const comOrigem = <
    T extends { origem: { pagina_ou_aba: string; trecho_original: string } },
  >(
    x: T,
  ) => ({
    ...(x as unknown as Record<string, string>),
    pagina_ou_aba: x.origem.pagina_ou_aba,
    trecho_original: x.origem.trecho_original,
  });
  return [
    linhas("posicoes", s.posicoes.map(comOrigem)),
    linhas("transacoes", s.transacoes.map(comOrigem)),
    linhas("proventos", s.proventos.map(comOrigem)),
    linhas("notas", s.notas.map(comOrigem)),
  ]
    .filter(Boolean)
    .join("\n\n");
}
