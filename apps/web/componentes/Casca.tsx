"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps, ReactNode } from "react";
import { AppShell, navegacaoPadrao, type LinkComponent } from "@bolsiq/ui";
import { buscarCotacoes } from "@/lib/api";
import { BuscaGlobal, ID_DA_BUSCA } from "./BuscaGlobal";
import { useWatchlist } from "./watchlist";

// exactOptionalPropertyTypes nao aceita os handlers opcionais do <a> no Link
// do Next; as props sao as mesmas em tempo de execucao.
const LinkNext: LinkComponent = (props) => (
  <Link {...(props as ComponentProps<typeof Link>)} />
);

/** AppShell em todas as rotas, com a busca global e a watchlist com cotacao. */
export function Casca({ children }: { children: ReactNode }) {
  const caminho = usePathname();
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
      notifications={0}
      search={<BuscaGlobal />}
      searchInputId={ID_DA_BUSCA}
      hideHeaderOnMobile={caminho.startsWith("/ativo/")}
      linkComponent={LinkNext}
    >
      {children}
    </AppShell>
  );
}
