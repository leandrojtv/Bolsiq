import "server-only";
import { headers } from "next/headers";
import {
  assinaturaParaRecorrencia,
  baseDoSimulador,
  detalheDoInsight,
  JOB_INSIGHTS,
  lerConfiguracao,
  listarAssinaturas,
  listarInsights,
  registrarFeedback,
  salvarConfiguracao,
  somarDias,
  type AcaoDeFeedback,
  type ConfiguracaoDeInsights,
  type TaxaCdi,
  amortizar,
  apagarMeta,
  apagarDivida,
  apagarPlano,
  comprometidoPorMes,
  criarEmprestimo,
  criarMeta,
  criarParcelamentoNoCartao,
  definirValorDaCategoria,
  detalheDoPlano,
  editarMeta,
  fluxoDeCaixa,
  listarMetas,
  listarPlanos,
  quitar,
  simular,
  sugerirPelaMedia,
  type EdicaoDeMeta,
  type ModoDeAmortizacao,
  type NovaMeta,
  type NovoEmprestimo,
  type NovoParcelamentoNoCartao,
  type PedidoDeAmortizacao,
  type ValorDaCarteira,
  apagarItem,
  apagarRecorrencia,
  copiarPlanejamento,
  criarItem,
  criarRecorrencia,
  detalheDaFatura,
  editarItem,
  editarRecorrencia,
  listarRecorrencias,
  obterPlanejamento,
  pagarFatura,
  painelDoMes,
  puxarRecorrencias,
  type EdicaoDeItemDoPlanejamento,
  type EdicaoDeRecorrencia,
  type NovaRecorrencia,
  type NovoItemDoPlanejamento,
  type PagamentoDeFatura,
  analisarArquivos,
  apagarCartao,
  apagarRegra,
  cancelarImportacao,
  confirmarImportacao,
  criarCartao,
  criarImportacao,
  criarRegra,
  desfazerImportacao,
  editarCartao,
  editarLinha,
  editarRegra,
  listarCartoes,
  listarFaturas,
  listarImportacoes,
  listarRegras,
  obterImportacao,
  type ArquivoRecebido,
  type EdicaoDeCartao,
  type EdicaoDeLinha,
  type EdicaoDeRegra,
  type LimitesDeImportacao,
  type NovaImportacao,
  type NovaRegra,
  type NovoCartao,
  apagarCategoria,
  apagarConta,
  apagarLancamento,
  comoUsuario,
  criarCategoria,
  criarConta,
  criarLancamento,
  editarCategoria,
  editarConta,
  editarLancamento,
  listarCategorias,
  listarContas,
  listarLancamentos,
  resumoDoMes,
  semearCategorias,
  type EdicaoDeCategoria,
  type EdicaoDeConta,
  type EdicaoDeLancamento,
  type FiltroDeLancamentos,
  type NovaCategoria,
  type NovaConta,
  type NovoLancamento,
  type Origem,
  type Tx,
} from "@bolsiq/finance";
import { banco } from "./analytics";
import { painel as painelDaCarteira } from "./carteira";
import { env } from "./env";
import { enfileirar } from "./fila";
import { buscarV1, VALIDADE } from "./market-data";
import { hojeEmSp } from "./indicadores-tecnicos";

/**
 * Bolsiq Financas (ADR 0031): modulo do app, schema `finance`. Toda leitura e
 * escrita passa por `comoUsuario` (RLS valendo, ADR 0011).
 */

async function origem(): Promise<Origem> {
  const h = await headers();
  return {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    user_agent: h.get("user-agent"),
  };
}

const como = <T>(uid: string, fn: (tx: Tx) => Promise<T>) =>
  comoUsuario(banco(), uid, fn);

/** Primeiro acesso: semeia as categorias padrao. Idempotente. */
export const iniciarFinancas = (uid: string) =>
  como(uid, (tx) => semearCategorias(tx, uid));

export const contas = (uid: string) =>
  como(uid, (tx) => listarContas(tx, uid, hojeEmSp()));

export async function novaConta(uid: string, c: NovaConta) {
  const o = await origem();
  return como(uid, (tx) => criarConta(tx, uid, c, hojeEmSp(), o));
}

export async function mudarConta(uid: string, id: string, e: EdicaoDeConta) {
  const o = await origem();
  return como(uid, (tx) => editarConta(tx, uid, id, e, hojeEmSp(), o));
}

export async function removerConta(uid: string, id: string) {
  const o = await origem();
  return como(uid, (tx) => apagarConta(tx, uid, id, hojeEmSp(), o));
}

export const categorias = (uid: string) =>
  como(uid, async (tx) => {
    await semearCategorias(tx, uid);
    return listarCategorias(tx, uid);
  });

