import type { LanguageModel } from "ai";
import { conversar } from "../src/conversa.js";
import { criarFerramentas, type NomeDaFerramenta } from "../src/ferramentas.js";
import { montarSistema } from "../src/prompt.js";
import { CARTEIRA_ID, carteiraDeConferencia, fontesDeTeste, HOJE } from "./base.js";
import type { Caso } from "./casos.js";
import {
  extrairNumeros,
  numeroPresente,
  numerosInventados,
  parametrosBatem,
  tickersNoTexto,
} from "./medir.js";

export interface ResultadoDoCaso {
  id: string;
  ferramenta_certa: boolean;
  parametros_certos: boolean;
  numeros_certos: boolean;
  texto_certo: boolean;
  /** Ticker citado fora de `sugerir_aporte`. Reprova o modelo: tolerancia zero. */
  ativos_fora_da_lista: string[];
  numeros_faltando: number[];
  numeros_sem_origem: number[];
  chamadas: { nome: string; entrada: unknown }[];
  resposta: string;
  tokens_entrada: number;
  tokens_saida: number;
  erro: string | null;
}

export async function executarCaso(
  caso: Caso,
  modelo: (caso: Caso) => LanguageModel,
): Promise<ResultadoDoCaso> {
  const ferramentas = criarFerramentas(
    fontesDeTeste(caso.semPerfil ? { semPerfil: true } : {}),
    { hoje: HOJE, modo: "personal" },
  );
  const chamadas: ResultadoDoCaso["chamadas"] = [];
  const saidas: { nome: string; saida: unknown }[] = [];
  let resposta = "";
  let erro: string | null = null;
  let uso = { tokens_entrada: 0, tokens_saida: 0 };

  const r = conversar({
    modelo: modelo(caso),
    sistema: montarSistema({ modo: "personal", hoje: HOJE }),
    mensagens: [{ role: "user", content: caso.pergunta }],
    ferramentas,
    segredos: [],
    aoErrar: (m) => {
      erro = m;
    },
    aoTerminar: (u) => {
      uso = u;
    },
  });
  for await (const p of r.fullStream) {
    if (p.type === "text-delta") resposta += p.text;
    if (p.type === "tool-call") chamadas.push({ nome: p.toolName, entrada: p.input });
    if (p.type === "tool-result") saidas.push({ nome: p.toolName, saida: p.output });
  }

  const usadas = (nome: NomeDaFerramenta) => chamadas.filter((c) => c.nome === nome);
  const ferramenta_certa =
    caso.ferramentas.length === 0
      ? chamadas.length === 0
      : caso.ferramentas.every((f) => usadas(f.nome).length > 0);
  const parametros_certos = caso.ferramentas.every(
    (f) =>
      !f.parametros ||
      usadas(f.nome).some((c) =>
        parametrosBatem(
          f.parametros as Record<string, unknown>,
          c.entrada as Record<string, unknown>,
        ),
      ),
  );

  const achados = extrairNumeros(resposta);
  const numeros_faltando = (caso.numeros ?? []).filter(
    (n) => !numeroPresente(n, achados),
  );
  const numeros_sem_origem = numerosInventados(
    resposta,
    saidas.map((s) => s.saida),
    caso.pergunta,
  );

  let ativos_fora_da_lista: string[] = [];
  if (caso.aporte) {
    const permitidos = new Set([
      ...saidas.flatMap((s) =>
        s.nome === "sugerir_aporte"
          ? ((s.saida as { tickers_permitidos?: string[] }).tickers_permitidos ?? [])
          : [],
      ),
      // Citar o que ja esta na carteira nao e sugerir.
      ...carteiraDeConferencia().posicoes.map((p) => p.ticker),
    ]);
    ativos_fora_da_lista = tickersNoTexto(resposta).filter((t) => !permitidos.has(t));
  }

  return {
    id: caso.id,
    ferramenta_certa,
    parametros_certos,
    numeros_certos: numeros_faltando.length === 0 && numeros_sem_origem.length === 0,
    texto_certo: (caso.deve_conter ?? []).every((re) => re.test(resposta)),
    ativos_fora_da_lista,
    numeros_faltando,
    numeros_sem_origem,
    chamadas,
    resposta,
    ...uso,
    erro,
  };
}

export const MINIMO_PARA_HOMOLOGAR = 0.85;

export function resumir(resultados: ResultadoDoCaso[]) {
  const taxa = (f: (r: ResultadoDoCaso) => boolean) =>
    Number((resultados.filter(f).length / resultados.length).toFixed(3));
  const metricas = {
    ferramenta_certa: taxa((r) => r.ferramenta_certa),
    parametros_certos: taxa((r) => r.parametros_certos),
    numeros_certos: taxa((r) => r.numeros_certos),
    texto_certo: taxa((r) => r.texto_certo),
  };
  const violacoes = resultados.flatMap((r) => r.ativos_fora_da_lista);
  return {
    casos: resultados.length,
    ...metricas,
    ativos_fora_da_lista: violacoes,
    aprovado:
      Object.values(metricas).every((v) => v >= MINIMO_PARA_HOMOLOGAR) &&
      violacoes.length === 0,
    tokens_entrada: resultados.reduce((s, r) => s + r.tokens_entrada, 0),
    tokens_saida: resultados.reduce((s, r) => s + r.tokens_saida, 0),
  };
}

export { CARTEIRA_ID };
