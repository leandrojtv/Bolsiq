"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";
import { Button, cn } from "@bolsiq/ui";
import {
  COOLDOWNS,
  DEFINICAO,
  NovaRegra,
  ROTULO_DO_CANAL,
  TIPOS,
  type CanalDeAlerta,
  type TipoDeRegra,
} from "@/lib/alertas-modelo";
import { CHAVES, criarRegra, lerPreferencias } from "./cliente";
import { ativarPush } from "./push";

const CAMPO =
  "h-touch rounded-control border border-border-strong bg-sidebar px-3 text-sm text-text placeholder:text-text-3 disabled:opacity-60";
const ROTULO = "flex flex-col gap-1.5 text-xs text-text-3";
const GRUPOS = ["Preço", "Fundamentos", "Eventos"] as const;
const ORDEM_DOS_CANAIS: CanalDeAlerta[] = ["inapp", "email", "push", "telegram"];

export interface FormularioDeRegraProps {
  tickerInicial?: string;
  onCriada?: () => void;
}

/** Formulario "Nova regra" (Alertas.dc.html), usado na pagina e no sheet do ativo. */
export function FormularioDeRegra({
  tickerInicial = "",
  onCriada,
}: FormularioDeRegraProps) {
  const id = useId();
  const cliente = useQueryClient();
  const prefs = useQuery({ queryKey: CHAVES.preferencias, queryFn: lerPreferencias });
  const [ticker, setTicker] = useState(tickerInicial);
  const [tipo, setTipo] = useState<TipoDeRegra>("preco_acima");
  const [valor, setValor] = useState("");
  const [canais, setCanais] = useState<CanalDeAlerta[]>(["inapp"]);
  const [cooldown, setCooldown] = useState<number>(86_400);
  const [silencio, setSilencio] = useState<"nenhum" | "22-7">("nenhum");
  const [email, setEmail] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const def = DEFINICAO[tipo];
  const disponiveis = prefs.data?.canais_disponiveis ?? ["inapp", "email"];
  const emailSalvo = prefs.data?.data.email ?? null;
  const pedirEmail = canais.includes("email") && !emailSalvo;

  const criar = useMutation({
    mutationFn: criarRegra,
    onSuccess: async () => {
      setValor("");
      setAviso("Alerta criado.");
      await cliente.invalidateQueries({ queryKey: ["alertas"] });
      onCriada?.();
    },
    onError: (e: Error) => setErro(e.message),
  });

  async function alternarCanal(canal: CanalDeAlerta, marcado: boolean) {
    setErro(null);
    if (!marcado) return setCanais((c) => c.filter((x) => x !== canal));
    if (canal === "push") {
      const falha = await ativarPush().catch((e: Error) => e.message);
      if (falha) return setErro(falha);
    }
    setCanais((c) => [...c, canal]);
  }

  function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setAviso(null);
    const r = NovaRegra.safeParse({
      ticker,
      tipo,
      ...(def.valor ? { valor } : {}),
      canais,
      cooldown_segundos: cooldown,
      silencio,
      ...(pedirEmail ? { email } : {}),
    });
    if (!r.success) return setErro(r.error.issues[0]?.message ?? "Dados inválidos.");
    criar.mutate(r.data);
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4" noValidate>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
        <label className={ROTULO}>
          Ativo
          <input
            name="ticker"
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            placeholder="PETR4"
            autoComplete="off"
            className={cn(CAMPO, "font-mono")}
          />
        </label>
        <label className={ROTULO}>
          Quando
          <select
            name="tipo"
            aria-label="Quando"
            value={tipo}
            onChange={(e) => setTipo(e.target.value as TipoDeRegra)}
            className={CAMPO}
          >
            {GRUPOS.map((g) => (
              <optgroup key={g} label={g}>
                {TIPOS.filter((t) => t.grupo === g).map((t) => (
                  <option key={t.tipo} value={t.tipo}>
                    {t.rotulo}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className={ROTULO}>
          Valor{def.valor ? ` (${def.valor.unidade})` : ""}
          <input
            name="valor"
            value={def.valor ? valor : ""}
            onChange={(e) => setValor(e.target.value)}
            disabled={!def.valor}
            inputMode="decimal"
            placeholder={def.valor ? def.valor.exemplo : "não se aplica"}
            className={cn(CAMPO, "font-mono")}
          />
        </label>
      </div>

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-2 text-xs text-text-3">Avisar por</legend>
        <div className="flex flex-wrap gap-2">
          {ORDEM_DOS_CANAIS.filter(
            (c) => c !== "telegram" || disponiveis.includes(c),
          ).map((c) => {
            const indisponivel = !disponiveis.includes(c);
            return (
              <label
                key={c}
                className={cn(
                  "inline-flex h-10 items-center gap-2 rounded-control bg-sidebar px-3",
                  indisponivel && "opacity-60",
                )}
              >
                <input
                  type="checkbox"
                  checked={canais.includes(c)}
                  disabled={indisponivel}
                  onChange={(e) => void alternarCanal(c, e.target.checked)}
                  className="size-4 accent-accent"
                />
                {c === "inapp" ? "No app" : ROTULO_DO_CANAL[c]}
                {c === "telegram" && (
                  <span className="rounded-chip bg-surface-2 px-1.5 py-0.5 text-[11px] text-text-2">
                    beta
                  </span>
                )}
                {c === "push" && indisponivel && (
                  <span className="text-[11px] text-text-3">indisponível</span>
                )}
              </label>
            );
          })}
        </div>
      </fieldset>

      {pedirEmail && (
        <label className={ROTULO}>
          Seu e-mail
          <input
            type="email"
            name="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            className={CAMPO}
          />
        </label>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-3">
          <label className={ROTULO} htmlFor={`${id}-cooldown`}>
            Não repetir por
            <select
              id={`${id}-cooldown`}
              aria-label="Não repetir por"
              value={cooldown}
              onChange={(e) => setCooldown(Number(e.target.value))}
              className={cn(CAMPO, "h-10")}
            >
              {COOLDOWNS.map((c) => (
                <option key={c.segundos} value={c.segundos}>
                  {c.rotulo}
                </option>
              ))}
            </select>
          </label>
          <label className={ROTULO}>
            Silêncio
            <select
              aria-label="Silêncio"
              value={silencio}
              onChange={(e) => setSilencio(e.target.value as "nenhum" | "22-7")}
              className={cn(CAMPO, "h-10")}
            >
              <option value="nenhum">Nenhum</option>
              <option value="22-7">22h às 7h</option>
            </select>
          </label>
        </div>
        <Button type="submit" variant="primary" disabled={criar.isPending}>
          Criar alerta
        </Button>
      </div>
      <p
        role="status"
        aria-live="polite"
        className={cn("m-0 text-sm", erro ? "text-down" : "text-up")}
      >
        {erro ?? aviso}
      </p>
    </form>
  );
}
