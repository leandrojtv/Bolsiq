"use client";

import { CircleHelp } from "lucide-react";
import type { AjudaDoIndicador, NivelDoSinal, Sinal } from "@bolsiq/analytics/puro";
import { cn } from "@bolsiq/ui";

const COR: Record<NivelDoSinal, string> = {
  verde: "bg-up",
  amarelo: "bg-warn",
  vermelho: "bg-down",
};
const TEXTO: Record<NivelDoSinal, string> = {
  verde: "text-up",
  amarelo: "text-warn",
  vermelho: "text-down",
};
export const NOME_DO_NIVEL: Record<NivelDoSinal, string> = {
  verde: "favorável",
  amarelo: "atenção",
  vermelho: "desfavorável",
};

export function PontoDoSinal({
  nivel,
  className,
}: {
  nivel: NivelDoSinal;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={`Sinal ${NOME_DO_NIVEL[nivel]}`}
      title={NOME_DO_NIVEL[nivel]}
      className={cn("inline-block size-2 shrink-0 rounded-full", COR[nivel], className)}
    />
  );
}

export function textoDoNivel(nivel: NivelDoSinal) {
  return TEXTO[nivel];
}

/** Botao "?" que abre o helper do indicador; o painel fica com quem chama. */
export function BotaoDeAjuda({
  nome,
  aberto,
  aoAlternar,
  controla,
}: {
  nome: string;
  aberto: boolean;
  aoAlternar: () => void;
  controla: string;
}) {
  return (
    <button
      type="button"
      onClick={aoAlternar}
      aria-expanded={aberto}
      aria-controls={controla}
      aria-label={`Como ler ${nome}`}
      className={cn(
        "inline-flex size-4 items-center justify-center rounded-full text-text-3 hover:text-text",
        aberto && "text-text",
      )}
    >
      <CircleHelp className="size-3.5" aria-hidden="true" />
    </button>
  );
}

export function PainelDeAjuda({
  id,
  nome,
  ajuda,
  sinal,
}: {
  id: string;
  nome: string;
  ajuda: AjudaDoIndicador;
  sinal: Sinal | null;
}) {
  return (
    <div
      id={id}
      role="region"
      aria-label={`Como ler ${nome}`}
      className="flex flex-col gap-2 rounded-control border border-border bg-sidebar p-3 text-xs leading-normal"
    >
      <span className="font-semibold text-text">{nome}</span>
      <p className="m-0 text-text-2">{ajuda.descricao}</p>
      {sinal && (
        <p className={cn("m-0 font-medium", TEXTO[sinal.nivel])}>
          Agora: {NOME_DO_NIVEL[sinal.nivel]}. {primeiraMaiuscula(sinal.leitura)}.
        </p>
      )}
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {(["verde", "amarelo", "vermelho"] as const).map((n) => (
          <li key={n} className="flex items-start gap-2 text-text-2">
            <PontoDoSinal nivel={n} className="mt-1" />
            <span>{primeiraMaiuscula(ajuda.faixas[n])}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function primeiraMaiuscula(t: string) {
  return t.charAt(0).toUpperCase() + t.slice(1);
}
