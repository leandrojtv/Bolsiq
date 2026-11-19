"use client";

import { useQuery } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ComponentProps, type ReactNode } from "react";
import {
  AppShell,
  MARCA_DO_MODULO,
  moduloDaRota,
  modulos,
  navegacaoFinancas,
  navegacaoPadrao,
  navegacaoPainel,
  type LinkComponent,
} from "@bolsiq/ui";
import { buscarCotacoes } from "@/lib/api";
import { lembrarModulo, moduloParaLembrar } from "@/lib/modulo";
import { useSino } from "./alertas/useSino";
import { useConta } from "./conta/Conta";
import { BuscaGlobal, ID_DA_BUSCA } from "./BuscaGlobal";
import { useWatchlist } from "./watchlist";

// Fora do bundle inicial: o painel so carrega no primeiro clique.
const PainelDoAssistente = dynamic(() => import("./assistente/Painel"), { ssr: false });

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
  const [assistenteAberto, setAssistenteAberto] = useState(false);
  const [assistenteUsado, setAssistenteUsado] = useState(false);
  const modulo = moduloDaRota(caminho);
  // Ultimo modulo usado: define a entrada depois do login (ADR 0031).
  useEffect(() => {
    const m = moduloParaLembrar(caminho);
    if (m) lembrarModulo(m);
  }, [caminho]);
  const nav =
    modulo === "financas"
      ? navegacaoFinancas(caminho)
      : modulo === "painel"
        ? navegacaoPainel(caminho)
        : navegacaoPadrao(caminho === "/" ? "/ativo" : caminho);

  return (
    <AppShell
      nav={nav}
      modules={modulos(modulo)}
      brand={MARCA_DO_MODULO[modulo]}
      watchlist={(modulo === "investimentos" ? lista : []).map((t) => {
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
      <button
        type="button"
        aria-label="Pergunte ao Bolsiq"
        onClick={() => {
          setAssistenteUsado(true);
          setAssistenteAberto(true);
        }}
        className="fixed right-4 bottom-24 z-30 flex size-12 items-center justify-center rounded-full bg-accent text-on-accent shadow-lg hover:bg-link md:right-6 md:bottom-6"
      >
        <MessageCircle aria-hidden="true" size={22} />
      </button>
      {assistenteUsado && (
        <PainelDoAssistente aberto={assistenteAberto} aoMudar={setAssistenteAberto} />
      )}
    </AppShell>
  );
}
