import {
  filtroDoPreset,
  IndicadorFiltravel,
  presets,
  type FiltroDeScreener,
  type NomeDePreset,
} from "@bolsiq/analytics/puro";

/**
 * Estado do screener na URL, para o link reproduzir a tela:
 *
 *   ?preset=graham&tipos=stock&f=pl:0:15;pvp::1.5&liq=1000000&indef=1
 *   &ord=pl&dir=asc&pag=2&cols=pl,pvp,dy_12m
 *
 * `f` guarda as faixas como indicador:min:max (lado vazio e "sem limite").
 */
export type Tipo = "stock" | "fii" | "bdr" | "etf" | "fund";
export const TIPOS: Tipo[] = ["stock", "fii", "bdr", "etf", "fund"];
export const POR_PAGINA = 50;
export const COLUNAS_PADRAO: IndicadorFiltravel[] = [
  "pl",
  "pvp",
  "dy_12m",
  "roe",
  "margem_liquida",
  "liquidez_diaria",
];

export interface EstadoDoScreener {
  preset: NomeDePreset | null;
  tipos: Tipo[];
  faixas: Partial<
    Record<IndicadorFiltravel, { min?: number | undefined; max?: number | undefined }>
  >;
  liquidezMinima: number | null;
  incluirIndefinidos: boolean;
  ordenarPor: IndicadorFiltravel;
  ordem: "asc" | "desc";
  pagina: number;
  colunas: IndicadorFiltravel[];
}

const ehIndicador = (v: string): v is IndicadorFiltravel =>
  IndicadorFiltravel.safeParse(v).success;
const ehPreset = (v: string | null): v is NomeDePreset => v !== null && v in presets;
const numero = (v: string | undefined) =>
  v === undefined || v === "" || Number.isNaN(Number(v)) ? undefined : Number(v);

export function estadoInicial(): EstadoDoScreener {
  return {
    preset: null,
    tipos: ["stock"],
    faixas: {},
    liquidezMinima: null,
    incluirIndefinidos: false,
    ordenarPor: "pl",
    ordem: "asc",
    pagina: 1,
    colunas: COLUNAS_PADRAO,
  };
}

/** Estado a partir do preset: as faixas, tipos e ordenacao que o autor publicou. */
export function estadoDoPreset(nome: NomeDePreset): EstadoDoScreener {
  const f = filtroDoPreset(nome);
  return {
    ...estadoInicial(),
    preset: nome,
    tipos: f.tipos ?? TIPOS,
    faixas: f.faixas,
    ordenarPor: f.ordenar_por,
    ordem: f.ordem,
    colunas: [
      ...new Set([
        f.ordenar_por,
        ...Object.keys(f.faixas).filter(ehIndicador),
        ...COLUNAS_PADRAO,
      ]),
    ].slice(0, 8),
  };
}

export function estadoDaUrl(p: URLSearchParams): EstadoDoScreener {
  const preset = p.get("preset");
  const base = ehPreset(preset) ? estadoDoPreset(preset) : estadoInicial();
  const faixas = { ...base.faixas };
  if (p.has("f")) {
    for (const k of Object.keys(faixas)) delete faixas[k as IndicadorFiltravel];
    for (const parte of (p.get("f") ?? "").split(";")) {
      const [nome = "", min, max] = parte.split(":");
      const vMin = numero(min);
      const vMax = numero(max);
      const faixa = {
        ...(vMin !== undefined ? { min: vMin } : {}),
        ...(vMax !== undefined ? { max: vMax } : {}),
      };
      if (ehIndicador(nome) && Object.keys(faixa).length > 0) faixas[nome] = faixa;
    }
  }
  const tipos = p
    .get("tipos")
    ?.split(",")
    .filter((t): t is Tipo => (TIPOS as string[]).includes(t));
  const colunas = p.get("cols")?.split(",").filter(ehIndicador);
  const ord = p.get("ord");
  return {
    ...base,
    faixas,
    tipos: tipos && tipos.length > 0 ? tipos : base.tipos,
    liquidezMinima: numero(p.get("liq") ?? undefined) ?? base.liquidezMinima,
    incluirIndefinidos: p.get("indef") === "1" || base.incluirIndefinidos,
    ordenarPor: ord && ehIndicador(ord) ? ord : base.ordenarPor,
    ordem: p.get("dir") === "desc" ? "desc" : p.get("dir") === "asc" ? "asc" : base.ordem,
    pagina: Math.max(1, Math.floor(numero(p.get("pag") ?? undefined) ?? 1)),
    colunas: colunas && colunas.length > 0 ? colunas : base.colunas,
  };
}

export function urlDoEstado(e: EstadoDoScreener): string {
  const p = new URLSearchParams();
  if (e.preset) p.set("preset", e.preset);
  p.set("tipos", e.tipos.join(","));
  const f = Object.entries(e.faixas)
    .map(([k, v]) => `${k}:${v?.min ?? ""}:${v?.max ?? ""}`)
    .join(";");
  p.set("f", f);
  if (e.liquidezMinima !== null) p.set("liq", String(e.liquidezMinima));
  if (e.incluirIndefinidos) p.set("indef", "1");
  p.set("ord", e.ordenarPor);
  p.set("dir", e.ordem);
  if (e.pagina > 1) p.set("pag", String(e.pagina));
  p.set("cols", e.colunas.join(","));
  return p.toString();
}

/** Corpo do POST /api/screener. */
export function filtroDoEstado(
  e: EstadoDoScreener,
  porPagina = POR_PAGINA,
): FiltroDeScreener {
  return {
    faixas: e.faixas,
    tipos: e.tipos,
    ...(e.liquidezMinima !== null ? { liquidez_minima: e.liquidezMinima } : {}),
    ordenar_por: e.ordenarPor,
    ordem: e.ordem,
    incluir_indefinidos: e.incluirIndefinidos,
    limite: porPagina,
    deslocamento: (e.pagina - 1) * porPagina,
  };
}
