import { useQuery } from "@tanstack/react-query";
import type {
  Comprometido,
  DetalheDoPlano,
  FluxoDeCaixa,
  Meta,
  Plano,
  DetalheDaFatura,
  ListaDeRecorrencias,
  PainelDoMes,
  Planejamento,
  Recorrencia,
  Cartao,
  Importacao,
  ImportacaoComLinhas,
  Regra,
  ResumoDeFatura,
  Categoria,
  Conta,
  EdicaoDigitada,
  Lancamento,
  LancamentoDigitado,
  PaginaDeLancamentos,
  ResumoDoMes,
} from "@bolsiq/finance/puro";
import { api } from "@/lib/api";

const json = (method: string, corpo: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(corpo),
});

export const CHAVE = ["financas"] as const;

export const useContas = () =>
  useQuery({
    queryKey: [...CHAVE, "contas"],
    queryFn: () => api<{ data: Conta[] }>("financas/contas").then((r) => r.data),
  });

export const useCategorias = () =>
  useQuery({
    queryKey: [...CHAVE, "categorias"],
    queryFn: () => api<{ data: Categoria[] }>("financas/categorias").then((r) => r.data),
  });

export const useResumo = (mes?: string) =>
  useQuery({
    queryKey: [...CHAVE, "resumo", mes ?? ""],
    queryFn: () =>
      api<{ data: ResumoDoMes }>(`financas/resumo${mes ? `?mes=${mes}` : ""}`).then(
        (r) => r.data,
      ),
  });

export const useLancamentos = (filtro: Record<string, string>) =>
  useQuery({
    queryKey: [...CHAVE, "lancamentos", filtro],
    queryFn: () =>
      api<PaginaDeLancamentos>(
        `financas/lancamentos?${new URLSearchParams(
          Object.entries(filtro).filter(([, v]) => v !== ""),
        ).toString()}`,
      ),
  });

export const useCartoes = () =>
  useQuery({
    queryKey: [...CHAVE, "cartoes"],
    queryFn: () => api<{ data: Cartao[] }>("financas/cartoes").then((r) => r.data),
  });

export const useFaturas = (cartao: string) =>
  useQuery({
    queryKey: [...CHAVE, "faturas", cartao],
    enabled: cartao !== "",
    queryFn: () =>
      api<{ data: ResumoDeFatura[] }>(`financas/cartoes/${cartao}/faturas`).then(
        (r) => r.data,
      ),
  });

export const useImportacoes = () =>
  useQuery({
    queryKey: [...CHAVE, "importacoes"],
    queryFn: () =>
      api<{ data: Importacao[] }>("financas/importacoes").then((r) => r.data),
  });

export const useRegras = () =>
  useQuery({
    queryKey: [...CHAVE, "regras"],
    queryFn: () => api<{ data: Regra[] }>("financas/regras").then((r) => r.data),
  });

export const criarCartao = (c: Record<string, unknown>) =>
  api<{ data: Cartao }>("financas/cartoes", json("POST", c)).then((r) => r.data);
export const editarCartao = (id: string, c: Record<string, unknown>) =>
  api<{ data: Cartao }>(`financas/cartoes/${id}`, json("PATCH", c)).then((r) => r.data);
export const apagarCartao = (id: string) =>
  api<null>(`financas/cartoes/${id}`, { method: "DELETE" });

export const editarLinha = (
  importacao: string,
  linha: string,
  e: Record<string, unknown>,
) =>
  api<{ data: ImportacaoComLinhas }>(
    `financas/importacoes/${importacao}/linhas/${linha}`,
    json("PATCH", e),
  ).then((r) => r.data);
export const acaoDaImportacao = (
  id: string,
  acao: "confirmar" | "cancelar" | "desfazer",
) =>
  api<{ data: Importacao }>(`financas/importacoes/${id}/${acao}`, {
    method: "POST",
  }).then((r) => r.data);

export const criarRegra = (r: Record<string, unknown>) =>
  api<{ data: Regra }>("financas/regras", json("POST", r)).then((x) => x.data);
export const editarRegra = (id: string, r: Record<string, unknown>) =>
  api<{ data: Regra }>(`financas/regras/${id}`, json("PATCH", r)).then((x) => x.data);
export const apagarRegra = (id: string) =>
  api<null>(`financas/regras/${id}`, { method: "DELETE" });

