"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { PagamentoDeFatura } from "@bolsiq/finance/puro";
import { Button, Card, Money, Sheet, Skeleton, StatTile, cn } from "@bolsiq/ui";
import { hojeEmSp } from "@/lib/indicadores-tecnicos";
import { CAMPO } from "../conta/campos";
import { dataBr, STATUS_DA_FATURA } from "./Cartoes";
import {
  CHAVE,
  pagarFatura,
  useCartoes,
  useCategorias,
  useContas,
  useFatura,
} from "./cliente";
import { ROTULO } from "./Contas";
import { Barra } from "./Mes";

function Pagamento({
  cartao,
  fatura,
  restante,
  contaPadrao,
  onPago,
}: {
  cartao: string;
  fatura: string;
  restante: string;
  contaPadrao: string | null;
  onPago: () => void;
}) {
  const { data: contas = [] } = useContas();
  const [conta, setConta] = useState(contaPadrao ?? contas[0]?.id ?? "");
  const [data, setData] = useState(hojeEmSp());
  const [valor, setValor] = useState(restante.replace(".", ","));
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function pagar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const pedido = { account_id: conta || undefined, data, valor };
    const r = PagamentoDeFatura.safeParse(pedido);
    if (!r.success) return setErro(r.error.issues[0]?.message ?? "Dados inválidos.");
    setEnviando(true);
    try {
      await pagarFatura(cartao, fatura, pedido);
      onPago();
    } catch (falha) {
      setErro((falha as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={(e) => void pagar(e)} className="flex flex-col gap-3" noValidate>
      <label className={ROTULO}>
        Conta que paga
        <select
          className={CAMPO}
          value={conta}
          onChange={(e) => setConta(e.target.value)}
        >
          <option value="">Escolha</option>
          {contas
            .filter((c) => !c.arquivada)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className={ROTULO}>
          Data do pagamento
          <input
            type="date"
            className={CAMPO}
            value={data}
            onChange={(e) => setData(e.target.value)}
          />
        </label>
        <label className={ROTULO}>
          Valor pago (R$)
          <input
            className={cn(CAMPO, "font-mono")}
            inputMode="decimal"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
          />
        </label>
      </div>
      <p className="m-0 text-xs text-text-3">
        O pagamento é uma transferência da conta para o cartão: as despesas já contaram
        nas compras e não entram de novo.
      </p>
      {erro && (
        <p role="alert" className="m-0 text-sm text-down">
          {erro}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={enviando}>
        Confirmar pagamento
      </Button>
    </form>
  );
}

export function DetalheDaFatura({ cartao, fatura }: { cartao: string; fatura: string }) {
  const cliente = useQueryClient();
  const { data, isPending, error } = useFatura(cartao, fatura);
  const { data: cartoes = [] } = useCartoes();
  const { data: categorias = [] } = useCategorias();
  const [pagando, setPagando] = useState(false);
  const nomeDaCategoria = new Map(categorias.map((c) => [c.id, c.nome]));
  const nome = cartoes.find((c) => c.id === cartao)?.nome ?? "Cartão";

  if (error)
    return (
      <p role="alert" className="m-0 text-sm text-down">
        {error.message}
      </p>
    );
  if (isPending || !data) return <Skeleton className="h-64" />;
  const f = data.fatura;
  const restante = (Number(f.total) - Number(f.pagamentos)).toFixed(2);
  const maior = Math.max(1, ...data.por_categoria.map((c) => Number(c.valor)));

  return (
    <div className="flex flex-col gap-5">
      <Link href="/financas/cartoes" className="flex items-center gap-1 text-sm">
        <ArrowLeft aria-hidden="true" size={16} />
        Cartões
      </Link>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-[26px] font-bold tracking-tight">
          Fatura {nome} · {dataBr(f.vencimento)}
        </h1>
        {f.status !== "paga" && Number(restante) > 0 && (
          <Button variant="primary" onClick={() => setPagando(true)}>
            Pagar fatura
          </Button>
        )}
      </header>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Total" value={<Money value={f.total} />} />
        <StatTile label="Pago" value={<Money value={f.pagamentos} />} />
        <StatTile label="Status" value={STATUS_DA_FATURA[f.status]} />
        <StatTile
          label="Fechamento"
          value={dataBr(f.fechamento)}
          subtitle={
            f.total_informado ? (
              <>
                banco informou <Money value={f.total_informado} />
              </>
            ) : undefined
          }
        />
      </div>
      <Card title="Por categoria">
        {data.por_categoria.length === 0 ? (
          <p className="m-0 text-sm text-text-3">Nenhuma compra nesta fatura.</p>
        ) : (
          <ul
            aria-label="Compras por categoria"
            className="m-0 flex list-none flex-col gap-3 p-0"
          >
            {data.por_categoria.map((c) => (
              <li key={c.category_id ?? "sem"} className="flex flex-col gap-1.5">
                <span className="flex justify-between text-sm">
                  <span>{c.nome}</span>
                  <Money value={c.valor} className="font-semibold" />
                </span>
                <Barra valor={Number(c.valor)} total={maior} rotulo={c.nome} />
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Lançamentos da fatura">
        <table aria-label="Lançamentos da fatura" className="w-full text-sm">
          <tbody>
            {data.lancamentos.map((l) => (
              <tr key={l.id} className="border-t border-border first:border-0">
                <td className="py-2 font-mono text-xs whitespace-nowrap">
                  {dataBr(l.data)}
                </td>
                <td className="py-2">
                  {l.descricao}
                  <span className="block text-xs text-text-3">
                    {l.tipo === "transferencia"
                      ? `pagamento${l.status === "previsto" ? " previsto" : ""}`
                      : l.category_id
                        ? nomeDaCategoria.get(l.category_id)
                        : "sem categoria"}
                  </span>
                </td>
                <td className="py-2 text-right whitespace-nowrap">
                  <Money
                    value={l.tipo === "despesa" ? `-${l.valor}` : l.valor}
                    className={l.tipo === "despesa" ? "text-down" : "text-text-2"}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Sheet open={pagando} onOpenChange={setPagando} title="Pagar fatura">
        {pagando && (
          <Pagamento
            cartao={cartao}
            fatura={fatura}
            restante={restante}
            contaPadrao={data.conta_pagadora}
            onPago={() => {
              setPagando(false);
              void cliente.invalidateQueries({ queryKey: CHAVE });
            }}
          />
        )}
      </Sheet>
    </div>
  );
}
