"use client";

import { useState } from "react";
import { Bell } from "lucide-react";
import { Button, Sheet } from "@bolsiq/ui";
import { FormularioDeRegra } from "./FormularioDeRegra";

/** "Criar alerta" da pagina do ativo: abre o formulario num sheet com o ticker preenchido. */
export function CriarAlertaRapido({
  ticker,
  icone = false,
}: {
  ticker: string;
  icone?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      {icone ? (
        <button
          type="button"
          aria-label="Criar alerta"
          onClick={() => setAberto(true)}
          className="flex size-touch items-center justify-center text-text"
        >
          <Bell aria-hidden="true" size={20} />
        </button>
      ) : (
        <Button variant="primary" onClick={() => setAberto(true)}>
          Criar alerta
        </Button>
      )}
      <Sheet
        open={aberto}
        onOpenChange={setAberto}
        title={`Novo alerta para ${ticker}`}
        description="O aviso chega no sino e nos canais marcados."
      >
        <FormularioDeRegra tickerInicial={ticker} onCriada={() => setAberto(false)} />
      </Sheet>
    </>
  );
}
