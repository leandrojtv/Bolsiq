"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ComponentProps, ReactNode } from "react";
import { AppShell, navegacaoPadrao, type LinkComponent } from "@bolsiq/ui";
import { buscarCotacoes } from "@/lib/api";
import { useSino } from "./alertas/useSino";
import { useConta } from "./conta/Conta";
import { BuscaGlobal, ID_DA_BUSCA } from "./BuscaGlobal";
import { useWatchlist } from "./watchlist";

// exactOptionalPropertyTypes nao aceita os handlers opcionais do <a> no Link
// do Next; as props sao as mesmas em tempo de execucao.
const LinkNext: LinkComponent = (props) => (
  <Link {...(props as ComponentProps<typeof Link>)} />
);

function iniciais(nome: string | null): string {
  const partes = (nome ?? "").trim().split(/\s+/).filter(Boolean);
  return (
    (
      (partes[0]?.[0] ?? "") + (partes.length > 1 ? (partes.at(-1)?.[0] ?? "") : "")
    ).toUpperCase() || "?"
  );
}

/** AppShell em todas as rotas, com a busca global e a watchlist com cotacao. */
export function Casca({ children }: { children: ReactNode }) {
  const caminho = usePathname();
  const router = useRouter();
  const naoLidas = useSino();
  const { uid, nome } = useConta();
  const { lista } = useWatchlist();
  const { data } = useQuery({
    queryKey: ["cotacoes", lista],
    queryFn: () => buscarCotacoes(lista),
    enabled: lista.length > 0,
    refetchInterval: 60_000,
  });
  const porTicker = new Map((data?.data ?? []).map((c) => [c.ticker, c]));

  return (
    <AppShell
      nav={navegacaoPadrao(caminho === "/" ? "/ativo" : caminho)}
      watchlist={lista.map((t) => {
        const c = porTicker.get(t);
        return {
          ticker: t,
          href: `/ativo/${t}`,
          changePercent: c ? Number(c.change_percent) / 100 : 0,
        };
      })}
      notifications={naoLidas}
      onNotificationsClick={() => router.push("/alertas")}
      search={<BuscaGlobal />}
      searchInputId={ID_DA_BUSCA}
      account={
        uid ? (
          <Link
            href="/configuracoes/conta"
            aria-label="Minha conta"
            className="flex size-touch items-center justify-center rounded-full bg-accent-soft font-semibold text-accent-soft-text"
          >
            {iniciais(nome)}
          </Link>
        ) : (
          <Link
            href="/entrar"
            className="inline-flex h-touch items-center rounded-control border border-border-input bg-surface px-3 font-semibold text-text"
          >
            Entrar
          </Link>
        )
      }
      hideHeaderOnMobile={caminho.startsWith("/ativo/")}
      linkComponent={LinkNext}
    >
      {children}
    </AppShell>
  );
}
