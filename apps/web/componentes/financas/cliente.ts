import { useQuery } from "@tanstack/react-query";
import type {
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