export async function novaCategoria(uid: string, c: NovaCategoria) {
  const o = await origem();
  return como(uid, (tx) => criarCategoria(tx, uid, c, o));
}

export async function mudarCategoria(uid: string, id: string, e: EdicaoDeCategoria) {
  const o = await origem();
  return como(uid, (tx) => editarCategoria(tx, uid, id, e, o));
}

export async function removerCategoria(uid: string, id: string) {
  const o = await origem();
  return como(uid, (tx) => apagarCategoria(tx, uid, id, o));
}

export const lancamentos = (uid: string, f: FiltroDeLancamentos) =>
  como(uid, (tx) => listarLancamentos(tx, uid, f));

export async function novoLancamento(uid: string, l: NovoLancamento) {
  const o = await origem();
  return como(uid, (tx) => criarLancamento(tx, uid, l, o));
}

export async function mudarLancamento(uid: string, id: string, e: EdicaoDeLancamento) {
  const o = await origem();
  return como(uid, (tx) => editarLancamento(tx, uid, id, e, o));
}

export async function removerLancamento(uid: string, id: string) {
  const o = await origem();
  return como(uid, (tx) => apagarLancamento(tx, uid, id, o));
}

/** `mes` em YYYY-MM; sem ele, o mes de hoje em Sao Paulo. */
export function resumo(uid: string, mes?: string) {
  const hoje = hojeEmSp();
  const competencia = `${mes ?? hoje.slice(0, 7)}-01`;
  return como(uid, (tx) => resumoDoMes(tx, uid, competencia, hoje));
}

// Cartoes

export const cartoes = (uid: string) =>
  como(uid, (tx) => listarCartoes(tx, uid, hojeEmSp()));

export async function novoCartao(uid: string, c: NovoCartao) {
  const o = await origem();
  return como(uid, (tx) => criarCartao(tx, uid, c, hojeEmSp(), o));
}

export async function mudarCartao(uid: string, id: string, e: EdicaoDeCartao) {
  const o = await origem();
  return como(uid, (tx) => editarCartao(tx, uid, id, e, hojeEmSp(), o));
}

export async function removerCartao(uid: string, id: string) {
  const o = await origem();
  return como(uid, (tx) => apagarCartao(tx, uid, id, o));
}

export const faturas = (uid: string, id: string) =>
  como(uid, (tx) => listarFaturas(tx, uid, id, hojeEmSp()));

// Importacao

export const limitesDeImportacao = (): LimitesDeImportacao => ({
  bytes: env.FINANCE_IMPORT_MAX_MB * 1024 * 1024,
  linhas: env.FINANCE_IMPORT_MAX_ROWS,
  arquivos: env.FINANCE_IMPORT_MAX_FILES,
});

export const analisar = (uid: string, arquivos: ArquivoRecebido[]) =>
  como(uid, (tx) => analisarArquivos(tx, uid, arquivos, limitesDeImportacao()));

export async function novaImportacao(
  uid: string,
  pedido: NovaImportacao,
  arquivos: ArquivoRecebido[],
) {
  const o = await origem();
  return como(uid, (tx) =>
    criarImportacao(tx, uid, pedido, arquivos, limitesDeImportacao(), o),
  );
}

export const importacoes = (uid: string) => como(uid, (tx) => listarImportacoes(tx, uid));

export const importacao = (uid: string, id: string) =>
  como(uid, (tx) => obterImportacao(tx, uid, id));

export async function mudarLinha(
  uid: string,
  id: string,
  linha: string,
  e: EdicaoDeLinha,
) {
  const o = await origem();
  return como(uid, (tx) => editarLinha(tx, uid, id, linha, e, o));
}

export async function confirmar(uid: string, id: string) {
  const o = await origem();
  const r = await como(uid, (tx) => confirmarImportacao(tx, uid, id, o, hojeEmSp()));
  // Evento finance.importacao.confirmada.v1 gravado: os insights recalculam no
  // worker. Falhar aqui nao desfaz a importacao; a tela recalcula ao abrir.
  await enfileirar(
    JOB_INSIGHTS,
    { user_id: uid },
    { retryLimit: 2, retryDelay: 120 },
  ).catch((e: unknown) =>
    process.stderr.write(
      `${JSON.stringify({ level: "warn", modulo: "financas", msg: "fila de insights", erro: String(e) })}\n`,
    ),
  );
  return r;
}

export async function cancelar(uid: string, id: string) {
  const o = await origem();
  return como(uid, (tx) => cancelarImportacao(tx, uid, id, o));
}

