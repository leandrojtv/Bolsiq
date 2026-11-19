"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Pencil, Plus, Trash } from "lucide-react";
import { useState, type FormEvent } from "react";
import { NovoCartao, type Cartao } from "@bolsiq/finance/puro";
import { Button, Card, EmptyState, Money, Sheet, Skeleton, cn } from "@bolsiq/ui";
import { CAMPO } from "../conta/campos";
import {
  apagarCartao,
  CHAVE,
  criarCartao,
  editarCartao,
  useCartoes,
  useContas,
  useFaturas,
} from "./cliente";
import { ROTULO } from "./Contas";

export const dataBr = (d: string) => d.split("-").reverse().join("/");

export function FormularioDeCartao({
  inicial,
  onSalvo,
}: {
  inicial?: Cartao;
  onSalvo: () => void;
}) {
  const { data: contas = [] } = useContas();
  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [instituicao, setInstituicao] = useState(inicial?.instituicao ?? "");
  const [final, setFinal] = useState(inicial?.final ?? "");
  const [limite, setLimite] = useState(inicial?.limite?.replace(".", ",") ?? "");
  const [fechamento, setFechamento] = useState(String(inicial?.dia_fechamento ?? ""));
  const [vencimento, setVencimento] = useState(String(inicial?.dia_vencimento ?? ""));
  const [conta, setConta] = useState(inicial?.account_id ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const digitado = {
      nome,
      instituicao,
      final,
      limite,
      dia_fechamento: fechamento,
      dia_vencimento: vencimento,
      account_id: conta || null,
    };
    const r = NovoCartao.safeParse(digitado);
    if (!r.success) return setErro(r.error.issues[0]?.message ?? "Dados inválidos.");
    setEnviando(true);
    try {
      await (inicial ? editarCartao(inicial.id, digitado) : criarCartao(digitado));
      onSalvo();
    } catch (falha) {
      setErro((falha as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={(e) => void salvar(e)} className="flex flex-col gap-3" noValidate>
      <label className={ROTULO}>
        Nome do cartão
        <input
          className={CAMPO}
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Cartão do banco"
          autoComplete="off"
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
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
          Final do cartão
          <input
            className={cn(CAMPO, "font-mono")}
            inputMode="numeric"
            maxLength={4}
            value={final}
            onChange={(e) => setFinal(e.target.value)}
            placeholder="1234"
          />
        </label>
        <label className={ROTULO}>
          Dia do fechamento
          <input
            className={cn(CAMPO, "font-mono")}
            inputMode="numeric"
            value={fechamento}
            onChange={(e) => setFechamento(e.target.value)}
            placeholder="3"
          />
        </label>
        <label className={ROTULO}>
          Dia do vencimento
          <input
            className={cn(CAMPO, "font-mono")}
            inputMode="numeric"
            value={vencimento}
            onChange={(e) => setVencimento(e.target.value)}
            placeholder="10"
          />
        </label>
        <label className={ROTULO}>
          Limite (R$)
          <input
            className={cn(CAMPO, "font-mono")}
            inputMode="decimal"
            value={limite}
            onChange={(e) => setLimite(e.target.value)}
            placeholder="Opcional"
          />
        </label>
        <label className={ROTULO}>
          Conta que paga a fatura
          <select
            className={CAMPO}
            value={conta}
            onChange={(e) => setConta(e.target.value)}
          >
            <option value="">Nenhuma</option>
            {contas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="m-0 text-xs text-text-3">
        Compra feita antes do dia do fechamento entra na fatura que vence a seguir; no dia
        do fechamento ou depois, na próxima.
      </p>
      {erro && (
        <p role="alert" className="m-0 text-sm text-down">
          {erro}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={enviando}>
        {inicial ? "Salvar alterações" : "Criar cartão"}
      </Button>
    </form>
  );
}

function Faturas({ cartao }: { cartao: Cartao }) {
  const { data = [], isPending } = useFaturas(cartao.id);
  if (isPending) return <Skeleton className="h-16" />;
  const comMovimento = data.filter(
    (f) => f.lancamentos > 0 || f.vencimento === cartao.fatura_atual.vencimento,
  );
  return (
    <table aria-label={`Faturas de ${cartao.nome}`} className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-text-3">
          <th className="py-1.5 font-medium">Vencimento</th>
          <th className="hidden py-1.5 font-medium md:table-cell">Fechamento</th>
          <th className="py-1.5 text-right font-medium">Total</th>
          <th className="hidden py-1.5 text-right font-medium md:table-cell">Pago</th>
        </tr>
      </thead>
      <tbody>
        {comMovimento.map((f) => (
          <tr key={f.vencimento} className="border-t border-border">
            <td className="py-2 font-mono text-xs">
              {dataBr(f.vencimento)}
              {f.vencimento === cartao.fatura_atual.vencimento && (
                <span className="ml-2 font-sans text-text-3">atual</span>
              )}
            </td>
            <td className="hidden py-2 font-mono text-xs md:table-cell">
              {dataBr(f.fechamento)}
            </td>
            <td className="py-2 text-right">
              <Money value={f.total} />
            </td>
            <td className="hidden py-2 text-right text-text-2 md:table-cell">
              <Money value={f.pagamentos} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function PaginaDeCartoes() {
  const cliente = useQueryClient();
  const { data: cartoes, isPending } = useCartoes();
  const [aberto, setAberto] = useState<Cartao | "novo" | null>(null);
  const [expandido, setExpandido] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const atualizar = () => void cliente.invalidateQueries({ queryKey: CHAVE });

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
        <h1 className="m-0 text-[26px] font-bold tracking-tight">Cartões</h1>
        <Button variant="primary" onClick={() => setAberto("novo")}>
          <Plus aria-hidden="true" size={16} />
          Novo cartão
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
        ) : !cartoes?.length ? (
          <EmptyState
            title="Nenhum cartão ainda"
            description="Cadastre o cartão com o dia do fechamento e do vencimento para lançar compras e importar a fatura."
          />
        ) : (
          <ul aria-label="Cartões" className="m-0 flex list-none flex-col p-0">
            {cartoes.map((c) => (
              <li
                key={c.id}
                className={cn(
                  "flex flex-col gap-3 border-b border-border py-3 last:border-0",
                  c.arquivado && "opacity-60",
                )}
              >
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 cursor-pointer flex-col border-0 bg-transparent p-0 text-left text-text"
                    aria-expanded={expandido === c.id}
                    onClick={() => setExpandido(expandido === c.id ? null : c.id)}
                  >
                    <span className="font-semibold">
                      {c.nome}
                      {c.final && (
                        <span className="ml-2 font-mono text-xs text-text-3">
                          final {c.final}
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-text-3">
                      Fecha dia {c.dia_fechamento} · vence dia {c.dia_vencimento}
                      {c.instituicao ? ` · ${c.instituicao}` : ""}
                    </span>
                  </button>
                  <div className="flex flex-col items-end">
                    <Money value={c.fatura_atual.total} className="font-semibold" />
                    <span className="text-xs text-text-3">
                      fatura de {dataBr(c.fatura_atual.vencimento)}
                    </span>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      aria-label={`Editar ${c.nome}`}
                      onClick={() => setAberto(c)}
                    >
                      <Pencil aria-hidden="true" size={16} />
                    </Button>
                    <Button
                      variant="ghost"
                      aria-label={
                        c.arquivado ? `Desarquivar ${c.nome}` : `Arquivar ${c.nome}`
                      }
                      onClick={() =>
                        void agir(() => editarCartao(c.id, { arquivado: !c.arquivado }))
                      }
                    >
                      {c.arquivado ? (
                        <ArchiveRestore aria-hidden="true" size={16} />
                      ) : (
                        <Archive aria-hidden="true" size={16} />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      aria-label={`Apagar ${c.nome}`}
                      onClick={() => {
                        if (window.confirm(`Apagar o cartão ${c.nome}?`))
                          void agir(() => apagarCartao(c.id));
                      }}
                    >
                      <Trash aria-hidden="true" size={16} />
                    </Button>
                  </div>
                </div>
                {expandido === c.id && <Faturas cartao={c} />}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Sheet
        open={aberto !== null}
        onOpenChange={(v) => !v && setAberto(null)}
        title={aberto === "novo" || aberto === null ? "Novo cartão" : "Editar cartão"}
      >
        {aberto !== null && (
          <FormularioDeCartao
            {...(aberto === "novo" ? {} : { inicial: aberto })}
            onSalvo={() => {
              setAberto(null);
              atualizar();
            }}
          />
        )}
      </Sheet>
    </div>
  );
}
