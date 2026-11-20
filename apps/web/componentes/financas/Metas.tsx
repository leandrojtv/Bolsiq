"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash } from "lucide-react";
import { useState, type FormEvent } from "react";
import { NovaMeta, type Meta } from "@bolsiq/finance/puro";
import { Button, Card, EmptyState, Money, Sheet, Skeleton, cn } from "@bolsiq/ui";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { CAMPO } from "../conta/campos";
import { dataBr } from "./Cartoes";
import { apagarMeta, CHAVE, criarMeta, editarMeta, useContas, useMetas } from "./cliente";
import { ROTULO } from "./Contas";
import { Barra } from "./Mes";

const FONTE = {
  conta: "pelo saldo da conta",
  carteira: "pela carteira",
  manual: "valor guardado",
};

function FormularioDeMeta({ inicial, onSalva }: { inicial?: Meta; onSalva: () => void }) {
  const { data: contas = [] } = useContas();
  const { data: carteiras = [] } = useQuery({
    queryKey: ["carteiras", "lista"],
    queryFn: () =>
      api<{ data: { id: string; nome: string }[] }>("carteiras")
        .then((r) => r.data)
        .catch(() => []),
  });
  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [alvo, setAlvo] = useState(inicial?.valor_alvo.replace(".", ",") ?? "");
  const [data, setData] = useState(inicial?.data_alvo ?? "");
  const [fonte, setFonte] = useState(
    inicial?.account_id
      ? `conta:${inicial.account_id}`
      : inicial?.portfolio_id
        ? `carteira:${inicial.portfolio_id}`
        : "",
  );
  const [guardado, setGuardado] = useState(
    inicial?.valor_guardado.replace(".", ",") ?? "",
  );
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const pedido = {
      nome,
      valor_alvo: alvo,
      data_alvo: data,
      account_id: fonte.startsWith("conta:") ? fonte.slice(6) : null,
      portfolio_id: fonte.startsWith("carteira:") ? fonte.slice(9) : null,
      valor_guardado: guardado || "0",
    };
    const r = NovaMeta.safeParse(pedido);
    if (!r.success) return setErro(r.error.issues[0]?.message ?? "Dados inválidos.");
    setEnviando(true);
    try {
      await (inicial ? editarMeta(inicial.id, pedido) : criarMeta(pedido));
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
        Nome da meta
        <input
          className={CAMPO}
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Reserva de emergência, viagem"
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className={ROTULO}>
          Quanto (R$)
          <input
            className={cn(CAMPO, "font-mono")}
            inputMode="decimal"
            value={alvo}
            onChange={(e) => setAlvo(e.target.value)}
            placeholder="0,00"
          />
        </label>
        <label className={ROTULO}>
          Até quando
          <input
            type="date"
            className={CAMPO}
            value={data}
            onChange={(e) => setData(e.target.value)}
          />
        </label>
        <label className={cn(ROTULO, "col-span-2")}>
          Acompanhar por
          <select
            className={CAMPO}
            value={fonte}
            onChange={(e) => setFonte(e.target.value)}
          >
            <option value="">Valor que eu informo</option>
            <optgroup label="Saldo da conta">
              {contas.map((c) => (
                <option key={c.id} value={`conta:${c.id}`}>
                  {c.nome}
                </option>
              ))}
            </optgroup>
            {carteiras.length > 0 && (
              <optgroup label="Carteira de investimentos">
                {carteiras.map((c) => (
                  <option key={c.id} value={`carteira:${c.id}`}>
                    {c.nome}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        {fonte === "" && (
          <label className={ROTULO}>
            Já guardado (R$)
            <input
              className={cn(CAMPO, "font-mono")}
              inputMode="decimal"
              value={guardado}
              onChange={(e) => setGuardado(e.target.value)}
              placeholder="0,00"
            />
          </label>
        )}
      </div>
      {erro && (
        <p role="alert" className="m-0 text-sm text-down">
          {erro}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={enviando}>
        {inicial ? "Salvar alterações" : "Criar meta"}
      </Button>
    </form>
  );
}

export function PaginaDeMetas() {
  const cliente = useQueryClient();
  const { data: metas, isPending } = useMetas();
  const [aberta, setAberta] = useState<Meta | "nova" | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const atualizar = () => void cliente.invalidateQueries({ queryKey: CHAVE });

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-[26px] font-bold tracking-tight">Metas</h1>
        <Button variant="primary" onClick={() => setAberta("nova")}>
          <Plus aria-hidden="true" size={16} />
          Nova meta
        </Button>
      </header>
      {erro && (
        <p role="alert" className="m-0 text-sm text-down">
          {erro}
        </p>
      )}
      {isPending ? (
        <Skeleton className="h-32" />
      ) : !metas?.length ? (
        <Card>
          <EmptyState
            title="Nenhuma meta ainda"
            description="Defina quanto quer juntar e até quando: o Bolsiq mostra quanto guardar por mês."
          />
        </Card>
      ) : (
        <ul
          aria-label="Metas"
          className="m-0 grid list-none grid-cols-1 gap-4 p-0 md:grid-cols-2"
        >
          {metas.map((m) => (
            <li key={m.id}>
              <Card>
                <div className="flex flex-col gap-3">
                  <div className="flex items-start gap-2">
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="font-semibold">{m.nome}</span>
                      <span className="text-xs text-text-3">
                        até {dataBr(m.data_alvo)} · {FONTE[m.fonte]}
                      </span>
                    </span>
                    <Button
                      variant="ghost"
                      className="px-2"
                      aria-label={`Editar ${m.nome}`}
                      onClick={() => setAberta(m)}
                    >
                      <Pencil aria-hidden="true" size={16} />
                    </Button>
                    <Button
                      variant="ghost"
                      className="px-2"
                      aria-label={`Apagar ${m.nome}`}
                      onClick={() => {
                        if (!window.confirm(`Apagar a meta ${m.nome}?`)) return;
                        setErro(null);
                        apagarMeta(m.id)
                          .then(atualizar)
                          .catch((f: Error) => setErro(f.message));
                      }}
                    >
                      <Trash aria-hidden="true" size={16} />
                    </Button>
                  </div>
                  <span className="text-sm">
                    <Money value={m.valor_atual} className="font-semibold" /> de{" "}
                    <Money value={m.valor_alvo} /> · {m.progresso.toLocaleString("pt-BR")}
                    %
                  </span>
                  <Barra
                    valor={Number(m.valor_atual)}
                    total={Number(m.valor_alvo)}
                    rotulo={`Progresso de ${m.nome}`}
                  />
                  <span className="text-sm text-text-2">
                    {Number(m.valor_mensal_necessario) > 0 ? (
                      <>
                        Guardar{" "}
                        <Money
                          value={m.valor_mensal_necessario}
                          className="font-semibold"
                        />{" "}
                        por mês{" "}
                        {m.meses_restantes > 0
                          ? `nos próximos ${m.meses_restantes} meses`
                          : "neste mês"}
                      </>
                    ) : (
                      "Meta atingida."
                    )}
                  </span>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <Sheet
        open={aberta !== null}
        onOpenChange={(v) => !v && setAberta(null)}
        title={aberta === "nova" || aberta === null ? "Nova meta" : "Editar meta"}
      >
        {aberta !== null && (
          <FormularioDeMeta
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
