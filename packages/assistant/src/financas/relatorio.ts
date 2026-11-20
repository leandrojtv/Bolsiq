import { randomUUID } from "node:crypto";
import { generateText, type LanguageModel } from "ai";
import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { comoUsuario } from "@bolsiq/portfolio";
import { d, moeda } from "@bolsiq/finance/puro";
import { REGRAS_FINANCAS } from "../../prompts/sistema-financas-v1.js";
import { registroDoModelo, type Provedor } from "../catalogo.js";
import { decifrarChave, mensagemSegura } from "../chaves.js";
import { settings, usage } from "../db/schema.js";
import type { OpcoesDaCredencial } from "../importacao/postgres.js";
import { numerosInventados } from "../numeros.js";
import { custoEstimado, type Uso } from "../orcamento.js";
import { criarModelo, urlDoOllama } from "../provedores.js";
import { cortesPossiveis, gastosPorCategoria } from "./calculos.js";
import { intervaloDoMes } from "./ferramentas.js";
import { fontesFinanceirasDoBanco } from "./postgres.js";
import type { FontesFinanceiras } from "./tipos.js";

type Banco = NodePgDatabase<Record<string, unknown>>;

/**
 * Relatorio mensal do Bolsiq Financas (ADR 0036): no dia 1, o resumo do mes
 * anterior com 3 cortes e a economia estimada, no sino. Opt-in, porque gasta
 * tokens do usuario. Os numeros sao calculados aqui; o modelo so escreve. Texto
 * com numero sem origem nos dados e descartado e vira o texto padrao.
 */

/** Tamanho tipico de um relatorio, medido no eval: base da estimativa da tela. */
export const ESTIMATIVA_DO_RELATORIO: Uso = { tokens_entrada: 3500, tokens_saida: 600 };

export const custoDoRelatorio = (preco: {
  entrada: number | null;
  saida: number | null;
}) => custoEstimado(ESTIMATIVA_DO_RELATORIO, preco);

export const CORTES_NO_RELATORIO = 3;

const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];
export const nomeDoMes = (mes: string) =>
  `${MESES[Number(mes.slice(5, 7)) - 1]} de ${mes.slice(0, 4)}`;

