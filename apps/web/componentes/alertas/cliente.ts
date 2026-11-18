import { api } from "@/lib/api";
import type {
  CanalDeAlerta,
  NotificacaoNaTela,
  NovaRegra,
  Preferencias,
  RegraNaTela,
} from "@/lib/alertas-modelo";

const json = (method: string, corpo: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(corpo),
});

export const listarRegras = () => api<{ data: RegraNaTela[] }>("alertas/regras");
export const criarRegra = (r: NovaRegra) =>
  api<{ data: RegraNaTela }>("alertas/regras", json("POST", r));
export const alterarRegra = (id: string, ativo: boolean) =>
  api<null>(`alertas/regras/${id}`, json("PATCH", { ativo }));

export const listarNotificacoes = (soNaoLidas: boolean) =>
  api<{ itens: NotificacaoNaTela[]; nao_lidas: number }>(
    `notificacoes${soNaoLidas ? "?filtro=nao_lidas" : ""}`,
  );
/** Sem ids marca todas. */
export const marcarLidas = (ids?: string[]) =>
  api<{ nao_lidas: number }>("notificacoes/lidas", json("POST", ids ? { ids } : {}));

export interface PreferenciasNaTela {
  data: Preferencias;
  canais_disponiveis: CanalDeAlerta[];
}
export const lerPreferencias = () => api<PreferenciasNaTela>("preferencias");
export const salvarPreferencias = (p: Preferencias) =>
  api<PreferenciasNaTela>("preferencias", json("PUT", p));

export const CHAVES = {
  regras: ["alertas", "regras"],
  notificacoes: ["alertas", "notificacoes"],
  naoLidas: ["alertas", "nao-lidas"],
  preferencias: ["alertas", "preferencias"],
} as const;

/** "14:52", "ontem" ou "28/10", no horario de Sao Paulo. */
export function quando(iso: string, agora = new Date()): string {
  const fuso = { timeZone: "America/Sao_Paulo" } as const;
  const dia = (d: Date) => d.toLocaleDateString("en-CA", fuso);
  const data = new Date(iso);
  if (dia(data) === dia(agora))
    return data.toLocaleTimeString("pt-BR", {
      ...fuso,
      hour: "2-digit",
      minute: "2-digit",
    });
  if (dia(data) === dia(new Date(agora.getTime() - 86_400_000))) return "ontem";
  return data.toLocaleDateString("pt-BR", { ...fuso, day: "2-digit", month: "2-digit" });
}
