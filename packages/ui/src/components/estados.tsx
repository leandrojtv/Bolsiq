import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn.js";
import { Button } from "./controles.js";

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn("flex flex-col items-center gap-2 px-4 py-10 text-center", className)}
    >
      {icon && <div className="text-text-3">{icon}</div>}
      <p className="m-0 font-semibold text-text">{title}</p>
      {description && <p className="m-0 max-w-md text-sm text-text-3">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export interface ErrorStateProps {
  title?: ReactNode;
  description?: ReactNode;
  /** Codigo de correlacao do erro da API, para o suporte achar o log. */
  correlationId?: string;
  onRetry?: () => void;
  className?: string;
}

/** Erro com role=alert: leitor de tela anuncia sem o usuario procurar. */
export function ErrorState({
  title = "Não foi possível carregar",
  description,
  correlationId,
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn("flex flex-col items-center gap-2 px-4 py-10 text-center", className)}
    >
      <p className="m-0 font-semibold text-down">{title}</p>
      {description && <p className="m-0 max-w-md text-sm text-text-3">{description}</p>}
      {correlationId && (
        <p className="m-0 font-mono text-xs text-text-3">Código: {correlationId}</p>
      )}
      {onRetry && (
        <Button className="mt-2" onClick={onRetry}>
          Tentar de novo
        </Button>
      )}
    </div>
  );
}

export type SkeletonProps = HTMLAttributes<HTMLDivElement>;

/** Bloco de carregamento. Escondido do leitor de tela: quem anuncia e o aria-busy do container. */
export function Skeleton({ className, ...resto }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-item bg-surface-2", className)}
      {...resto}
    />
  );
}
