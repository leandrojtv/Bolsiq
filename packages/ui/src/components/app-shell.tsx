"use client";

import {
  useEffect,
  useId,
  useRef,
  type AnchorHTMLAttributes,
  type ComponentType,
  type ReactNode,
} from "react";
import { Bell, Briefcase, ChartLine, Columns2, Funnel, Search } from "lucide-react";
import { cn } from "../lib/cn.js";
import { direcaoDe, formatarPercentual, type Numero } from "../lib/formato.js";

export interface NavItem {
  href: string;
  label: string;
  /** Rotulo da navegacao inferior, quando o do menu nao cabe (Carteiras -> Carteira). */
  shortLabel?: string;
  icon: ReactNode;
  current?: boolean;
}

export interface WatchItem {
  ticker: string;
  href: string;
  /** Variacao do dia, como fracao. */
  changePercent: Numero;
}

/** Link injetavel: o app passa o `Link` do Next; o padrao e `<a>`. */
export type LinkComponent = ComponentType<
  AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }
>;

export interface AppShellProps {
  /** Itens do menu. Os cinco primeiros vao para a navegacao inferior no celular. */
  nav: NavItem[];
  watchlist?: WatchItem[];
  notifications?: number;
  onNotificationsClick?: () => void;
  userInitials?: string;
  /** Area da conta no topo (ex. link "Entrar" ou avatar), no lugar das iniciais. */
  account?: ReactNode;
  searchPlaceholder?: string;
  onSearch?: (termo: string) => void;
  /**
   * Busca propria (ex. com autocomplete), no lugar do campo simples. O
   * Ctrl+K foca o elemento com id `searchInputId`.
   */
  search?: ReactNode;
  searchInputId?: string;
  /** Esconde o topo abaixo de 768 px, quando a pagina tem cabecalho proprio. */
  hideHeaderOnMobile?: boolean;
  linkComponent?: LinkComponent;
  children: ReactNode;
}

const ICONE = { size: 18, strokeWidth: 2, "aria-hidden": true } as const;

/** Navegacao das telas de docs/design/, na ordem do menu. */
export function navegacaoPadrao(atual: string): NavItem[] {
  const itens: Omit<NavItem, "current">[] = [
    { href: "/ativo", label: "Ativos", icon: <ChartLine {...ICONE} /> },
    { href: "/comparar", label: "Comparar", icon: <Columns2 {...ICONE} /> },
    { href: "/screener", label: "Screener", icon: <Funnel {...ICONE} /> },
    {
      href: "/carteiras",
      label: "Carteiras",
      shortLabel: "Carteira",
      icon: <Briefcase {...ICONE} />,
    },
    { href: "/alertas", label: "Alertas", icon: <Bell {...ICONE} /> },
  ];
  return itens.map((i) => ({ ...i, current: atual.startsWith(i.href) }));
}

function LinkPadrao(props: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return <a {...props} />;
}

/**
 * Casca do app: menu lateral de 220 px com logo, itens e watchlist; topo com
 * busca (Ctrl+K ou Cmd+K) e sino com contador. Abaixo de 768 px o menu vira
 * navegacao inferior de cinco itens, como em AtivoMobile.dc.html.
 */
