import type { PerfilDoInvestidor } from "@bolsiq/assistant/puro";
import { api } from "@/lib/api";
import type {
  EstadoDoAssistente,
  ResultadoDoTeste,
  SalvarConfiguracao,
  TestarConexao,
} from "@/lib/assistente-modelo";

const json = (method: string, corpo?: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
});

export const CHAVES_DO_ASSISTENTE = {
  estado: ["assistente", "estado"] as const,
  conversas: ["assistente", "conversas"] as const,
  perfil: ["assistente", "perfil"] as const,
};

export const lerEstado = () =>
  api<{ data: EstadoDoAssistente }>("assistente/configuracao").then((r) => r.data);

export const salvarConfiguracao = (c: SalvarConfiguracao) =>
  api<{ data: EstadoDoAssistente }>("assistente/configuracao", json("PUT", c)).then(
    (r) => r.data,
  );

export const removerConfiguracao = () =>
  api<{ data: EstadoDoAssistente }>("assistente/configuracao", json("DELETE")).then(
    (r) => r.data,
  );

export const testarConexao = (t: TestarConexao) =>
  api<{ data: ResultadoDoTeste }>("assistente/configuracao/testar", json("POST", t)).then(
    (r) => r.data,
  );

export const consentir = () =>
  api<{ data: EstadoDoAssistente }>("assistente/consentimento", json("POST")).then(
    (r) => r.data,
  );

export const lerPerfil = () =>
  api<{ data: PerfilDoInvestidor | null }>("assistente/perfil").then((r) => r.data);

export const salvarPerfil = (p: unknown) =>
  api<{ data: PerfilDoInvestidor }>("assistente/perfil", json("PUT", p)).then(
    (r) => r.data,
  );

export interface ConversaNaLista {
  id: string;
  titulo: string;
  atualizada_em: string;
}

export const listarConversas = () =>
  api<{ data: ConversaNaLista[] }>("assistente/conversas").then((r) => r.data);

export const lerConversa = (id: string) =>
  api<{
    data: {
      id: string;
      titulo: string;
      mensagens: { id: string; role: string; parts: unknown[] }[];
    };
  }>(`assistente/conversas/${id}`).then((r) => r.data);

export async function apagarConversa(id: string) {
  const r = await fetch(`/api/assistente/conversas/${id}`, { method: "DELETE" });
  if (!r.ok) throw new Error("Não foi possível apagar a conversa.");
}

export const confirmarAlerta = (p: { ticker: string; tipo: string; valor?: number }) =>
  api<{ data: unknown }>(
    "alertas/regras",
    json("POST", {
      ticker: p.ticker,
      tipo: p.tipo,
      ...(p.valor !== undefined ? { valor: String(p.valor) } : {}),
      canais: ["inapp"],
      cooldown_segundos: 86_400,
      silencio: "nenhum",
    }),
  );
