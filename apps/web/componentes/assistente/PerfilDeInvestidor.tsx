"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import {
  CLASSES,
  HORIZONTES,
  METODOS,
  NOMES_DE_CLASSE,
  OBJETIVOS,
  PerfilDoInvestidor,
  TOLERANCIAS,
  type ClasseDoPerfil,
  type Metodo,
} from "@bolsiq/assistant/puro";
import { Button, Card, Skeleton } from "@bolsiq/ui";
import { filtroDaUrlDoScreener } from "@/lib/assistente-modelo";
import { CAMPO, Campo, Mensagem } from "../conta/campos";
import { CHAVES_DO_ASSISTENTE as CHAVES, lerPerfil, salvarPerfil } from "./cliente";

const ROTULO = "flex flex-col gap-1.5 text-xs text-text-3";

interface Formulario {
  objetivo: string;
  horizonte: string;
  tolerancia: string;
  alocacao: Record<ClasseDoPerfil, string>;
  limite_ativo: string;
  limite_setor: string;
  metodos: Metodo[];
  filtro: string;
  evitar: string;
  liquidez: string;
}

const VAZIO: Formulario = {
  objetivo: "crescimento",
  horizonte: "longo",
  tolerancia: "media",
  alocacao: {
    acoes: "60",
    fiis: "25",
    bdrs: "0",
    etfs: "10",
    fundos: "0",
    renda_fixa: "5",
  },
  limite_ativo: "20",
  limite_setor: "40",
  metodos: ["graham"],
  filtro: "",
  evitar: "",
  liquidez: "1000000",
};

const pct = (v: number) => String(Number((v * 100).toFixed(4)));
const numero = (v: string) => Number(v.replace(",", "."));

function Opcoes({
  rotulo,
  valor,
  opcoes,
  aoMudar,
}: {
  rotulo: string;
  valor: string;
  opcoes: Record<string, string>;
  aoMudar: (v: string) => void;
}) {
  return (
    <label className={ROTULO}>
      {rotulo}
      <select value={valor} onChange={(e) => aoMudar(e.target.value)} className={CAMPO}>
        {Object.entries(opcoes).map(([k, r]) => (
          <option key={k} value={k}>
            {r}
          </option>
        ))}
      </select>
    </label>
  );
}