export function AppShell({
  nav,
  watchlist = [],
  notifications = 0,
  onNotificationsClick,
  userInitials,
  account,
  searchPlaceholder = "Buscar ação, FII, BDR, ETF ou fundo",
  onSearch,
  search,
  searchInputId,
  hideHeaderOnMobile = false,
  linkComponent: Link = LinkPadrao,
  children,
}: AppShellProps) {
  const busca = useRef<HTMLInputElement>(null);
  const idBusca = useId();

  useEffect(() => {
    const atalho = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        const alvo = searchInputId
          ? document.getElementById(searchInputId)
          : busca.current;
        alvo?.focus();
      }
    };
    window.addEventListener("keydown", atalho);
    return () => window.removeEventListener("keydown", atalho);
  }, [searchInputId]);

  return (
    <div className="flex min-h-screen bg-bg font-sans text-text">
      <nav
        aria-label="Navegação principal"
        className="hidden w-sidebar shrink-0 flex-col gap-1 border-r border-border bg-sidebar px-3.5 py-5 md:flex"
      >
        <div className="flex items-center gap-2.5 px-2.5 pt-1 pb-5">
          <div
            aria-hidden="true"
            className="flex size-[30px] items-center justify-center rounded-item bg-accent text-base font-bold text-on-accent"
          >
            B
          </div>
          <span className="text-lg font-bold tracking-tight">Bolsiq</span>
        </div>
        {nav.map((i) => (
          <Link
            key={i.href}
            href={i.href}
            {...(i.current ? { "aria-current": "page" as const } : {})}
            className={cn(
              "flex min-h-touch items-center gap-3 rounded-item px-3",
              i.current
                ? "bg-surface-2 font-semibold text-text"
                : "text-text-2 hover:text-text",
            )}
          >
            {i.icon}
            {i.label}
          </Link>
        ))}
        {watchlist.length > 0 && (
          <>
            <div
              className="mt-6 px-3 text-xs font-semibold tracking-wider text-benchmark"
              id={`${idBusca}-wl`}
            >
              WATCHLIST
            </div>
            <ul aria-labelledby={`${idBusca}-wl`} className="m-0 list-none p-0">
              {watchlist.map((w) => {
                const direcao = direcaoDe(w.changePercent);
                return (
                  <li key={w.ticker}>
                    <Link
                      href={w.href}
                      className="flex min-h-touch items-center justify-between rounded-item px-3 font-mono text-[13px] text-text hover:bg-surface-2"
                    >
                      <span>{w.ticker}</span>
                      <span
                        className={
                          direcao === "alta"
                            ? "text-up"
                            : direcao === "queda"
                              ? "text-down"
                              : "text-text-2"
                        }
                      >
                        {formatarPercentual(w.changePercent, {
                          sinal: direcao !== "estavel",
                        })}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className={cn(
            "flex-wrap items-center gap-3 px-4 pt-4 md:flex md:px-content md:pt-5",
            hideHeaderOnMobile ? "hidden" : "flex",
          )}
        >
          {search ?? (
            <form
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                onSearch?.(busca.current?.value ?? "");
              }}
              className="flex h-touch min-w-0 flex-1 items-center gap-2.5 rounded-control border border-border-input bg-surface px-3.5"
            >
              <label htmlFor={idBusca} className="sr-only">
                Buscar ativo
              </label>
              <Search aria-hidden="true" size={16} className="shrink-0 text-benchmark" />
              <input
                ref={busca}
                id={idBusca}
                type="search"
                placeholder={searchPlaceholder}
                className="min-w-0 flex-1 bg-transparent text-text outline-none placeholder:text-text-3"
              />
              <kbd className="hidden rounded-chip border border-border-strong px-1.5 py-0.5 font-mono text-xs text-text-3 sm:inline">
                Ctrl K
              </kbd>
            </form>
          )}
          <button
            type="button"
            onClick={onNotificationsClick}
            aria-label={
              notifications > 0
                ? `Notificações, ${notifications} não lidas`
                : "Notificações"
            }
            className="relative inline-flex size-touch items-center justify-center rounded-control border border-border-input bg-surface text-text"
          >
            <Bell {...ICONE} />
            {notifications > 0 && (
              <span
                aria-hidden="true"
                className="absolute top-1.5 right-1.5 min-w-4 rounded-full bg-down px-1 text-center text-[10px] leading-4 font-bold text-on-down"
              >
                {notifications > 99 ? "99+" : notifications}
              </span>
            )}
          </button>
          {account}
          {!account && userInitials && (
            <div
              aria-hidden="true"
              className="hidden size-touch items-center justify-center rounded-full bg-accent-soft font-semibold text-accent-soft-text sm:flex"
            >
              {userInitials}
            </div>
          )}
        </header>

        <main className="flex min-w-0 flex-1 flex-col gap-5 px-4 pt-5 pb-28 md:px-content md:pb-10">
          {children}
        </main>
      </div>

      <nav
        aria-label="Navegação principal"
        className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-border bg-sidebar px-1 pt-1.5 pb-[18px] md:hidden"
      >
        {nav.slice(0, 5).map((i) => (
          <Link
            key={i.href}
            href={i.href}
            {...(i.current ? { "aria-current": "page" as const } : {})}
            className={cn(
              "flex min-h-12 flex-col items-center justify-center gap-1 text-[11px]",
              i.current ? "font-semibold text-accent-soft-text" : "text-text-3",
            )}
          >
            {i.icon}
            {i.shortLabel ?? i.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
