"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Pencil, Plus, Trash } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { NovaConta, TIPOS_DE_CONTA, type Conta } from "@bolsiq/finance/puro";
import { Button, Card, EmptyState, Money, Sheet, Skeleton, cn } from "@bolsiq/ui";
import { hojeEmSp } from "@/lib/indicadores-tecnicos";
import { CAMPO } from "../conta/campos";
import { apagarConta, CHAVE, criarConta, editarConta, useContas } from "./cliente";

export const ROTULO = "flex flex-col gap-1.5 text-xs text-text-3";
const ROTULO_DO_TIPO = Object.fromEntries(TIPOS_DE_CONTA.map((t) => [t.tipo, t.rotulo]));
const paraCampo = (v: string) => v.replace(".", ",");

export function FormularioDeConta({
  inicial,
  onSalva,
}: {
  inicial?: Conta;
  onSalva: () => void;
}) {
  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [tipo, setTipo] = useState<string>(inicial?.tipo ?? "corrente");
  const [instituicao, setInstituicao] = useState(inicial?.instituicao ?? "");
  const [saldo, setSaldo] = useState(paraCampo(inicial?.saldo_inicial ?? ""));
  const [data, setData] = useState(inicial?.data_saldo_inicial ?? hojeEmSp());
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const digitada = {
      nome,
      tipo,
      instituicao,
      saldo_inicial: saldo || "0",
      data_saldo_inicial: data,
    };
    const r = NovaConta.safeParse(digitada);
    if (!r.success) return setErro(r.error.issues[0]?.message ?? "Dados inválidos.");
    setEnviando(true);
    try {
      await (inicial ? editarConta(inicial.id, digitada) : criarConta(digitada));
      onSalva();
    } catch (falha) {
      setErro((falha as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={(e) => void salvar(e)} className="flex flex-col gap-3" noValidate>
      <label className={ROTULO}>
        Nome da conta
        <input
          className={CAMPO}
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Conta do banco"
          autoComplete="off"
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className={ROTULO}>
          Tipo
          <select
            className={CAMPO}
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
          >
            {TIPOS_DE_CONTA.map((t) => (
              <option key={t.tipo} value={t.tipo}>
                {t.rotulo}
              </option>
            ))}
          </select>
        </label>
        <label className={ROTULO}>
          Instituição
          <input
            className={CAMPO}
            value={instituicao}
            onChange={(e) => setInstituicao(e.target.value)}
            placeholder="Opcional"
          />
        </label>
        <label className={ROTULO}>
          Saldo inicial (R$)
          <input
            className={cn(CAMPO, "font-mono")}
            inputMode="decimal"
            value={saldo}
            onChange={(e) => setSaldo(e.target.value)}
            placeholder="0,00"
          />
        </label>
        <label className={ROTULO}>
          Saldo em
          <input
            type="date"
            className={CAMPO}
            value={data}
            onChange={(e) => setData(e.target.value)}
          />
        </label>
      </div>
      {erro && (
        <p role="alert" className="m-0 text-sm text-down">
          {erro}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={enviando}>
        {inicial ? "Salvar alterações" : "Criar conta"}
      </Button>
    </form>
  );
}

export function PaginaDeContas() {
  const cliente = useQueryClient();
  const { data: contas, isPending } = useContas();
  const [aberta, setAberta] = useState<Conta | "nova" | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const atualizar = () => void cliente.invalidateQueries({ queryKey: CHAVE });

  // /financas/contas?nova=1 vem do estado vazio da visao geral.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("nova")) setAberta("nova");
  }, []);

  async function agir(fn: () => Promise<unknown>) {
    setErro(null);
    try {
      await fn();
      atualizar();
    } catch (falha) {
      setErro((falha as Error).message);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-[26px] font-bold tracking-tight">Contas</h1>
        <Button variant="primary" onClick={() => setAberta("nova")}>
          <Plus aria-hidden="true" size={16} />
          Nova conta
        </Button>
      </header>
      {erro && (
        <p role="alert" className="m-0 text-sm text-down">
          {erro}
        </p>
      )}
      <Card>
        {isPending ? (
          <Skeleton className="h-24" />
        ) : !contas?.length ? (
          <EmptyState
            title="Nenhuma conta ainda"
            description="Crie a conta do banco, a carteira de dinheiro ou o vale-refeição."
          />
        ) : (
          <ul aria-label="Contas" className="m-0 flex list-none flex-col p-0">
            {contas.map((c) => (
              <li
                key={c.id}
                className={cn(
                  "flex flex-wrap items-center gap-3 border-b border-border py-3 last:border-0",
                  c.arquivada && "opacity-60",
                )}
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="font-semibold">
                    {c.nome}
                    {c.arquivada && (
                      <span className="ml-2 text-xs text-text-3">arquivada</span>
                    )}
                  </span>
                  <span className="text-xs text-text-3">
                    {ROTULO_DO_TIPO[c.tipo]}
                    {c.instituicao ? ` · ${c.instituicao}` : ""}
                  </span>
                </div>
                <Money
                  value={c.saldo_atual}
                  className={cn(
                    "font-semibold",
                    c.saldo_atual.startsWith("-") && "text-down",
                  )}
                />
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    aria-label={`Editar ${c.nome}`}
                    onClick={() => setAberta(c)}
                  >
                    <Pencil aria-hidden="true" size={16} />
                  </Button>
                  <Button
                    variant="ghost"
                    aria-label={
                      c.arquivada ? `Desarquivar ${c.nome}` : `Arquivar ${c.nome}`
                    }
                    onClick={() =>
                      void agir(() => editarConta(c.id, { arquivada: !c.arquivada }))
                    }
                  >
                    {c.arquivada ? (
                      <ArchiveRestore aria-hidden="true" size={16} />
                    ) : (
                      <Archive aria-hidden="true" size={16} />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    aria-label={`Apagar ${c.nome}`}
                    onClick={() => {
                      if (window.confirm(`Apagar a conta ${c.nome}?`))
                        void agir(() => apagarConta(c.id));
                    }}
                  >
                    <Trash aria-hidden="true" size={16} />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Sheet
        open={aberta !== null}
        onOpenChange={(v) => !v && setAberta(null)}
        title={aberta === "nova" || aberta === null ? "Nova conta" : "Editar conta"}
      >
        {aberta !== null && (
          <FormularioDeConta
            {...(aberta === "nova" ? {} : { inicial: aberta })}
            onSalva={() => {
              setAberta(null);
              atualizar();
            }}
          />
        )}
      </Sheet>
    </div>
  );
}
