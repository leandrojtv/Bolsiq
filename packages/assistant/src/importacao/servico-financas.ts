import type { ExtratoLido } from "@bolsiq/finance/puro";
import { custoEstimado, type Uso } from "../orcamento.js";
import { VERSAO_DO_PROMPT_DE_FINANCAS } from "../../prompts/importacao-financas-v1.js";
import { SaidaDaIA, type LancamentoDaIA } from "./esquema.js";
import {
  corrigirLinhas,
  extrairComIA,
  PERFIL_DE_FINANCAS,
  pedidosDeLinhas,
} from "./extracao.js";
import { lerFaturaConhecida } from "./layouts-financas.js";
import { ErroDeImportacao } from "./recebimento.js";
import {
  RODADAS_DE_CORRECAO,
  type ChaveDoCache,
  type PedidoDeImportacao,
} from "./servico.js";
import type { Estrategia, Parte } from "./texto.js";
import {
  validarLancamentos,
  type ResultadoDaValidacaoFinancas,
} from "./validacao-financas.js";

/**
 * Fatura de cartao e extrato de conta em PDF ou imagem (ADR 0040), no mesmo
 * pipeline da carteira: o arquivo ja preparado (texto, OCR, anonimizacao, lotes),
 * o atalho dos layouts conhecidos antes do modelo, cache por hash e versao do
 * prompt, limite diario, ate duas rodadas de autocorrecao e o consumo. Nada
 * grava lancamento: o resultado vira `ExtratoLido` e vai para a revisao do
 * Financas, onde o usuario confirma.
 */

export interface ResultadoDaLeituraFinancas {
  documento: "financas";
  extracao_id: string;
  do_cache: boolean;
  /** Lida pelo layout conhecido do banco, sem chamar o modelo. */
  atalho: boolean;
  provedor: string;
  modelo: string;
  versao_prompt: string;
  uso: Uso;
  custo_estimado: string | null;
  arquivo: { nome: string; tipo: string; hash: string; paginas: number };
  estrategia: Estrategia;
  remocoes: PedidoDeImportacao["arquivo"]["remocoes"];
  partes: Parte[];
  lotes_falhos: SaidaDaIA["lotes_falhos"];
  correcao: { rodadas: number; recuperadas: number };
  validacao: ResultadoDaValidacaoFinancas;
}

const compactar = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** A corrigida substitui a recusada da mesma pagina e do mesmo trecho; nao acrescenta. */
function substituir(
  saida: SaidaDaIA,
  recusadas: LancamentoDaIA[],
  corrigidas: LancamentoDaIA[],
): SaidaDaIA {
  const chave = (l: LancamentoDaIA) =>
    `${compactar(l.origem.pagina_ou_aba)}|${compactar(l.origem.trecho_original)}`;
  const novas = new Map(corrigidas.map((c) => [chave(c), c]));
  const fora = new Set(recusadas.filter((r) => novas.has(chave(r))));
  return {
    ...saida,
    lancamentos: [
      ...saida.lancamentos.filter((l) => !fora.has(l)),
      ...[...fora].map((r) => novas.get(chave(r)) as LancamentoDaIA),
    ],
  };
}