/**
 * Valor do seletor "Conta" que tambem lista cartoes: `cartao:<id>` vira
 * card_id, o resto e account_id.
 */
export const PREFIXO_CARTAO = "cartao:";
export const destinoDoSeletor = (v: string) =>
  v.startsWith(PREFIXO_CARTAO)
    ? { card_id: v.slice(PREFIXO_CARTAO.length) }
    : { account_id: v };

export const usePainel = (mes: string) =>
  useQuery({
    queryKey: [...CHAVE, "painel", mes],
    queryFn: () =>
      api<{ data: PainelDoMes }>(`financas/painel?mes=${mes}`).then((r) => r.data),
  });

export const useFatura = (cartao: string, fatura: string) =>
  useQuery({
    queryKey: [...CHAVE, "fatura", cartao, fatura],
    queryFn: () =>
      api<{ data: DetalheDaFatura }>(`financas/cartoes/${cartao}/faturas/${fatura}`).then(
        (r) => r.data,
      ),
  });

export const useRecorrencias = () =>
  useQuery({
    queryKey: [...CHAVE, "recorrencias"],
    queryFn: () => api<ListaDeRecorrencias>("financas/recorrencias"),
  });

export const usePlanejamento = (mes: string) =>
  useQuery({
    queryKey: [...CHAVE, "planejamento", mes],
    queryFn: () =>
      api<{ data: Planejamento }>(`financas/planejamento?mes=${mes}`).then((r) => r.data),
  });

export const pagarFatura = (cartao: string, fatura: string, p: Record<string, unknown>) =>
  api<{ data: DetalheDaFatura }>(
    `financas/cartoes/${cartao}/faturas/${fatura}/pagar`,
    json("POST", p),
  ).then((r) => r.data);

export const criarRecorrencia = (r: Record<string, unknown>) =>
  api<{ data: Recorrencia }>("financas/recorrencias", json("POST", r)).then(
    (x) => x.data,
  );
export const editarRecorrencia = (id: string, r: Record<string, unknown>) =>
  api<{ data: Recorrencia }>(`financas/recorrencias/${id}`, json("PATCH", r)).then(
    (x) => x.data,
  );
export const apagarRecorrencia = (id: string) =>
  api<null>(`financas/recorrencias/${id}`, { method: "DELETE" });

export const criarItem = (i: Record<string, unknown>) =>
  api<{ data: Planejamento }>("financas/planejamento", json("POST", i)).then(
    (r) => r.data,
  );
export const editarItem = (id: string, i: Record<string, unknown>) =>
  api<{ data: Planejamento }>(`financas/planejamento/${id}`, json("PATCH", i)).then(
    (r) => r.data,
  );
export const apagarItem = (id: string) =>
  api<{ data: Planejamento }>(`financas/planejamento/${id}`, { method: "DELETE" }).then(
    (r) => r.data,
  );
export const copiarPlanejamento = (de: string, para: string) =>
  api<{ data: { itens: number } }>(
    "financas/planejamento/copiar",
    json("POST", { de, para }),
  );
export const puxarRecorrencias = (mes: string) =>
  api<{ data: { itens: number } }>(`financas/planejamento/recorrencias?mes=${mes}`, {
    method: "POST",
  });

export const usePlanos = () =>
  useQuery({
    queryKey: [...CHAVE, "planos"],
    queryFn: () => api<{ data: Plano[] }>("financas/parcelamentos").then((r) => r.data),
  });

export const usePlano = (id: string | null) =>
  useQuery({
    queryKey: [...CHAVE, "plano", id],
    enabled: id !== null,
    queryFn: () =>
      api<{ data: DetalheDoPlano }>(`financas/parcelamentos/${id}`).then((r) => r.data),
  });

export const useComprometido = () =>
  useQuery({
    queryKey: [...CHAVE, "comprometido"],
    queryFn: () =>
      api<{ data: Comprometido }>("financas/parcelamentos/comprometido").then(
        (r) => r.data,
      ),
  });

export const useFluxo = (meses: number) =>
  useQuery({
    queryKey: [...CHAVE, "fluxo", meses],
    queryFn: () =>
      api<{ data: FluxoDeCaixa }>(`financas/fluxo?meses=${meses}`).then((r) => r.data),
  });

