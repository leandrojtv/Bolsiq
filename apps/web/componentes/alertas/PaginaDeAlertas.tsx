"use client";

import Link from "next/link";
import { Card } from "@bolsiq/ui";
import { Central } from "./Central";
import { FormularioDeRegra } from "./FormularioDeRegra";
import { MinhasRegras } from "./MinhasRegras";

export function PaginaDeAlertas({
  ticker,
  destacar,
}: {
  ticker?: string;
  destacar?: string;
}) {
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-2xl font-bold">Alertas</h1>
          <p className="m-0 text-text-2">
            Preço, fundamentos e eventos corporativos, avisados no app, por e-mail ou
            push.
          </p>
        </div>
        <Link href="/configuracoes/notificacoes" className="text-sm">
          Preferências de notificação
        </Link>
      </header>
      <div className="flex flex-wrap items-start gap-5">
        <Central {...(destacar ? { destacar } : {})} />
        <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-5">
          <Card aria-label="Nova regra" title="Nova regra">
            <FormularioDeRegra {...(ticker ? { tickerInicial: ticker } : {})} />
          </Card>
          <MinhasRegras />
        </div>
      </div>
    </div>
  );
}