export async function importarFinancasComIA(
  p: PedidoDeImportacao,
): Promise<ResultadoDaLeituraFinancas> {
  const a = p.arquivo;
  const doLayout =
    !p.sem_atalho && a.partes.length > 0 && !a.imagens.length
      ? lerFaturaConhecida(a.partes)
      : null;
  if (
    !doLayout &&
    (a.imagens.length > 0 || a.arquivo_para_visao) &&
    !p.aceitou_enviar_imagem
  )
    throw new ErroDeImportacao(
      "imagem_sem_aceite",
      "Páginas escaneadas vão ao provedor como imagem, sem anonimização. Confirme o envio para continuar.",
      409,
    );

  const provedor = doLayout ? "atalho" : p.provedor;
  const modelo = doLayout ? "layout" : p.nome_do_modelo;
  const chave: ChaveDoCache = {
    hash: a.hash,
    versao_prompt: VERSAO_DO_PROMPT_DE_FINANCAS,
    provedor,
    modelo,
  };
  const guardada = p.reprocessar ? null : await p.armazem.buscar(chave);
  const lida = guardada ? SaidaDaIA.safeParse(guardada.saida) : null;
  const anterior = lida?.success ? lida.data : null;
  const doCache = anterior !== null;

  const uso: Uso = { tokens_entrada: 0, tokens_saida: 0 };
  const pedido = {
    perfil: PERFIL_DE_FINANCAS,
    modelo: p.modelo,
    provedor: p.provedor,
    nome_do_modelo: p.nome_do_modelo,
    lotes: a.lotes,
    partes: a.partes,
    imagens: a.imagens,
    arquivo_para_visao: a.arquivo_para_visao,
    sem_texto: a.sem_texto,
    maxSaida: p.capacidades.max_saida,
    estruturada: p.capacidades.saida_estruturada,
    segredos: p.segredos,
    ...(p.concorrencia ? { concorrencia: p.concorrencia } : {}),
    ...(p.espera_base_ms !== undefined ? { espera_base_ms: p.espera_base_ms } : {}),
    ...(p.aoErrar ? { aoErrar: p.aoErrar } : {}),
    ...(p.abortar ? { abortar: p.abortar } : {}),
    aoProgredir: (feitos: number, total: number, linhas: number) =>
      p.aoAvancar?.({ etapa: "analisando", feitos, total, linhas }),
  };

  let saida: SaidaDaIA;
  let chamouProvedor = false;
  try {
    if (anterior) saida = anterior;
    else if (doLayout) saida = doLayout;
    else {
      if (pedidosDeLinhas(pedido).length === 0)
        throw new ErroDeImportacao("sem_conteudo", `Não há lançamentos em ${a.nome}.`);
      if ((await p.armazem.feitasHoje()) >= p.limite_diario)
        throw new ErroDeImportacao(
          "limite_diario",
          `Você chegou ao limite de ${p.limite_diario} importações com IA por dia. O limite volta amanhã.`,
          429,
        );
      chamouProvedor = true;
      const r = await extrairComIA(pedido);
      Object.assign(uso, r.uso);
      saida = r.saida;
    }
  } catch (erro) {
    if (erro instanceof ErroDeImportacao && erro.uso)
      await p.armazem.registrarUso(erro.uso, custoEstimado(erro.uso, p.preco));
    throw erro;
  }

  const validar = (s: SaidaDaIA) =>
    validarLancamentos(s, a.partes, { hoje: p.hoje, sem_texto: a.sem_texto });
  p.aoAvancar?.({ etapa: "validando" });
  let validacao = validar(saida);
  let rodadas = 0;
  const pendentes = () => validacao.para_corrigir.length + saida.malformadas.length;
  const antes = pendentes();
  if (chamouProvedor)
    while (rodadas < RODADAS_DE_CORRECAO && pendentes() > 0) {
      if (p.abortar?.aborted) break;
      rodadas++;
      p.aoAvancar?.({ etapa: "corrigindo", feitos: rodadas, total: RODADAS_DE_CORRECAO });
      try {
        const recusadas = validacao.para_corrigir.map(
          (x) => x.original as LancamentoDaIA,
        );
        const corrigidas = await corrigirLinhas(
          pedido,
          validacao.para_corrigir,
          uso,
          saida.malformadas,
        );
        saida = {
          ...substituir(saida, recusadas, corrigidas.lancamentos ?? []),
          malformadas: [],
        };
      } catch (erro) {
        p.aoErrar?.(`autocorreção: ${(erro as Error).message}`);
        break;
      }
      validacao = validar(saida);
    }
  const recuperadas = Math.max(0, antes - pendentes());

  const custo = chamouProvedor ? custoEstimado(uso, p.preco) : "0.000000";
  if (chamouProvedor) await p.armazem.registrarUso(uso, custo);

  let id: string;
  if (guardada && doCache) {
    id = guardada.id;
    await p.armazem.atualizarRelatorio(id, validacao);
  } else
    id = await p.armazem.gravar({
      chave,
      nome_arquivo: a.nome,
      tipo_arquivo: a.tipo,
      saida,
      relatorio: validacao,
      uso,
      custo_estimado: custo,
      original: p.original,
    });

  return {
    documento: "financas",
    extracao_id: id,
    do_cache: doCache,
    atalho: provedor === "atalho",
    provedor,
    modelo,
    versao_prompt: VERSAO_DO_PROMPT_DE_FINANCAS,
    uso,
    custo_estimado: custo,
    arquivo: { nome: a.nome, tipo: a.tipo, hash: a.hash, paginas: a.paginas },
    estrategia: a.estrategia,
    remocoes: a.remocoes,
    partes: a.partes,
    lotes_falhos: saida.lotes_falhos,
    correcao: { rodadas, recuperadas },
    validacao,
  };
}

/**
 * O que o usuario manda para a revisao: as linhas validadas (todas; a de
 * confianca baixa chega desmarcada) como um `ExtratoLido`, com o cabecalho da
 * fatura. As recusadas ficam de fora: aparecem na tela com o motivo.
 */
export function extratoDaLeitura(r: ResultadoDaLeituraFinancas): ExtratoLido {
  const v = r.validacao;
  const doc = v.documento;
  const suspeitas = new Set(
    v.conferencia?.confere ? [] : (v.conferencia?.suspeitas ?? []),
  );
  const datas = v.linhas.map((l) => l.data).sort();
  return {
    formato: r.atalho ? "pdf-layout" : "pdf-ia",
    tipo: doc.tipo === "extrato_conta" ? "conta" : "cartao",
    banco: doc.banco || null,
    conta: doc.final_cartao || null,
    inicio: doc.periodo_inicio || datas[0] || null,
    fim: doc.periodo_fim || datas.at(-1) || null,
    saldo: null,
    vencimento: doc.data_vencimento || null,
    fechamento: doc.data_fechamento || null,
    total_informado: doc.total_fatura || null,
    avisos: v.avisos,
    linhas: v.linhas.map((l) => ({
      indice: l.indice,
      fitid: null,
      trntype: null,
      data: l.data,
      valor: l.valor,
      sentido: l.sentido,
      descricao: l.descricao,
      // Sem parcela nas colunas, a descricao ainda e procurada ("PARC 03/10").
      ...(l.parcela ? { parcela: l.parcela } : {}),
      categoria_sugerida: l.marcacao === "iof" ? "IOF" : null,
      marcacao: l.marcacao,
      moeda_original: l.moeda_original,
      valor_moeda_original: l.valor_moeda_original,
      confianca: l.confianca,
      aviso:
        [
          ...l.avisos,
          ...(suspeitas.has(l.indice)
            ? ["Suspeita: pode explicar a diferença com o total da fatura."]
            : []),
        ].join(" ") || null,
    })),
  };
}