export async function desfazer(uid: string, id: string) {
  const o = await origem();
  return como(uid, (tx) => desfazerImportacao(tx, uid, id, o));
}

// Regras

export const regras = (uid: string) => como(uid, (tx) => listarRegras(tx, uid));

export async function novaRegra(uid: string, r: NovaRegra) {
  const o = await origem();
  return como(uid, (tx) => criarRegra(tx, uid, r, o));
}

export async function mudarRegra(uid: string, id: string, e: EdicaoDeRegra) {
  const o = await origem();
  return como(uid, (tx) => editarRegra(tx, uid, id, e, o));
}

export async function removerRegra(uid: string, id: string) {
  const o = await origem();
  return como(uid, (tx) => apagarRegra(tx, uid, id, o));
}

// Fatura

export const fatura = (uid: string, cartao: string, id: string) =>
  como(uid, (tx) => detalheDaFatura(tx, uid, cartao, id));

export async function pagar(
  uid: string,
  cartao: string,
  id: string,
  p: PagamentoDeFatura,
) {
  const o = await origem();
  return como(uid, (tx) => pagarFatura(tx, uid, cartao, id, p, o));
}

// Recorrencias

export const recorrencias = (uid: string) =>
  como(uid, (tx) => listarRecorrencias(tx, uid, hojeEmSp()));

export async function novaRecorrencia(uid: string, r: NovaRecorrencia) {
  const o = await origem();
  return como(uid, (tx) => criarRecorrencia(tx, uid, r, hojeEmSp(), o));
}

export async function mudarRecorrencia(uid: string, id: string, e: EdicaoDeRecorrencia) {
  const o = await origem();
  return como(uid, (tx) => editarRecorrencia(tx, uid, id, e, hojeEmSp(), o));
}

export async function removerRecorrencia(uid: string, id: string) {
  const o = await origem();
  return como(uid, (tx) => apagarRecorrencia(tx, uid, id, hojeEmSp(), o));
}

// Painel e planejamento

const mesOuHoje = (mes?: string) => mes ?? hojeEmSp().slice(0, 7);

export function painel(uid: string, mes?: string) {
  return como(uid, (tx) => painelDoMes(tx, uid, `${mesOuHoje(mes)}-01`, hojeEmSp()));
}

export const planejamento = (uid: string, mes?: string) =>
  como(uid, (tx) => obterPlanejamento(tx, uid, mesOuHoje(mes)));

export async function novoItem(uid: string, i: NovoItemDoPlanejamento) {
  const o = await origem();
  return como(uid, (tx) => criarItem(tx, uid, i, o));
}

export async function mudarItem(uid: string, id: string, e: EdicaoDeItemDoPlanejamento) {
  const o = await origem();
  return como(uid, (tx) => editarItem(tx, uid, id, e, o));
}

export async function removerItem(uid: string, id: string) {
  const o = await origem();
  return como(uid, (tx) => apagarItem(tx, uid, id, o));
}

export async function copiarMes(uid: string, de: string, para: string) {
  const o = await origem();
  return como(uid, (tx) => copiarPlanejamento(tx, uid, de, para, o));
}

export async function puxarFixos(uid: string, mes?: string) {
  const o = await origem();
  return como(uid, (tx) => puxarRecorrencias(tx, uid, mesOuHoje(mes), o));
}

// Parcelamentos e dividas

export const planos = (uid: string) => como(uid, (tx) => listarPlanos(tx, uid));
export const plano = (uid: string, id: string) =>
  como(uid, (tx) => detalheDoPlano(tx, uid, id));
export const comprometido = (uid: string) =>
  como(uid, (tx) => comprometidoPorMes(tx, uid, hojeEmSp()));

export async function novoParcelamento(uid: string, p: NovoParcelamentoNoCartao) {
  const o = await origem();
  return como(uid, (tx) => criarParcelamentoNoCartao(tx, uid, p, hojeEmSp(), o));
}

export async function novaDivida(uid: string, e: NovoEmprestimo) {
  const o = await origem();
  return como(uid, (tx) => criarEmprestimo(tx, uid, e, hojeEmSp(), o));
}

export const simularDivida = (
  uid: string,
  id: string,
  extra: string,
  modo: ModoDeAmortizacao,
) => como(uid, (tx) => simular(tx, uid, id, extra, modo));

export async function amortizarDivida(uid: string, id: string, a: PedidoDeAmortizacao) {
  const o = await origem();
  return como(uid, (tx) => amortizar(tx, uid, id, a, hojeEmSp(), o));
}

export async function quitarPlano(uid: string, id: string, data: string) {
  const o = await origem();
  return como(uid, (tx) => quitar(tx, uid, id, data, hojeEmSp(), o));
}