const brl = (v: string) =>
  `R$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function dadosDoRelatorio(fontes: FontesFinanceiras, mes: string) {
  const { de, ate } = intervaloDoMes(mes);
  const [resumo, lancamentos, insights] = await Promise.all([
    fontes.resumoDoMes(mes),
    fontes.lancamentos(de, ate),
    fontes.insights(mes),
  ]);
  const cortes = cortesPossiveis(insights.dados).slice(0, CORTES_NO_RELATORIO);
  const economia = cortes.reduce((s, c) => s.plus(c.economia), d(0));
  return {
    mes,
    renda_recebida: resumo.dados.renda.recebida,
    despesas: resumo.dados.despesas.total,
    fixos: resumo.dados.fixos.valor,
    variaveis: resumo.dados.variaveis.valor,
    maiores_gastos: gastosPorCategoria(lancamentos.dados, 3).categorias.map((c) => ({
      categoria: c.categoria,
      valor: c.valor,
    })),
    cortes: cortes.map((c) => ({
      titulo: c.i.titulo,
      acao: c.regra.acao,
      economia_mensal: moeda(c.economia),
    })),
    economia_mensal: moeda(economia),
    economia_anual: moeda(economia.times(12)),
    sem_movimento: lancamentos.dados.length === 0,
  };
}
export type DadosDoRelatorio = Awaited<ReturnType<typeof dadosDoRelatorio>>;

/** Texto sem modelo: o mesmo conteudo, quando o modelo falha ou inventa numero. */
export function textoPadrao(r: DadosDoRelatorio): string {
  const linhas = [
    `Em ${nomeDoMes(r.mes)} você recebeu ${brl(r.renda_recebida)} e gastou ${brl(r.despesas)} (fixos ${brl(r.fixos)}, variáveis ${brl(r.variaveis)}).`,
  ];
  if (r.maiores_gastos.length)
    linhas.push(
      `Maiores gastos: ${r.maiores_gastos.map((g) => `${g.categoria} ${brl(g.valor)}`).join(", ")}.`,
    );
  if (r.cortes.length)
    linhas.push(
      `Onde cortar: ${r.cortes.map((c) => `${c.titulo} (${c.acao}, ${brl(c.economia_mensal)} por mês)`).join("; ")}. Economia estimada: ${brl(r.economia_mensal)} por mês, ${brl(r.economia_anual)} por ano.`,
    );
  else linhas.push("Nenhum corte recorrente apareceu nos insights deste mês.");
  return linhas.join(" ");
}

export const INSTRUCAO_DO_RELATORIO = `## Relatório mensal
Escreva o relatório do mês para o usuário a partir do JSON da mensagem, em até 120 palavras, sem título e sem Markdown: um parágrafo com renda, despesas e os maiores gastos, e outro com os cortes sugeridos e a economia estimada por mês e por ano. Use só os números do JSON, escritos como reais (R$ 1.234,56). Não faça contas.`;

export interface TextoDoRelatorio {
  texto: string;
  uso: Uso;
  /** `modelo`: texto do modelo aprovado. `padrao`: o texto sem modelo. */
  origem: "modelo" | "padrao";
  motivo?: string;
}

export async function escreverRelatorio(o: {
  modelo: LanguageModel;
  dados: DadosDoRelatorio;
  segredos: readonly string[];
}): Promise<TextoDoRelatorio> {
  const { sem_movimento: _s, ...dados } = o.dados;
  try {
    const r = await generateText({
      model: o.modelo,
      system: `${REGRAS_FINANCAS}\n\n${INSTRUCAO_DO_RELATORIO}`,
      prompt: JSON.stringify(dados),
      maxOutputTokens: 800,
      maxRetries: 1,
    });
    const uso = {
      tokens_entrada: r.usage.inputTokens ?? 0,
      tokens_saida: r.usage.outputTokens ?? 0,
    };
    const texto = r.text.trim();
    const inventados = numerosInventados(texto, [dados], "");
    if (!texto)
      return { texto: textoPadrao(o.dados), uso, origem: "padrao", motivo: "vazio" };
    if (inventados.length)
      return {
        texto: textoPadrao(o.dados),
        uso,
        origem: "padrao",
        motivo: `numero sem origem: ${inventados.join(", ")}`,
      };
    return { texto, uso, origem: "modelo" };
  } catch (e) {
    return {
      texto: textoPadrao(o.dados),
      uso: { tokens_entrada: 0, tokens_saida: 0 },
      origem: "padrao",
      motivo: mensagemSegura(e, o.segredos),
    };
  }
}

/** Usuarios com o relatorio ligado. Pela conexao do dono: o job varre todos. */
export async function usuariosDoRelatorio(db: Banco, mes: string): Promise<string[]> {
  const r = await db.execute<{ user_id: string }>(sql`
    select user_id from assistant.settings
     where relatorio_mensal and consentimento_financas_em is not null
       and provedor is not null and modelo is not null
       and (relatorio_ultimo_mes is null or relatorio_ultimo_mes < ${mes})`);
  return r.rows.map((l) => l.user_id);
}

export interface Aviso {
  user_id: string;
  /** Chave de idempotencia do aviso: o mes. */
  chave: string;
  titulo: string;
  corpo: string;
  dados: Record<string, unknown>;
}

export type ResultadoDoRelatorio =
  | { entregue: false; motivo: string }
  | { entregue: true; origem: TextoDoRelatorio["origem"]; motivo?: string };

/**
 * Gera e entrega o relatorio de `mes` para um usuario. `avisar` grava no sino
 * (o dono das notificacoes e o modulo alerts); aqui so o texto e o consumo.
 */
export async function relatorioDoUsuario(
  db: Banco,
  uid: string,
  o: {
    mes: string;
    hoje: string;
    credencial: OpcoesDaCredencial;
    avisar: (a: Aviso) => Promise<void>;
    /** Teste: troca o modelo de verdade. */
    modelo?: LanguageModel;
  },
): Promise<ResultadoDoRelatorio> {
  const s = await comoUsuario(db, uid, async (tx) => {
    const [l] = await tx.select().from(settings).where(eq(settings.user_id, uid));
    return l ?? null;
  });
  if (!s?.relatorio_mensal || !s.consentimento_financas_em)
    return { entregue: false, motivo: "desligado" };
  if (s.relatorio_ultimo_mes && s.relatorio_ultimo_mes >= o.mes)
    return { entregue: false, motivo: "ja_entregue" };
  if (!s.provedor || !s.modelo) return { entregue: false, motivo: "nao_configurado" };
  if (s.chave_cifrada && !o.credencial.mestra)
    return { entregue: false, motivo: "sem_chave_mestra" };

  const marcar = () =>
    comoUsuario(db, uid, (tx) =>
      tx
        .update(settings)
        .set({ relatorio_ultimo_mes: o.mes, atualizado_em: sql`now()` })
        .where(eq(settings.user_id, uid)),
    );

  const dados = await dadosDoRelatorio(fontesFinanceirasDoBanco(db, uid, o.hoje), o.mes);
  if (dados.sem_movimento) {
    await marcar();
    return { entregue: false, motivo: "sem_movimento" };
  }

  const provedor = s.provedor as Provedor;
  const chave =
    s.chave_cifrada && o.credencial.mestra
      ? decifrarChave(s.chave_cifrada, o.credencial.mestra, uid)
      : null;
  const baseUrl =
    provedor === "ollama"
      ? urlDoOllama(s.base_url || o.credencial.ollama_url, o.credencial.ollama_hosts)
      : provedor === "deepseek"
        ? (o.credencial.deepseek_url ?? null)
        : null;
  const r = await escreverRelatorio({
    modelo: o.modelo ?? criarModelo({ provedor, chave, baseUrl }, s.modelo),
    dados,
    segredos: chave ? [chave] : [],
  });

  if (r.uso.tokens_entrada + r.uso.tokens_saida > 0) {
    const registro = registroDoModelo(provedor, s.modelo);
    const custo = custoEstimado(r.uso, {
      entrada:
        s.preco_entrada !== null
          ? Number(s.preco_entrada)
          : (registro?.preco_entrada ?? null),
      saida:
        s.preco_saida !== null ? Number(s.preco_saida) : (registro?.preco_saida ?? null),
    });
    await comoUsuario(db, uid, (tx) =>
      tx.insert(usage).values({
        id: randomUUID(),
        user_id: uid,
        conversation_id: null,
        provedor,
        modelo: s.modelo as string,
        plataforma: false,
        origem: "relatorio",
        tokens_entrada: r.uso.tokens_entrada,
        tokens_saida: r.uso.tokens_saida,
        custo_estimado: custo,
      }),
    );
  }

  await o.avisar({
    user_id: uid,
    chave: o.mes,
    titulo: `Relatório de ${nomeDoMes(o.mes)}`,
    corpo: r.texto,
    dados: {
      link: "/financas/insights",
      mes: o.mes,
      economia_mensal: dados.economia_mensal,
      origem: r.origem,
    },
  });
  await marcar();
  return r.motivo
    ? { entregue: true, origem: r.origem, motivo: r.motivo }
    : { entregue: true, origem: r.origem };
}
