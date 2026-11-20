import { z } from "zod";
import { Canal } from "./regras.js";

/**
 * Alertas do Bolsiq Financas (ADR 0037). Nao ha regra criada pelo usuario: o
 * finance publica o fato (`finance.*`) e o alerts decide, pelas preferencias por
 * tipo, se avisa e por quais canais.
 */
export const TIPOS_FINANCEIROS = [
  "fatura_vencendo",
  "orcamento_limite",
  "saldo_negativo",
  "receita_atrasada",
  "assinatura_nova",
  "reajuste",
  "tarifa_nova",
] as const;
export const TipoFinanceiro = z.enum(TIPOS_FINANCEIROS);
export type TipoFinanceiro = z.infer<typeof TipoFinanceiro>;

export const ROTULO_DO_TIPO_FINANCEIRO: Record<TipoFinanceiro, string> = {
  fatura_vencendo: "Fatura vence em 3 dias",
  orcamento_limite: "Orçamento da categoria em 80% e 100%",
  saldo_negativo: "Mês projetado com saldo negativo",
  receita_atrasada: "Receita prevista atrasada",
  assinatura_nova: "Assinatura nova",
  reajuste: "Reajuste de assinatura",
  tarifa_nova: "Tarifa nova",
};

export const PreferenciaFinanceira = z.object({
  ativo: z.boolean(),
  canais: z.array(Canal).min(1),
});
export type PreferenciaFinanceira = z.infer<typeof PreferenciaFinanceira>;

export const PreferenciasFinanceiras = z.record(TipoFinanceiro, PreferenciaFinanceira);
export type PreferenciasFinanceiras = Partial<
  Record<TipoFinanceiro, PreferenciaFinanceira>
>;

/** Padrao: todos ligados, so no sino. Canal externo e escolha do usuario. */
export const PREFERENCIA_FINANCEIRA_PADRAO: PreferenciaFinanceira = {
  ativo: true,
  canais: ["inapp"],
};

export function preferenciasCompletas(
  salvas: unknown,
): Record<TipoFinanceiro, PreferenciaFinanceira> {
  const r = PreferenciasFinanceiras.safeParse(salvas ?? {});
  const p: PreferenciasFinanceiras = r.success ? r.data : {};
  return Object.fromEntries(
    TIPOS_FINANCEIROS.map((t) => [t, p[t] ?? PREFERENCIA_FINANCEIRA_PADRAO]),
  ) as Record<TipoFinanceiro, PreferenciaFinanceira>;
}

const brl = (v: string) =>
  `R$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const mesBr = (m: string) => {
  const nome = new Date(`${m}-15T12:00:00Z`).toLocaleDateString("pt-BR", {
    month: "long",
    timeZone: "UTC",
  });
  return `${nome} de ${m.slice(0, 4)}`;
};

export interface AvisoFinanceiro {
  tipo: TipoFinanceiro;
  user_id: string;
  chave: string;
  titulo: string;
  corpo: string;
  link: string;
}

type P = Record<string, unknown>;
const s = (p: P, k: string) => String(p[k] ?? "");

/** Traduz o evento em aviso. `null` para evento do finance que nao e alerta. */
export function avisoDoEvento(nome: string, p: P): AvisoFinanceiro | null {
  const base = { user_id: s(p, "user_id"), chave: s(p, "chave") };
  switch (nome) {
    case "finance.fatura.vencendo.v1": {
      const dias = Number(p.dias);
      const quando = dias === 0 ? "hoje" : dias === 1 ? "amanhã" : `em ${dias} dias`;
      return {
        ...base,
        tipo: "fatura_vencendo",
        titulo: `Fatura ${s(p, "cartao")} vence ${quando}`,
        corpo: `${brl(s(p, "valor"))} a pagar até ${dataBr(s(p, "vencimento"))}.`,
        link: `/financas/cartoes/${s(p, "card_id")}`,
      };
    }
    case "finance.orcamento.limite.v1": {
      const estourou = Number(p.limiar) >= 100;
      return {
        ...base,
        tipo: "orcamento_limite",
        titulo: estourou
          ? `Orçamento de ${s(p, "categoria")} estourado`
          : `Orçamento de ${s(p, "categoria")} em ${String(p.limiar)}%`,
        corpo: `${brl(s(p, "consumo"))} de ${brl(s(p, "planejado"))} planejados em ${mesBr(s(p, "mes"))} (${String(p.percentual).replace(".", ",")}%).`,
        link: "/financas/planejamento",
      };
    }
    case "finance.saldo.negativo.v1":
      return {
        ...base,
        tipo: "saldo_negativo",
        titulo: `Saldo negativo previsto em ${mesBr(s(p, "mes"))}`,
        corpo: `O fluxo projetado termina o mês em ${brl(s(p, "saldo_final"))} nas contas.`,
        link: "/financas/fluxo",
      };
    case "finance.receita.atrasada.v1": {
      const dias = Number(p.dias_de_atraso);
      return {
        ...base,
        tipo: "receita_atrasada",
        titulo: `${s(p, "descricao")} ainda não caiu`,
        corpo: `${brl(s(p, "valor"))} previstos para ${dataBr(s(p, "data"))}, ${dias} ${dias === 1 ? "dia" : "dias"} de atraso.`,
        link: "/financas/lancamentos",
      };
    }
    case "finance.insight.novo.v1": {
      const motivo = TipoFinanceiro.safeParse(p.motivo);
      if (!motivo.success) return null;
      const titulo =
        motivo.data === "reajuste"
          ? `Reajuste: ${s(p, "titulo").replace(/^Assinatura:\s*/, "")}`
          : motivo.data === "tarifa_nova"
            ? "Tarifa nova na sua conta"
            : `Assinatura nova: ${s(p, "titulo").replace(/^Assinatura:\s*/, "")}`;
      return {
        ...base,
        tipo: motivo.data,
        titulo,
        corpo: s(p, "descricao"),
        link: "/financas/insights",
      };
    }
    default:
      return null;
  }
}