/** /configuracoes/perfil: o que avaliar_carteira e sugerir_aporte usam. */
export function PerfilDeInvestidor() {
  const cliente = useQueryClient();
  const { data, isSuccess } = useQuery({ queryKey: CHAVES.perfil, queryFn: lerPerfil });
  const [f, setF] = useState<Formulario | null>(null);
  const [aviso, setAviso] = useState<{ erro: boolean; texto: string } | null>(null);

  useEffect(() => {
    if (!isSuccess || f) return;
    setF(
      data
        ? {
            objetivo: data.objetivo,
            horizonte: data.horizonte,
            tolerancia: data.tolerancia,
            alocacao: Object.fromEntries(
              NOMES_DE_CLASSE.map((c) => [c, pct(data.alocacao_alvo[c] ?? 0)]),
            ) as Formulario["alocacao"],
            limite_ativo: pct(data.limite_ativo),
            limite_setor: pct(data.limite_setor),
            metodos: data.metodos,
            filtro: "",
            evitar: data.evitar.join(", "),
            liquidez: String(data.liquidez_minima),
          }
        : VAZIO,
    );
  }, [data, isSuccess, f]);

  const salvar = useMutation({
    mutationFn: salvarPerfil,
    onSuccess: (p) => {
      cliente.setQueryData(CHAVES.perfil, p);
      void cliente.invalidateQueries({ queryKey: CHAVES.estado });
      setAviso({ erro: false, texto: "Perfil salvo." });
    },
    onError: (e: Error) => setAviso({ erro: true, texto: e.message }),
  });

  if (!f) return <Skeleton className="h-96" />;
  const muda = (parte: Partial<Formulario>) => setF({ ...f, ...parte });
  const soma = NOMES_DE_CLASSE.reduce((s, c) => s + (numero(f.alocacao[c]) || 0), 0);

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    setAviso(null);
    const alocacao_alvo = Object.fromEntries(
      NOMES_DE_CLASSE.flatMap((c) => {
        const v = numero(f.alocacao[c]) || 0;
        return v > 0 ? [[c, v / 100]] : [];
      }),
    );
    const r = PerfilDoInvestidor.safeParse({
      objetivo: f.objetivo,
      horizonte: f.horizonte,
      tolerancia: f.tolerancia,
      alocacao_alvo,
      limite_ativo: numero(f.limite_ativo) / 100,
      limite_setor: numero(f.limite_setor) / 100,
      metodos: f.metodos,
      filtro_salvo: f.filtro
        ? filtroDaUrlDoScreener(f.filtro)
        : (data?.filtro_salvo ?? null),
      evitar: f.evitar.split(/[\s,;]+/).filter(Boolean),
      liquidez_minima: numero(f.liquidez) || 0,
    });
    if (!r.success)
      return setAviso({
        erro: true,
        texto: r.error.issues[0]?.message ?? "Dados inválidos.",
      });
    salvar.mutate(r.data);
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="m-0 text-2xl font-bold">Perfil do investidor</h1>
        <p className="m-0 text-text-2">
          O assistente usa estes critérios para avaliar a carteira e gerar candidatos de
          aporte.
        </p>
      </header>
      <form onSubmit={enviar} className="flex flex-col gap-5" noValidate>
        <Card title="Objetivo">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Opcoes
              rotulo="Objetivo"
              valor={f.objetivo}
              opcoes={OBJETIVOS}
              aoMudar={(objetivo) => muda({ objetivo })}
            />
            <Opcoes
              rotulo="Horizonte"
              valor={f.horizonte}
              opcoes={HORIZONTES}
              aoMudar={(horizonte) => muda({ horizonte })}
            />
            <Opcoes
              rotulo="Tolerância a risco"
              valor={f.tolerancia}
              opcoes={TOLERANCIAS}
              aoMudar={(tolerancia) => muda({ tolerancia })}
            />
          </div>
        </Card>
        <Card title="Alocação-alvo">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {NOMES_DE_CLASSE.map((c) => (
              <Campo
                key={c}
                rotulo={`${CLASSES[c].rotulo} (%)`}
                inputMode="decimal"
                value={f.alocacao[c]}
                onChange={(e) =>
                  muda({ alocacao: { ...f.alocacao, [c]: e.target.value } })
                }
              />
            ))}
          </div>
          <p className="m-0 text-[13px] text-text-2" role="status">
            Soma: <span className="font-mono">{Number(soma.toFixed(2))}%</span> (precisa
            dar 100%)
          </p>
        </Card>
        <Card title="Limites de concentração">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Campo
              rotulo="Por ativo (%)"
              inputMode="decimal"
              value={f.limite_ativo}
              onChange={(e) => muda({ limite_ativo: e.target.value })}
            />
            <Campo
              rotulo="Por setor (%)"
              inputMode="decimal"
              value={f.limite_setor}
              onChange={(e) => muda({ limite_setor: e.target.value })}
            />
            <Campo
              rotulo="Liquidez diária mínima (R$)"
              inputMode="numeric"
              value={f.liquidez}
              onChange={(e) => muda({ liquidez: e.target.value })}
            />
          </div>
        </Card>
        <Card title="Critérios">
          <ul className="m-0 flex list-none flex-col p-0">
            {(Object.keys(METODOS) as Metodo[]).map((m) => (
              <li key={m}>
                <label className="flex min-h-touch cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={f.metodos.includes(m)}
                    onChange={(e) =>
                      muda({
                        metodos: e.target.checked
                          ? [...f.metodos, m]
                          : f.metodos.filter((x) => x !== m),
                      })
                    }
                    className="size-4 accent-accent"
                  />
                  {METODOS[m]}
                </label>
              </li>
            ))}
          </ul>
          {f.metodos.includes("filtro_salvo") && (
            <Campo
              rotulo="Link do filtro no screener"
              placeholder={
                data?.filtro_salvo
                  ? "Filtro salvo. Cole outro link para trocar."
                  : "Cole o link de /screener"
              }
              value={f.filtro}
              onChange={(e) => muda({ filtro: e.target.value })}
            />
          )}
          <Campo
            rotulo="Ativos a evitar"
            placeholder="MGLU3, OIBR3"
            value={f.evitar}
            onChange={(e) => muda({ evitar: e.target.value })}
          />
        </Card>
        <Button
          variant="primary"
          type="submit"
          disabled={salvar.isPending}
          className="self-start"
        >
          Salvar perfil
        </Button>
        {aviso && <Mensagem erro={aviso.erro}>{aviso.texto}</Mensagem>}
      </form>
    </div>
  );
}
