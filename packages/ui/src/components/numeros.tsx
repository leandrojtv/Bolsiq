import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn.js";
import {
  direcaoDe,
  formatarCompacto,
  formatarDinheiro,
  formatarNumero,
  formatarPercentual,
  type Numero,
} from "../lib/formato.js";

type Base = Omit<HTMLAttributes<HTMLSpanElement>, "children">;

/** Todo numero: fonte mono e algarismos de largura fixa, para colunas alinharem. */
const NUMERICO = "font-mono tabular-nums";

const COR = { alta: "text-up", queda: "text-down", estavel: "text-text-2" } as const;
const SETA = { alta: "▲", queda: "▼", estavel: "◆" } as const;
const PALAVRA = { alta: "alta de", queda: "queda de", estavel: "estável em" } as const;

export interface PriceProps extends Base {
  value: Numero;
  /** Com o prefixo R$. Padrao: true. */
  currency?: boolean;
  decimals?: number;
}

export function Price({
  value,
  currency = true,
  decimals = 2,
  className,
  ...resto
}: PriceProps) {
  return (
    <span className={cn(NUMERICO, className)} {...resto}>
      {currency ? formatarDinheiro(value, decimals) : formatarNumero(value, decimals)}
    </span>
  );
}

export interface MoneyProps extends Base {
  value: Numero;
  decimals?: number;
}

export function Money({ value, decimals = 2, className, ...resto }: MoneyProps) {
  return (
    <span className={cn(NUMERICO, className)} {...resto}>
      {formatarDinheiro(value, decimals)}
    </span>
  );
}

export interface PercentProps extends Base {
  /** Fracao: 0.0235 e 2,35%. */
  value: Numero;
  sign?: boolean;
  /** Colorir por direcao (alta, queda). */
  colored?: boolean;
  decimals?: number;
}

export function Percent({
  value,
  sign = false,
  colored = false,
  decimals = 2,
  className,
  ...resto
}: PercentProps) {
  return (
    <span
      className={cn(NUMERICO, colored && COR[direcaoDe(value)], className)}
      {...resto}
    >
      {formatarPercentual(value, { sinal: sign, casas: decimals })}
    </span>
  );
}

export interface CompactNumberProps extends Base {
  value: Numero;
  /** Ex.: "R$ " para volume financeiro. */
  prefix?: string;
}

export function CompactNumber({
  value,
  prefix = "",
  className,
  ...resto
}: CompactNumberProps) {
  return (
    <span className={cn(NUMERICO, className)} {...resto}>
      {prefix}
      {formatarCompacto(value)}
    </span>
  );
}

export interface ChangeProps extends Base {
  /** Variacao absoluta, em reais. */
  value?: Numero;
  /** Variacao percentual, como fracao. */
  percent?: Numero;
}

/**
 * Variacao com seta e sinal sempre: cor sozinha nao basta para quem nao
 * distingue verde de laranja. O leitor de tela ouve "alta de 0,86, 2,35%".
 */
export function Change({ value, percent, className, ...resto }: ChangeProps) {
  const referencia = value ?? percent ?? 0;
  const direcao = direcaoDe(referencia);
  const sinal = direcao === "queda" ? "-" : direcao === "alta" ? "+" : "";
  const absoluto =
    value === undefined ? null : `${sinal}${formatarNumero(Math.abs(Number(value)))}`;
  const relativo =
    percent === undefined
      ? null
      : formatarPercentual(percent, { sinal: direcao !== "estavel" });
  const texto =
    absoluto && relativo ? `${absoluto} (${relativo})` : (absoluto ?? relativo ?? "");

  // Texto falado em sr-only, e nao aria-label: span sem papel nao pode ter
  // aria-label (o axe reprova, e leitores de tela o ignoram).
  return (
    <span
      className={cn(
        NUMERICO,
        "inline-flex items-baseline gap-1",
        COR[direcao],
        className,
      )}
      {...resto}
    >
      <span aria-hidden="true">{SETA[direcao]}</span>
      <span aria-hidden="true">{texto}</span>
      <span className="sr-only">{`${PALAVRA[direcao]} ${texto.replace(/^[+-]/, "")}`}</span>
    </span>
  );
}
