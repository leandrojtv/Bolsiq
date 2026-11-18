"use client";

import Link from "next/link";
import { Card } from "@bolsiq/ui";
import { useWatchlist } from "../watchlist";

/** Atalhos da watchlist na pagina /ativo; a busca fica no topo. */
export function ListaDeAtivos() {
  const { lista } = useWatchlist();
  if (lista.length === 0) return null;
  return (
    <Card>
      <h2 className="m-0 mb-2 text-sm font-semibold text-text-2">Watchlist</h2>
      <ul className="m-0 flex list-none flex-col p-0">
        {lista.map((t) => (
          <li key={t}>
            <Link
              href={`/ativo/${t}`}
              className="flex h-touch items-center font-mono font-semibold text-text"
            >
              {t}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
