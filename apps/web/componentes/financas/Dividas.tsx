"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { NovoEmprestimo } from "@bolsiq/finance/puro";
import {
  Button,
  Card,
  EmptyState,
  Money,
  Sheet,
  Skeleton,
  StatTile,
  cn,
} from "@bolsiq/ui";
import { hojeEmSp } from "@/lib/indicadores-tecnicos";
import { CAMPO } from "../conta/campos";
import { dataBr } from "./Cartoes";
import {
  amortizarDivida,
  CHAVE,
  criarDivida,
  quitarPlano,
  simularDivida,
  useCategorias,
  useContas,
  usePlano,
  usePlanos,
} from "./cliente";
import { ROTULO } from "./Contas";

const pct = (taxa: string) =>
  `${(Number(taxa) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 4 })}% a.m.`;

function FormularioDeDivida({ onSalva }: { onSalva: () => void }) {
  const { data: contas = [] } = useContas();
  const { data: categorias = [] } = useCategorias();
  const [origem, setOrigem] = useState("emprestimo");
  const [descricao, setDescricao] = useState("");
  const [conta, setConta] = useState("");
  const [categoria, setCategoria] = useState("");
  const [valor, setValor] = useState("");
  const [taxa, setTaxa] = useState("");
  const [n, setN] = useState("");
  const [sistema, setSistema] = useState("price");
  const [primeira, setPrimeira] = useState(hojeEmSp());
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const contaEscolhida = conta || (contas.find((c) => !c.arquivada)?.id ?? "");

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const pedido = {
      origem,
      account_id: contaEscolhida,
      descricao,
      category_id: categoria || null,
      valor_financiado: valor,
      taxa_mensal: taxa,
      n_parcelas: n,
      sistema,
      primeira_data: primeira,
    };
    const r = NovoEmprestimo.safeParse(pedido);
    if (!r.success) return setErro(r.error.issues[0]?.message ?? "Dados inválidos.");
    setEnviando(true);
    try {
      await criarDivida(pedido);
      onSalva();
    } catch (falha) {
      setErro((falha as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={(e) => void salvar(e)} className="flex flex-col gap-3" noValidate>
      <div className="grid grid-cols-2 gap-3">
        <label className={ROTULO}>
          Tipo
          <select
            className={CAMPO}
            value={origem}
            onChange={(e) => setOrigem(e.target.value)}
          >
            <option value="emprestimo">Empréstimo</option>
            <option value="financiamento">Financiamento</option>
          </select>
        </label>
        <label className={ROTULO}>
          Sistema
          <select
            className={CAMPO}
            value={sistema}
            onChange={(e) => setSistema(e.target.value)}
          >
            <option value="price">Price (parcela fixa)</option>
            <option value="sac">SAC (amortização constante)</option>
          </select>
        </label>
        <label className={cn(ROTULO, "col-span-2")}>
          Descrição
          <input
            className={CAMPO}
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Financiamento do carro"
          />
        </label>
        <label className={ROTULO}>
          Valor financiado (R$)
          <input
            className={cn(CAMPO, "font-mono")}
            inputMode="decimal"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            placeholder="0,00"
          />
        </label>
        <label className={ROTULO}>
          Taxa (% ao mês)
          <input
            className={cn(CAMPO, "font-mono")}
            inputMode="decimal"
            value={taxa}
            onChange={(e) => setTaxa(e.target.value)}
            placeholder="1,49"
          />
        </label>
        <label className={ROTULO}>
          Parcelas
          <input
            className={cn(CAMPO, "font-mono")}
            inputMode="numeric"
            value={n}
            onChange={(e) => setN(e.target.value)}
            placeholder="48"
          />
        </label>
        <label className={ROTULO}>
          Primeiro vencimento
          <input
            type="date"
            className={CAMPO}
            value={primeira}
            onChange={(e) => setPrimeira(e.target.value)}
          />
        </label>
        <label className={ROTULO}>
          Conta que paga
          <select
            className={CAMPO}
            value={contaEscolhida}
            onChange={(e) => setConta(e.target.value)}
          >
            {contas
              .filter((c) => !c.arquivada)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
          </select>
        </label>
        <label className={ROTULO}>
          Categoria
          <select
            className={CAMPO}
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
          >
            <option value="">Sem categoria</option>
            {categorias
              .filter((c) => c.natureza === "despesa" && !c.arquivada)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
          </select>
        </label>
      </div>
      <p className="m-0 text-xs text-text-3">
        As parcelas viram lançamentos previstos na conta; as de datas que já passaram
        entram como pagas.
      </p>
      {erro && (
        <p role="alert" className="m-0 text-sm text-down">
          {erro}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={enviando}>
        Cadastrar dívida
      </Button>
    </form>
  );
}

function DetalheDaDivida({ id, onMudou }: { id: string; onMudou: () => void }) {
  const { data, isPending } = usePlano(id);
  const [extra, setExtra] = useState("");
  const [modo, setModo] = useState<"reduzir_prazo" | "reduzir_parcela">("reduzir_prazo");
  const [sim, setSim] = useState<Awaited<ReturnType<typeof simularDivida>> | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  if (isPending || !data) return <Skeleton className="h-40" />;
  const ativa = data.parcelas_restantes > 0;

  const tentar = (fn: () => Promise<unknown>) => {
    setErro(null);
    fn().catch((f: Error) => setErro(f.message));
  };

  return (
    <div className="flex flex-col gap-4">
      {ativa && (
        <Card title="Simular amortização extra">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[160px_220px_auto_auto] md:items-end">
            <label className={ROTULO}>
              Valor extra (R$)
              <input
                className={cn(CAMPO, "font-mono")}
                inputMode="decimal"
                value={extra}
                onChange={(e) => {
                  setExtra(e.target.value);
                  setSim(null);
                }}
                placeholder="0,00"
              />
            </label>
            <label className={ROTULO}>
              Usar para
              <select
                className={CAMPO}
                value={modo}
                onChange={(e) => {
                  setModo(e.target.value as typeof modo);
                  setSim(null);
                }}
              >
                <option value="reduzir_prazo">Reduzir o prazo</option>
                <option value="reduzir_parcela">Reduzir a parcela</option>
              </select>
            </label>
            <Button
              variant="secondary"
              disabled={!extra}
              onClick={() =>
                tentar(async () => setSim(await simularDivida(id, { extra, modo })))
              }
            >
              Simular
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                if (window.confirm("Quitar o saldo devedor hoje?"))
                  tentar(async () => {
                    await quitarPlano(id, hojeEmSp());
                    onMudou();
                  });
              }}
            >
              Quitar
            </Button>
          </div>
          {sim && (
            <div role="status" className="mt-3 flex flex-col gap-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <StatTile
                  label="Parcelas restantes"
                  value={`${sim.antes.parcelas} → ${sim.depois.parcelas}`}
                />
                <StatTile
                  label="Parcela"
                  value={<Money value={sim.depois.primeira_parcela} />}
                  subtitle={
                    <>
                      antes <Money value={sim.antes.primeira_parcela} />
                    </>
                  }
                />
                <StatTile
                  label="Juros economizados"
                  value={<Money value={sim.juros_economizados} className="text-up" />}
                />
              </div>
              <Button
                variant="primary"
                className="self-start"
                onClick={() =>
                  tentar(async () => {
                    await amortizarDivida(id, { extra, modo, data: hojeEmSp() });
                    setSim(null);
                    setExtra("");
                    onMudou();
                  })
                }
              >
                Registrar amortização
              </Button>
            </div>
          )}
          {erro && (
            <p role="alert" className="m-0 text-sm text-down">
              {erro}
            </p>
          )}
        </Card>
      )}
      <Card title="Tabela de parcelas">
        <div className="overflow-x-auto">
          <table aria-label="Tabela de parcelas" className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="text-right text-xs text-text-3">
                <th className="py-1.5 text-left font-medium">#</th>
                <th className="py-1.5 text-left font-medium">Vencimento</th>
                <th className="py-1.5 font-medium">Parcela</th>
                <th className="py-1.5 font-medium">Juros</th>
                <th className="py-1.5 font-medium">Amortização</th>
                <th className="py-1.5 font-medium">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {data.tabela.map((l) => (
                <tr
                  key={l.numero}
                  className={cn(
                    "border-t border-border text-right font-mono text-xs",
                    l.status !== "previsto" && "text-text-3",
                  )}
                >
                  <td className="py-1.5 text-left">{l.numero}</td>
                  <td className="py-1.5 text-left">
                    {dataBr(l.data)}
                    {l.status !== "previsto" && (
                      <span className="ml-1 font-sans">paga</span>
                    )}
                  </td>
                  <td className="py-1.5">
                    <Money value={l.parcela} />
                  </td>
                  <td className="py-1.5">
                    <Money value={l.juros} />
                  </td>
                  <td className="py-1.5">
                    <Money value={l.amortizacao} />
                  </td>
                  <td className="py-1.5">
                    <Money value={l.saldo} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

export function PaginaDeDividas() {
  const cliente = useQueryClient();
  const { data: planos, isPending } = usePlanos();
  const [aberto, setAberto] = useState(false);
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const atualizar = () => void cliente.invalidateQueries({ queryKey: CHAVE });
  const dividas = (planos ?? []).filter((p) => p.origem !== "cartao");
  const saldo = dividas.reduce((s, p) => s + Number(p.saldo_devedor), 0).toFixed(2);
  const mensal = dividas
    .filter((p) => p.proxima)
    .reduce((s, p) => s + Number(p.proxima?.valor ?? 0), 0)
    .toFixed(2);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-[26px] font-bold tracking-tight">Dívidas</h1>
        <Button variant="primary" onClick={() => setAberto(true)}>
          <Plus aria-hidden="true" size={16} />
          Empréstimo ou financiamento
        </Button>
      </header>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatTile label="Saldo devedor" value={<Money value={saldo} />} />
        <StatTile label="Próximas parcelas somadas" value={<Money value={mensal} />} />
      </div>
      <Card>
        {isPending ? (
          <Skeleton className="h-24" />
        ) : dividas.length === 0 ? (
          <EmptyState
            title="Nenhuma dívida cadastrada"
            description="Cadastre o empréstimo ou financiamento para ver a tabela, o saldo devedor e simular amortizações."
          />
        ) : (
          <ul aria-label="Dívidas" className="m-0 flex list-none flex-col p-0">
            {dividas.map((p) => (
              <li key={p.id} className="border-b border-border py-3 last:border-0">
                <button
                  type="button"
                  aria-expanded={escolhida === p.id}
                  onClick={() => setEscolhida(escolhida === p.id ? null : p.id)}
                  className={cn(
                    "flex w-full cursor-pointer flex-wrap items-center gap-3 border-0 bg-transparent p-0 text-left text-text",
                    !p.ativo && "opacity-60",
                  )}
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-semibold">{p.descricao}</span>
                    <span className="text-xs text-text-3">
                      {p.origem === "financiamento" ? "Financiamento" : "Empréstimo"} ·{" "}
                      {p.sistema.toUpperCase()} · {pct(p.taxa_mensal)} ·{" "}
                      {p.parcelas_pagas}/{p.parcelas_pagas + p.parcelas_restantes} pagas
                      {p.proxima ? ` · próxima ${dataBr(p.proxima.data)}` : " · quitada"}
                    </span>
                  </span>
                  <span className="flex flex-col items-end">
                    <Money value={p.saldo_devedor} className="font-semibold" />
                    <span className="text-xs text-text-3">saldo devedor</span>
                  </span>
                </button>
                {escolhida === p.id && (
                  <div className="mt-3">
                    <DetalheDaDivida id={p.id} onMudou={atualizar} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Sheet open={aberto} onOpenChange={setAberto} title="Empréstimo ou financiamento">
        {aberto && (
          <FormularioDeDivida
            onSalva={() => {
              setAberto(false);
              atualizar();
            }}
          />
        )}
      </Sheet>
    </div>
  );
}
