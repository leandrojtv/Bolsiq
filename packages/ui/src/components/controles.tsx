"use client";

import {
  forwardRef,
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { Slot } from "@radix-ui/react-slot";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import { cn } from "../lib/cn.js";

/**
 * Alvo de toque de 44 px em controle visualmente menor (36 px no design):
 * o pseudo-elemento estende a area clicavel 4 px para cada lado sem mudar o
 * desenho. Vale para segmentado e chip, que o design desenha com 36 px.
 */
export const ALVO_44 = "relative after:absolute after:-inset-1 after:content-['']";

const botao = cva(
  "inline-flex h-touch items-center justify-center gap-2 rounded-control px-4 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-accent font-bold text-on-accent hover:bg-link",
        secondary: "border border-border-strong bg-surface text-text hover:bg-surface-2",
        ghost: "bg-transparent text-link hover:text-link-hover",
      },
    },
    defaultVariants: { variant: "secondary" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof botao> {
  /** Renderiza o filho (ex. um link) com o estilo do botao. */
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, asChild = false, className, type, ...resto },
  ref,
) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      ref={ref}
      className={cn(botao({ variant }), className)}
      {...(asChild ? {} : { type: type ?? "button" })}
      {...resto}
    />
  );
});

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Nome do grupo para leitor de tela, ex. "Periodo". */
  label: string;
  className?: string;
}

/** Seletor de periodo (1M, 6M, 1A...). Cada opcao e um botao com aria-pressed. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("inline-flex gap-1 rounded-control bg-sidebar p-1", className)}
    >
      {options.map((o) => {
        const ativo = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={ativo}
            onClick={() => onChange(o.value)}
            className={cn(
              ALVO_44,
              "h-9 min-w-11 rounded-item px-2.5 font-semibold",
              ativo
                ? "bg-accent-soft text-accent-soft-text"
                : "bg-transparent text-text-2 hover:text-text",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export type CorDeSerie =
  | "series-1"
  | "series-2"
  | "series-3"
  | "series-4"
  | "series-5"
  | "series-6"
  | "benchmark";

const AMOSTRA: Record<CorDeSerie, string> = {
  "series-1": "bg-series-1",
  "series-2": "bg-series-2",
  "series-3": "bg-series-3",
  "series-4": "bg-series-4",
  "series-5": "bg-series-5",
  "series-6": "bg-series-6",
  benchmark: "bg-benchmark",
};

export interface ToggleChipProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onChange"
> {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  /** Cor da amostra, pelo nome do token da serie. */
  swatch?: CorDeSerie;
  /** Amostra propria no lugar da barra (ex. linha tracejada de benchmark). */
  icon?: ReactNode;
}

/** Liga e desliga uma serie do grafico (MM 20, IFR 14, CDI). */
export function ToggleChip({
  pressed,
  onPressedChange,
  swatch,
  icon,
  className,
  children,
  ...resto
}: ToggleChipProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={() => onPressedChange(!pressed)}
      className={cn(
        ALVO_44,
        "inline-flex h-9 items-center gap-1.5 rounded-item border bg-transparent px-3 text-[13px]",
        pressed ? "border-border-active text-text" : "border-border-input text-text-3",
        className,
      )}
      {...resto}
    >
      {icon}
      {swatch && !icon && (
        <span
          aria-hidden="true"
          className={cn("h-[3px] w-2.5 rounded-sm", AMOSTRA[swatch])}
        />
      )}
      {children}
    </button>
  );
}

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
  id?: string;
}

/** Interruptor com role=switch (Radix) e rotulo clicavel. */
export function Switch({ checked, onCheckedChange, label, disabled, id }: SwitchProps) {
  const gerado = useId();
  const alvo = id ?? gerado;
  return (
    <div className="inline-flex min-h-touch items-center gap-3">
      <SwitchPrimitive.Root
        id={alvo}
        checked={checked}
        onCheckedChange={onCheckedChange}
        {...(disabled === undefined ? {} : { disabled })}
        className={cn(
          ALVO_44,
          "inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-border-strong transition-colors",
          "data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=unchecked]:bg-sidebar",
          "disabled:opacity-50",
        )}
      >
        <SwitchPrimitive.Thumb
          className={cn(
            "block size-4.5 rounded-full transition-transform",
            "data-[state=checked]:translate-x-5.5 data-[state=checked]:bg-on-accent",
            "data-[state=unchecked]:translate-x-0.5 data-[state=unchecked]:bg-text-2",
          )}
        />
      </SwitchPrimitive.Root>
      <label htmlFor={alvo} className="cursor-pointer text-sm text-text-2">
        {label}
      </label>
    </div>
  );
}

export interface RangeInputProps {
  label: ReactNode;
  min: string;
  max: string;
  onChange: (faixa: { min: string; max: string }) => void;
  onRemove?: () => void;
  /** Texto do botao de remover para leitor de tela. */
  removeLabel?: string;
}

/** Faixa minimo e maximo de um indicador do screener. Valor vazio e "sem limite". */
export function RangeInput({
  label,
  min,
  max,
  onChange,
  onRemove,
  removeLabel,
}: RangeInputProps) {
  return (
    <div className="flex flex-col gap-2 rounded-control bg-sidebar px-3 py-2.5">
      <div className="flex items-center justify-between">
        <span className="font-semibold">{label}</span>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={removeLabel ?? "Remover filtro"}
            className={cn(
              ALVO_44,
              "inline-flex size-7 items-center justify-center text-text-3 hover:text-text",
            )}
          >
            <X aria-hidden="true" size={12} />
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <CampoNumerico
          rotulo="mín"
          valor={min}
          aoMudar={(v) => onChange({ min: v, max })}
        />
        <CampoNumerico
          rotulo="máx"
          valor={max}
          aoMudar={(v) => onChange({ min, max: v })}
        />
      </div>
    </div>
  );
}

function CampoNumerico({
  rotulo,
  valor,
  aoMudar,
}: {
  rotulo: string;
  valor: string;
  aoMudar: (v: string) => void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value">) {
  return (
    <label className="flex flex-col gap-1 text-[11px] text-text-3">
      {rotulo}
      <input
        type="text"
        inputMode="decimal"
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        className="h-touch rounded-chip border border-border-strong bg-surface px-2 font-mono text-sm text-text"
      />
    </label>
  );
}
