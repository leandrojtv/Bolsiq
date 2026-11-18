"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { Button, Card, Skeleton, cn } from "@bolsiq/ui";
import { Preferencias, ROTULO_DO_CANAL, type CanalDeAlerta } from "@/lib/alertas-modelo";
import { CHAVES, lerPreferencias, salvarPreferencias } from "./cliente";
import { ativarPush } from "./push";

const CAMPO =
  "h-touch rounded-control border border-border-strong bg-sidebar px-3 text-sm text-text";
const ROTULO = "flex flex-col gap-1.5 text-xs text-text-3";
const DESCRICAO: Record<CanalDeAlerta, string> = {
  inapp: "Sino e central de notificações. Sempre ligado.",
  email: "Um e-mail por disparo, com link para a central.",
  push: "Notificação do navegador ou do app instalado.",
  telegram: "Mensagem do bot do Bolsiq (beta).",
};

/** /configuracoes/notificacoes: canais que valem para todas as regras e janela de silencio. */
export function PreferenciasDeNotificacao() {
  const cliente = useQueryClient();
  const { data } = useQuery({ queryKey: CHAVES.preferencias, queryFn: lerPreferencias });
  const [p, setP] = useState<Preferencias | null>(null);
  const [mensagem, setMensagem] = useState<{ erro: boolean; texto: string } | null>(null);
  useEffect(() => {
    if (data && !p) setP(data.data);
  }, [data, p]);

  const salvar = useMutation({
    mutationFn: salvarPreferencias,
    onSuccess: (r) => {
      cliente.setQueryData(CHAVES.preferencias, r);
      setP(r.data);
      setMensagem({ erro: false, texto: "Preferências salvas." });
    },
    onError: (e: Error) => setMensagem({ erro: true, texto: e.message }),
  });

  if (!data || !p) return <Skeleton className="h-80" />;

  async function alternar(canal: CanalDeAlerta, marcado: boolean) {
    setMensagem(null);
    if (marcado && canal === "push") {
      const falha = await ativarPush().catch((e: Error) => e.message);
      if (falha) return setMensagem({ erro: true, texto: falha });
    }
    setP(
      (atual) =>
        atual && {
          ...atual,
          canais_habilitados: marcado
            ? [...atual.canais_habilitados, canal]
            : atual.canais_habilitados.filter((c) => c !== canal),
        },
    );
  }

  function enviar(e: FormEvent) {
    e.preventDefault();
    const r = Preferencias.safeParse(p);
    if (!r.success)
      return setMensagem({
        erro: true,
        texto: r.error.issues[0]?.message ?? "Dados inválidos.",
      });
    salvar.mutate(r.data);
  }

  const silencioLigado = p.silencio_inicio !== null;
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <header className="flex flex-col gap-1">
        <Link href="/alertas" className="text-sm">
          Alertas
        </Link>
        <h1 className="m-0 text-2xl font-bold">Notificações</h1>
        <p className="m-0 text-text-2">
          Valem para todas as regras. Uma regra só avisa pelos canais ligados aqui.
        </p>
      </header>
      <form onSubmit={enviar} className="flex flex-col gap-5" noValidate>
        <Card title="Canais">
          <ul className="m-0 flex list-none flex-col p-0">
            {data.canais_disponiveis.map((c) => (
              <li key={c} className="border-t border-border first:border-t-0">
                <label className="flex min-h-touch cursor-pointer items-center gap-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={c === "inapp" || p.canais_habilitados.includes(c)}
                    disabled={c === "inapp"}
                    onChange={(e) => void alternar(c, e.target.checked)}
                    className="size-4 accent-accent"
                  />
                  <span className="flex flex-col">
                    <span className="font-semibold">{ROTULO_DO_CANAL[c]}</span>
                    <span className="text-[13px] text-text-2">{DESCRICAO[c]}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {!data.canais_disponiveis.includes("push") && (
            <p className="m-0 text-[13px] text-text-3">
              Push indisponível neste ambiente (sem chave VAPID).
            </p>
          )}
          <label className={ROTULO}>
            E-mail
            <input
              type="email"
              value={p.email ?? ""}
              onChange={(e) => setP({ ...p, email: e.target.value || null })}
              autoComplete="email"
              className={CAMPO}
            />
          </label>
        </Card>

        <Card title="Silêncio">
          <label className="flex min-h-touch items-center gap-3">
            <input
              type="checkbox"
              checked={silencioLigado}
              onChange={(e) =>
                setP({
                  ...p,
                  silencio_inicio: e.target.checked ? "22:00" : null,
                  silencio_fim: e.target.checked ? "07:00" : null,
                })
              }
              className="size-4 accent-accent"
            />
            Não enviar e-mail, push nem Telegram nesta janela
          </label>
          <div className={cn("grid grid-cols-2 gap-3", !silencioLigado && "opacity-60")}>
            <label className={ROTULO}>
              Das
              <input
                type="time"
                value={p.silencio_inicio ?? ""}
                disabled={!silencioLigado}
                onChange={(e) => setP({ ...p, silencio_inicio: e.target.value })}
                className={CAMPO}
              />
            </label>
            <label className={ROTULO}>
              Até
              <input
                type="time"
                value={p.silencio_fim ?? ""}
                disabled={!silencioLigado}
                onChange={(e) => setP({ ...p, silencio_fim: e.target.value })}
                className={CAMPO}
              />
            </label>
          </div>
          <p className="m-0 text-[13px] text-text-3">
            Horário de Brasília. O aviso no app chega mesmo no silêncio; os outros saem ao
            fim da janela.
          </p>
        </Card>

        <div className="flex flex-wrap items-center justify-end gap-3">
          <p
            role="status"
            aria-live="polite"
            className={cn("m-0 text-sm", mensagem?.erro ? "text-down" : "text-up")}
          >
            {mensagem?.texto}
          </p>
          <Button type="submit" variant="primary" disabled={salvar.isPending}>
            Salvar
          </Button>
        </div>
      </form>
    </div>
  );
}
