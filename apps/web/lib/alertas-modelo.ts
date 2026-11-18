import { z } from "zod";

/**
 * Modelo dos formularios de alerta, sem banco: o navegador valida com o mesmo
 * schema que o BFF usa ao gravar.
 */
export type TipoDeRegra =
  | "preco_acima"
  | "preco_abaixo"
  | "variacao_diaria"
  | "abaixo_graham"
  | "abaixo_bazin"
  | "dy_acima"
  | "provento_anunciado"
  | "data_com_proxima"
  | "demonstrativo_publicado";

export interface DefinicaoDeTipo {
  tipo: TipoDeRegra;
  rotulo: string;
  grupo: "Preço" | "Fundamentos" | "Eventos";
  /** Unidade do campo Valor; ausente quando o tipo nao tem valor. */
  valor?: { unidade: "R$" | "%" | "dias"; exemplo: string };
}

export const TIPOS: DefinicaoDeTipo[] = [
  {
    tipo: "preco_acima",
    rotulo: "Preço acima de",
    grupo: "Preço",
    valor: { unidade: "R$", exemplo: "40,00" },
  },
  {
    tipo: "preco_abaixo",
    rotulo: "Preço abaixo de",
    grupo: "Preço",
    valor: { unidade: "R$", exemplo: "35,00" },
  },
  {
    tipo: "variacao_diaria",
    rotulo: "Variação diária maior que",
    grupo: "Preço",
    valor: { unidade: "%", exemplo: "3" },
  },
  {
    tipo: "abaixo_graham",
    rotulo: "Abaixo do preço justo de Graham",
    grupo: "Fundamentos",
  },
  { tipo: "abaixo_bazin", rotulo: "Abaixo do teto de Bazin", grupo: "Fundamentos" },
  {
    tipo: "dy_acima",
    rotulo: "DY 12m acima de",
    grupo: "Fundamentos",
    valor: { unidade: "%", exemplo: "6" },
  },
  { tipo: "provento_anunciado", rotulo: "Provento anunciado", grupo: "Eventos" },
  {
    tipo: "data_com_proxima",
    rotulo: "Data com nos próximos N dias",
    grupo: "Eventos",
    valor: { unidade: "dias", exemplo: "5" },
  },
  {
    tipo: "demonstrativo_publicado",
    rotulo: "Demonstrativo publicado",
    grupo: "Eventos",
  },
];

export const DEFINICAO = Object.fromEntries(TIPOS.map((t) => [t.tipo, t])) as Record<
  TipoDeRegra,
  DefinicaoDeTipo
>;

export const CANAIS = ["inapp", "email", "push", "telegram"] as const;
export type CanalDeAlerta = (typeof CANAIS)[number];
export const ROTULO_DO_CANAL: Record<CanalDeAlerta, string> = {
  inapp: "App",
  email: "E-mail",
  push: "Push",
  telegram: "Telegram",
};

export const COOLDOWNS = [
  { segundos: 3600, rotulo: "1 hora" },
  { segundos: 86_400, rotulo: "24 horas" },
  { segundos: 604_800, rotulo: "7 dias" },
] as const;

/** Numero digitado em pt-BR ("37,50", "1.234,5") para string decimal. */
export function decimalDigitado(v: string): string | null {
  const limpo = v
    .trim()
    .replace(/\s|R\$|%/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  return /^\d+(\.\d+)?$/.test(limpo) ? limpo : null;
}

export const NovaRegra = z
  .object({
    ticker: z
      .string()
      .trim()
      .transform((t) => t.toUpperCase())
      .pipe(z.string().regex(/^[A-Z0-9]{4,12}$/, "ticker inválido")),
    tipo: z.enum(TIPOS.map((t) => t.tipo) as [TipoDeRegra, ...TipoDeRegra[]]),
    valor: z.string().optional(),
    canais: z.array(z.enum(CANAIS)).min(1, "escolha ao menos um canal"),
    cooldown_segundos: z.union([z.literal(3600), z.literal(86_400), z.literal(604_800)]),
    silencio: z.enum(["nenhum", "22-7"]),
    /** E-mail do usuario, quando o canal e-mail foi marcado e ainda nao ha um. */
    email: z.string().email("e-mail inválido").optional(),
  })
  .superRefine((r, ctx) => {
    const def = DEFINICAO[r.tipo].valor;
    if (!def) return;
    const v = decimalDigitado(r.valor ?? "");
    if (v === null || Number(v) <= 0) {
      ctx.addIssue({
        code: "custom",
        path: ["valor"],
        message: `informe o valor em ${def.unidade}`,
      });
    } else if (
      def.unidade === "dias" &&
      (!Number.isInteger(Number(v)) || Number(v) > 60)
    ) {
      ctx.addIssue({ code: "custom", path: ["valor"], message: "de 1 a 60 dias" });
    }
  });
export type NovaRegra = z.infer<typeof NovaRegra>;

/** Parametros que o motor espera para cada tipo. */
export function paramsDaRegra(r: NovaRegra): Record<string, unknown> {
  const unidade = DEFINICAO[r.tipo].valor?.unidade;
  const v = decimalDigitado(r.valor ?? "");
  if (!unidade || v === null) return {};
  if (unidade === "R$") return { valor: v };
  if (unidade === "%") return { percentual: Number(v) / 100 };
  return { dias: Number(v) };
}

/** Texto da condicao na tabela: "Preço acima de R$ 37,00". */
export function descreverCondicao(
  tipo: TipoDeRegra,
  params: Record<string, unknown>,
): string {
  const def = DEFINICAO[tipo];
  const num = (n: number, casas: number) =>
    new Intl.NumberFormat("pt-BR", {
      minimumFractionDigits: casas,
      maximumFractionDigits: casas,
    }).format(n);
  if (def.valor?.unidade === "R$" && typeof params.valor === "string")
    return `${def.rotulo} R$ ${num(Number(params.valor), 2)}`;
  if (def.valor?.unidade === "%" && typeof params.percentual === "number")
    return `${def.rotulo} ${num(params.percentual * 100, 1)}%`;
  if (def.valor?.unidade === "dias" && typeof params.dias === "number")
    return def.rotulo.replace("N", String(params.dias));
  return def.rotulo;
}

export const Preferencias = z.object({
  email: z.string().email("e-mail inválido").nullable(),
  canais_habilitados: z.array(z.enum(CANAIS)),
  silencio_inicio: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable(),
  silencio_fim: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable(),
  fuso: z.string().min(3),
});
export type Preferencias = z.infer<typeof Preferencias>;

export interface RegraNaTela {
  id: string;
  ticker: string;
  tipo: TipoDeRegra;
  condicao: string;
  canais: CanalDeAlerta[];
  ativo: boolean;
  ultimo_disparo_em: string | null;
}

export interface NotificacaoNaTela {
  id: string;
  titulo: string;
  corpo: string;
  ticker: string | null;
  tipo: TipoDeRegra | null;
  criada_em: string;
  lida: boolean;
}
