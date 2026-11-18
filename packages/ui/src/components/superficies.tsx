import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn.js";

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title?: ReactNode;
  /** Acao a direita do titulo (botao "Limpar", link). */
  action?: ReactNode;
}

export function Card({ title, action, className, children, ...resto }: CardProps) {
  return (
    <section
      className={cn(
        "flex flex-col gap-3 rounded-card border border-border bg-surface p-4",
        className,
      )}
      {...resto}
    >
      {(title ?? action) !== undefined && (
        <div className="flex items-center justify-between gap-2">
          {title !== undefined && (
            <h2 className="m-0 text-sm font-semibold text-text-2">{title}</h2>
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export interface StatTileProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode;
  value: ReactNode;
  subtitle?: ReactNode;
}

export function StatTile({ label, value, subtitle, className, ...resto }: StatTileProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-control bg-sidebar px-3 py-2.5",
        className,
      )}
      {...resto}
    >
      <span className="text-xs text-text-3">{label}</span>
      <span className="font-mono text-lg font-semibold tabular-nums text-text">
        {value}
      </span>
      {subtitle !== undefined && <span className="text-xs text-text-3">{subtitle}</span>}
    </div>
  );
}