export async function removerPlano(uid: string, id: string) {
  const o = await origem();
  return como(uid, (tx) => apagarPlano(tx, uid, id, o));
}

export async function removerDivida(uid: string, id: string) {
  const o = await origem();
  return como(uid, (tx) => apagarDivida(tx, uid, id, o));
}

// Fluxo, orcamento e metas

export const fluxo = (uid: string, meses: number) =>
  como(uid, (tx) => fluxoDeCaixa(tx, uid, hojeEmSp(), meses));

export async function valorDaCategoria(
  uid: string,
  mes: string,
  categoria: string,
  valor: string,
) {
  const o = await origem();
  return como(uid, (tx) => definirValorDaCategoria(tx, uid, mes, categoria, valor, o));
}

export async function sugerirOrcamento(uid: string, mes?: string) {
  const o = await origem();
  return como(uid, (tx) => sugerirPelaMedia(tx, uid, mesOuHoje(mes), o));
}

/**
 * Valor da carteira para a meta: o finance nao le o schema portfolio
 * (ADR 0031); o web compoe pelo modulo dono. Sem cotacao, a meta cai para o
 * valor guardado.
 */
const carteiraDe =
  (uid: string): ValorDaCarteira =>
  async (id) => {
    try {
      return (await painelDaCarteira(uid, id)).resumo.patrimonio;
    } catch {
      return null;
    }
  };

export const metas = (uid: string) =>
  como(uid, (tx) => listarMetas(tx, uid, hojeEmSp(), carteiraDe(uid)));

export async function novaMeta(uid: string, m: NovaMeta) {
  const o = await origem();
  return como(uid, (tx) => criarMeta(tx, uid, m, hojeEmSp(), carteiraDe(uid), o));
}

export async function mudarMeta(uid: string, id: string, e: EdicaoDeMeta) {
  const o = await origem();
  return como(uid, (tx) => editarMeta(tx, uid, id, e, hojeEmSp(), carteiraDe(uid), o));
}

export async function removerMeta(uid: string, id: string) {
  const o = await origem();
  return como(uid, (tx) => apagarMeta(tx, uid, id, o));
}

// Insights (ADR 0035)

/**
 * Ultimo CDI do /v1/macro/cdi (BCB SGS 12), com a data e a fonte: e a premissa
 * do custo de oportunidade. Sem o market-data, `null` e a tela avisa.
 */
export async function cdiAtual(): Promise<TaxaCdi | null> {
  try {
    const r = await buscarV1<{
      data: { points: { date: string; value: string }[] };
      meta: { source: string };
    }>(`macro/cdi?from=${somarDias(hojeEmSp(), -20)}`, VALIDADE.macro);
    const p = r.status === 200 ? r.corpo.data.points.at(-1) : undefined;
    return p ? { diaria: p.value, data: p.date, fonte: r.corpo.meta.source } : null;
  } catch {
    return null;
  }
}

export async function insights(uid: string, mes?: string) {
  const [lista, cdi] = await Promise.all([
    como(uid, (tx) => listarInsights(tx, uid, mesOuHoje(mes), hojeEmSp())),
    cdiAtual(),
  ]);
  return { ...lista, cdi };
}

export const insight = (uid: string, id: string, mes?: string) =>
  como(uid, (tx) => detalheDoInsight(tx, uid, id, mesOuHoje(mes), hojeEmSp()));

export async function responderInsight(
  uid: string,
  id: string,
  acao: AcaoDeFeedback,
  mes?: string,
) {
  const o = await origem();
  return como(uid, (tx) =>
    registrarFeedback(tx, uid, id, acao, mesOuHoje(mes), hojeEmSp(), o),
  );
}

export const configuracaoDeInsights = (uid: string) =>
  como(uid, (tx) => lerConfiguracao(tx, uid));

export async function configurarInsights(uid: string, c: ConfiguracaoDeInsights) {
  const o = await origem();
  return como(uid, (tx) => salvarConfiguracao(tx, uid, c, o));
}

export async function assinaturas(uid: string) {
  const [lista, cdi] = await Promise.all([
    como(uid, (tx) => listarAssinaturas(tx, uid, hojeEmSp())),
    cdiAtual(),
  ]);
  return { ...lista, cdi };
}

export async function assinaturaRecorrente(uid: string, id: string) {
  const o = await origem();
  return como(uid, (tx) => assinaturaParaRecorrencia(tx, uid, id, hojeEmSp(), o));
}

export async function simulador(uid: string) {
  const cdi = await cdiAtual();
  return como(uid, (tx) => baseDoSimulador(tx, uid, hojeEmSp(), cdi, carteiraDe(uid)));
}
