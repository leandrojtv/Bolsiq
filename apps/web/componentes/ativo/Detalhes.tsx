"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { AssetDetail, Dividend, FundamentalsPeriod } from "@bolsiq/contracts";
import {
  DataTable,
  EmptyState,
  ErrorState,
  formatarNumero,
  formatarPercentual,
  Money,
  SegmentedControl,
  Skeleton,
  Tabs,
  type Column,
} from "@bolsiq/ui";
import { api, type Envelope } from "@/lib/api";
import type { Fundamentos } from "./tipos";

const ROTULO: Record<Dividend["kind"], string> = {
  dividendo: "Dividendo",
  jcp: "JCP",
  bonificacao: "Bonificação",
  desdobramento: "Desdobramento",
  grupamento: "Grupamento",
};

const data = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "—");

export function porAno(
  proventos: Dividend[],
  anos = 6,
): { ano: string; valor: number }[] {
  const somas = new Map<string, number>();
  for (const p of proventos) {
    if (p.value_per_share === null) continue;
    const ano = p.ex_date.slice(0, 4);
    somas.set(ano, (somas.get(ano) ?? 0) + Number(p.value_per_share));
  }
  return [...somas.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-anos)
    .map(([ano, valor]) => ({ ano, valor }));
}

const COLUNAS_PROVENTOS: Column<Dividend>[] = [
  { key: "tipo", header: "Tipo", cell: (p) => ROTULO[p.kind] },
  {
    key: "ex",
    header: "Data ex",
    cell: (p) => <span className="font-mono">{data(p.ex_date)}</span>,
    sortValue: (p) => p.ex_date,
  },
  {
    key: "pag",
    header: "Pagamento",
    cell: (p) => <span className="font-mono">{data(p.payment_date)}</span>,
  },
  {
    key: "valor",
    header: "Valor",
    numeric: true,
    cell: (p) =>
      p.value_per_share ? (
        <Money value={p.value_per_share} decimals={4} />
      ) : (
        (p.ratio ?? "—")
      ),
  },
];