export const useMetas = () =>
  useQuery({
    queryKey: [...CHAVE, "metas"],
    queryFn: () => api<{ data: Meta[] }>("financas/metas").then((r) => r.data),
  });

export const criarParcelamento = (p: Record<string, unknown>) =>
  api<{ data: Plano }>("financas/parcelamentos", json("POST", p)).then((r) => r.data);
export const criarDivida = (p: Record<string, unknown>) =>
  api<{ data: Plano }>("financas/dividas", json("POST", p)).then((r) => r.data);
export const simularDivida = (id: string, p: Record<string, unknown>) =>
  api<{
    data: {
      antes: { parcelas: number; primeira_parcela: string; juros: string };
      depois: { parcelas: number; primeira_parcela: string; juros: string };
      juros_economizados: string;
    };
  }>(`financas/dividas/${id}/simular`, json("POST", p)).then((r) => r.data);
export const amortizarDivida = (id: string, p: Record<string, unknown>) =>
  api<{ data: DetalheDoPlano }>(`financas/dividas/${id}/amortizar`, json("POST", p)).then(
    (r) => r.data,
  );
export const quitarPlano = (id: string, data: string) =>
  api<{ data: DetalheDoPlano }>(
    `financas/parcelamentos/${id}/quitar`,
    json("POST", { data }),
  ).then((r) => r.data);
export const apagarPlano = (id: string) =>
  api<null>(`financas/parcelamentos/${id}`, { method: "DELETE" });

export const definirValorDaCategoria = (
  mes: string,
  category_id: string,
  valor: string,
) =>
  api<{ data: Planejamento }>(
    "financas/planejamento/categoria",
    json("PUT", { mes, category_id, valor }),
  ).then((r) => r.data);
export const sugerirOrcamento = (mes: string) =>
  api<{ data: { itens: number } }>(`financas/planejamento/sugerir?mes=${mes}`, {
    method: "POST",
  });

export const criarMeta = (m: Record<string, unknown>) =>
  api<{ data: Meta }>("financas/metas", json("POST", m)).then((r) => r.data);
export const editarMeta = (id: string, m: Record<string, unknown>) =>
  api<{ data: Meta }>(`financas/metas/${id}`, json("PATCH", m)).then((r) => r.data);
export const apagarMeta = (id: string) =>
  api<null>(`financas/metas/${id}`, { method: "DELETE" });

export const criarConta = (c: Record<string, unknown>) =>
  api<{ data: Conta }>("financas/contas", json("POST", c)).then((r) => r.data);
export const editarConta = (id: string, c: Record<string, unknown>) =>
  api<{ data: Conta }>(`financas/contas/${id}`, json("PATCH", c)).then((r) => r.data);
export const apagarConta = (id: string) =>
  api<null>(`financas/contas/${id}`, { method: "DELETE" });

export const criarCategoria = (c: Record<string, unknown>) =>
  api<{ data: Categoria }>("financas/categorias", json("POST", c)).then((r) => r.data);
export const editarCategoria = (id: string, c: Record<string, unknown>) =>
  api<{ data: Categoria }>(`financas/categorias/${id}`, json("PATCH", c)).then(
    (r) => r.data,
  );
export const apagarCategoria = (id: string) =>
  api<null>(`financas/categorias/${id}`, { method: "DELETE" });

export const criarLancamento = (l: LancamentoDigitado) =>
  api<{ data: Lancamento[] }>("financas/lancamentos", json("POST", l)).then(
    (r) => r.data,
  );
export const editarLancamento = (id: string, l: EdicaoDigitada) =>
  api<{ data: Lancamento }>(`financas/lancamentos/${id}`, json("PATCH", l)).then(
    (r) => r.data,
  );
export const apagarLancamento = (id: string) =>
  api<null>(`financas/lancamentos/${id}`, { method: "DELETE" });

/** Valor de lancamento com sinal, para a lista. */
export function valorComSinal(l: Lancamento): string {
  const negativo =
    l.tipo === "despesa" ||
    (l.tipo === "transferencia" && l.transferencia_sentido === "saida");
  return negativo ? `-${l.valor}` : l.valor;
}

export const STATUS_ROTULO = {
  previsto: "Previsto",
  realizado: "Realizado",
  conciliado: "Conciliado",
} as const;