function Proventos({ proventos }: { proventos: Dividend[] | null }) {
  if (proventos === null)
    return <ErrorState description="Proventos indisponíveis na fonte." />;
  if (proventos.length === 0) {
    return (
      <EmptyState
        title="Sem proventos registrados"
        description="A fonte não informou proventos para este ativo."
      />
    );
  }
  const anos = porAno(proventos);
  const maior = Math.max(...anos.map((a) => a.valor), 0.0001);
  return (
    <div className="flex flex-wrap gap-6">
      <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-2">
        <span className="text-[13px] text-text-2">Proventos por ano (R$ por ação)</span>
        <div
          className="flex h-40 items-end gap-3"
          role="img"
          aria-label="Proventos por ano"
        >
          {anos.map((a) => (
            <div
              key={a.ano}
              className="flex h-40 flex-1 flex-col items-center justify-end gap-1.5"
            >
              <span className="font-mono text-[11px] text-text-2">
                {formatarNumero(a.valor)}
              </span>
              <div
                className="w-full max-w-11 rounded-t-[4px] bg-accent"
                style={{ height: `${Math.round((a.valor / maior) * 120)}px` }}
              />
              <span className="text-xs text-text-3">{a.ano}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="min-w-0 flex-[1_1_360px]">
        <DataTable
          caption="Proventos recentes"
          columns={COLUNAS_PROVENTOS}
          rows={proventos.slice(0, 8)}
          rowKey={(p) => `${p.ex_date}-${p.kind}`}
          minWidth={360}
          stickyFirstColumn={false}
        />
      </div>
    </div>
  );
}

const bi = (v: string | null) => (v === null ? "—" : formatarNumero(Number(v) / 1e9, 1));

interface Linha {
  rotulo: string;
  valor: (p: FundamentalsPeriod) => string;
}

const LINHAS: Linha[] = [
  { rotulo: "Receita líquida", valor: (p) => bi(p.revenue) },
  { rotulo: "Lucro bruto", valor: (p) => bi(p.gross_profit) },
  { rotulo: "EBIT", valor: (p) => bi(p.ebit) },
  {
    rotulo: "EBITDA",
    valor: (p) =>
      p.ebit === null
        ? "—"
        : bi(String(Number(p.ebit) + Number(p.depreciation_amortization ?? 0))),
  },
  { rotulo: "Lucro líquido", valor: (p) => bi(p.net_income) },
  {
    rotulo: "Margem líquida",
    valor: (p) =>
      p.revenue && p.net_income && Number(p.revenue) !== 0
        ? formatarPercentual(Number(p.net_income) / Number(p.revenue))
        : "—",
  },
  { rotulo: "Ativo total", valor: (p) => bi(p.total_assets) },
  { rotulo: "Patrimônio líquido", valor: (p) => bi(p.equity) },
  { rotulo: "Dívida bruta", valor: (p) => bi(p.gross_debt) },
  {
    rotulo: "Dívida líquida",
    valor: (p) =>
      p.gross_debt === null
        ? "—"
        : bi(String(Number(p.gross_debt) - Number(p.cash_and_equivalents ?? 0))),
  },
];

function rotuloDoPeriodo(p: FundamentalsPeriod): string {
  const [a, m] = p.reference_date.split("-");
  return p.statement_kind === "DFP"
    ? (a ?? "")
    : `${Math.ceil(Number(m) / 3)}T${a?.slice(2)}`;
}

function Demonstrativos({
  ticker,
  inicial,
}: {
  ticker: string;
  inicial: Envelope<Fundamentos> | null;
}) {
  const [periodo, setPeriodo] = useState<"annual" | "quarterly">("annual");
  const { data, isPending, isError } = useQuery({
    queryKey: ["fundamentos", ticker, periodo],
    queryFn: () =>
      api<Envelope<Fundamentos>>(`v1/fundamentals/${ticker}?period=${periodo}`),
    ...(periodo === "annual" && inicial ? { initialData: inicial } : {}),
    staleTime: 3_600_000,
  });

  const periodos = (data?.data.periods ?? []).slice(0, 4);
  return (
    <div className="flex flex-col gap-3">
      <SegmentedControl
        label="Período dos demonstrativos"
        value={periodo}
        onChange={setPeriodo}
        options={[
          { value: "annual", label: "Anual" },
          { value: "quarterly", label: "Trimestral" },
        ]}
      />
      {isPending ? (
        <Skeleton className="h-64" />
      ) : isError || periodos.length === 0 ? (
        <EmptyState
          title="Sem demonstrativos"
          description="A companhia não tem demonstrativo da CVM ligado a este ticker (FIIs, ETFs e BDRs não publicam DFP)."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse font-mono text-[13px]">
            <caption className="sr-only">Demonstrativos em R$ bilhões</caption>
            <thead>
              <tr className="text-right text-text-3">
                <th scope="col" className="p-2 text-left font-sans font-medium">
                  R$ bi · {periodo === "annual" ? "DFP" : "ITR"} CVM
                </th>
                {periodos.map((p) => (
                  <th key={p.reference_date} scope="col" className="p-2 font-medium">
                    {rotuloDoPeriodo(p)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {LINHAS.map((l) => (
                <tr key={l.rotulo} className="border-t border-border text-right">
                  <th scope="row" className="px-2 py-2.5 text-left font-sans font-normal">
                    {l.rotulo}
                  </th>
                  {periodos.map((p) => (
                    <td key={p.reference_date} className="px-2 py-2.5 tabular-nums">
                      {l.valor(p)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && (
        <span className="text-xs text-text-3">Fonte: CVM ({data.meta.license}).</span>
      )}
    </div>
  );
}

const cnpj = (v: string) =>
  v.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");

function Sobre({ ativo }: { ativo: AssetDetail }) {
  const itens: [string, string | null][] = [
    ["Razão social", ativo.legal_name],
    ["CNPJ", ativo.cnpj ? cnpj(ativo.cnpj) : null],
    ["Código CVM", ativo.cvm_code],
    ["ISIN", ativo.isin],
    ["Setor (CVM)", ativo.sector],
    ["Situação", ativo.status],
  ];
  return (
    <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {itens.map(([k, v]) => (
        <div key={k} className="flex flex-col gap-0.5">
          <dt className="text-xs text-text-3">{k}</dt>
          <dd className="m-0">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Detalhes({
  ativo,
  proventos,
  fundamentos,
}: {
  ativo: AssetDetail;
  proventos: Dividend[] | null;
  fundamentos: Envelope<Fundamentos> | null;
}) {
  return (
    <section
      aria-label="Detalhes"
      className="rounded-card border border-border bg-surface px-4 pb-4"
    >
      <Tabs
        label="Detalhes do ativo"
        items={[
          {
            value: "proventos",
            label: "Proventos",
            content: <Proventos proventos={proventos} />,
          },
          {
            value: "demonstrativos",
            label: "Demonstrativos",
            content: <Demonstrativos ticker={ativo.ticker} inicial={fundamentos} />,
          },
          { value: "sobre", label: "Sobre", content: <Sobre ativo={ativo} /> },
        ]}
      />
    </section>
  );
}
