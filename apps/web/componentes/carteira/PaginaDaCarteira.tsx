"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Upload } from "lucide-react";
import {
  Button,
  Card,
  EmptyState,
  SegmentedControl,
  Sheet,
  cn,
  formatarDinheiro,
  formatarNumero,
  formatarPercentual,
} from "@bolsiq/ui";
import type { PainelDaCarteira } from "@/lib/carteira";
import type { Agrupamento } from "@/lib/carteira-modelo";
import { CAMPO } from "../conta/campos";
import { GraficoDeLinhas } from "../comparar/GraficoDeLinhas";
import { chaveDoPainel, criarCarteira, lerPainel } from "./cliente";
import { Importar } from "./Importar";
import { FormularioDeTransacao } from "./NovaTransacao";

const NOVA = "__nova__";
const CORES = ["series-1", "series-4", "series-3", "series-2", "series-5", "series-6"];
const MESES = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

const corDoSinal = (v: number | null) =>
  v === null || v === 0 ? "text-text" : v > 0 ? "text-up" : "text-down";
const seta = (v: number | null) => (v === null || v === 0 ? "" : v > 0 ? "▲ " : "▼ ");

/** /carteiras/[id] (Carteira.dc.html). */
export function PaginaDaCarteira({ inicial }: { inicial: PainelDaCarteira }) {
  const id = inicial.carteira.id;
  const cliente = useQueryClient();
  const router = useRouter();
  const { data: p } = useQuery({
    queryKey: chaveDoPainel(id),
    queryFn: () => lerPainel(id),
    initialData: inicial,
    // Enquanto o worker recalcula os snapshots, o grafico atualiza sozinho.
    refetchInterval: (q) => (q.state.data?.recalculando ? 3000 : false),
  });
  const [aberto, setAberto] = useState<"transacao" | "importar" | "carteira" | null>(
    null,
  );
  const atualizar = () => void cliente.invalidateQueries({ queryKey: chaveDoPainel(id) });

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="m-0 text-[26px] font-bold tracking-tight">Carteiras</h1>
          <label htmlFor="carteira" className="sr-only">
            Carteira
          </label>
          <select
            id="carteira"
            value={id}
            onChange={(e) =>
              e.target.value === NOVA
                ? setAberto("carteira")
                : router.push(`/carteiras/${e.target.value}`)
            }
            className="h-10 rounded-control border border-border-strong bg-surface px-3 font-semibold text-text"
          >
            {p.carteiras.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
            <option value={NOVA}>Nova carteira…</option>
          </select>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <Button onClick={() => setAberto("importar")}>
            <Upload aria-hidden="true" size={16} />
            Importar CSV ou extrato B3
          </Button>
          <Button variant="primary" onClick={() => setAberto("transacao")}>
            + Transação
          </Button>
        </div>
      </header>

      <Resumo p={p} />

      {p.transacoes === 0 ? (
        <Card>
          <EmptyState
            title="Carteira vazia"
            description="Lance a primeira transação ou importe um CSV ou o extrato da B3."
          />
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-start gap-5">
            <Rentabilidade p={p} />
            <Alocacao p={p} />
          </div>
          <div className="flex flex-wrap items-start gap-5">
            <Posicoes p={p} />
            <Proventos p={p} />
          </div>
        </>
      )}

      <Sheet
        open={aberto === "transacao"}
        onOpenChange={(v) => setAberto(v ? "transacao" : null)}
        title="Nova transação"
        description={`Carteira ${p.carteira.nome}`}
      >
        <FormularioDeTransacao
          carteira={id}
          onSalva={() => {
            setAberto(null);
            atualizar();
          }}
        />
      </Sheet>
      <Sheet
        open={aberto === "importar"}
        onOpenChange={(v) => setAberto(v ? "importar" : null)}
        title="Importar transações"
        description="Linhas com erro não interrompem a importação: aparecem no relatório."
      >
        <Importar carteira={id} onImportado={atualizar} />
      </Sheet>
      <Sheet
        open={aberto === "carteira"}
        onOpenChange={(v) => setAberto(v ? "carteira" : null)}
        title="Nova carteira"
      >
        <NovaCarteira onCriada={(nova) => router.push(`/carteiras/${nova}`)} />
      </Sheet>
    </div>
  );
}

function NovaCarteira({ onCriada }: { onCriada: (id: string) => void }) {
  const [nome, setNome] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  async function criar(e: FormEvent) {
    e.preventDefault();
    try {
      onCriada((await criarCarteira(nome)).id);
    } catch (falha) {
      setErro((falha as Error).message);
    }
  }
  return (
    <form onSubmit={(e) => void criar(e)} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5 text-xs text-text-3">
        Nome
        <input
          className={CAMPO}
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          maxLength={40}
        />
      </label>
      {erro && (
        <p role="alert" className="m-0 text-sm text-down">
          {erro}
        </p>
      )}
      <Button type="submit" variant="primary">
        Criar
      </Button>
    </form>
  );
}

function Indicador({
  rotulo,
  valor,
  sub,
  cor,
  alerta = false,
}: {
  rotulo: string;
  valor: string;
  sub: string;
  cor?: string;
  /** Subtitulo em destaque: o numero acima esta incompleto. */
  alerta?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-card border border-border bg-surface px-4 py-3.5">
      <span className="text-xs text-text-3">{rotulo}</span>
      <span
        className={cn(
          "font-mono text-[22px] font-semibold tabular-nums",
          cor ?? "text-text",
        )}
      >
        {valor}
      </span>
      <span className={cn("text-xs", alerta ? "text-warn" : "text-text-3")}>{sub}</span>
    </div>
  );
}

function Resumo({ p }: { p: PainelDaCarteira }) {
  const r = p.resumo;
  const nr = r.nao_realizado === null ? null : Number(r.nao_realizado);
  return (
    <section
      aria-label="Resumo"
      className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3"
    >
      <Indicador
        rotulo="Patrimônio"
        valor={r.patrimonio === null ? "-" : formatarDinheiro(r.patrimonio)}
        sub={
          r.sem_cotacao.length === 0
            ? "a preço de mercado"
            : `sem cotação, fora da soma: ${r.sem_cotacao.join(", ")}`
        }
        alerta={r.sem_cotacao.length > 0}
      />
      <Indicador
        rotulo="Rentabilidade 12m (TWR)"
        valor={
          r.twr_12m === null
            ? "-"
            : seta(r.twr_12m) + formatarPercentual(Math.abs(r.twr_12m))
        }
        sub={
          r.cdi_12m === null
            ? "CDI no período: -"
            : `CDI no período: ${formatarPercentual(r.cdi_12m)}`
        }
        cor={corDoSinal(r.twr_12m)}
      />
      <Indicador
        rotulo="Não realizado"
        valor={nr === null ? "-" : formatarDinheiro(nr)}
        sub={
          r.nao_realizado_pct === null
            ? "sobre o custo"
            : `${formatarPercentual(r.nao_realizado_pct, { sinal: true })} sobre o custo`
        }
        cor={corDoSinal(nr)}
      />
      <Indicador
        rotulo="Realizado"
        valor={formatarDinheiro(r.realizado)}
        sub="vendas desde o início"
      />
      <Indicador
        rotulo="Proventos 12m"
        valor={formatarDinheiro(r.proventos_12m)}
        sub="dividendos e JCP"
      />
    </section>
  );
}

function Legenda({
  cor,
  padrao,
  children,
}: {
  cor: string;
  padrao?: string;
  children: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width="14" height="4" aria-hidden="true">
        <line
          x1="0"
          y1="2"
          x2="14"
          y2="2"
          stroke={`var(--${cor})`}
          strokeWidth={padrao ? 2 : 3}
          strokeDasharray={padrao}
        />
      </svg>
      {children}
    </span>
  );
}

function Rentabilidade({ p }: { p: PainelDaCarteira }) {
  const pontos = (f: (s: PainelDaCarteira["serie"][number]) => number | null) =>
    p.serie.flatMap((s) => {
      const v = f(s);
      return v === null ? [] : [{ date: s.data, valor: v }];
    });
  return (
    <section
      aria-label="Rentabilidade"
      className="flex min-w-0 flex-[999_1_560px] flex-col gap-3 rounded-card border border-border bg-surface p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <h2 className="m-0 text-base font-semibold">
          Rentabilidade <span className="font-normal text-text-3">TWR diário</span>
        </h2>
        <div className="flex flex-wrap gap-3.5 text-xs text-text-2">
          <Legenda cor="series-1">Carteira</Legenda>
          <Legenda cor="benchmark" padrao="4 3">
            CDI
          </Legenda>
          <Legenda cor="series-2" padrao="1 3">
            IPCA+6%
          </Legenda>
          <Legenda cor="series-3" padrao="8 3">
            IBOV
          </Legenda>
        </div>
      </div>
      {p.serie.length < 2 ? (
        <p
          role="status"
          className="m-0 flex h-[260px] items-center justify-center text-sm text-text-3"
        >
          {p.recalculando
            ? "Calculando a rentabilidade…"
            : "Rentabilidade aparece a partir do segundo pregão."}
        </p>
      ) : (
        <GraficoDeLinhas
          rotulo="Rentabilidade da carteira comparada a CDI, IPCA mais 6 por cento e Ibovespa"
          altura={260}
          formato="base100"
          referencia={100}
          linhas={[
            {
              nome: "IBOV",
              cor: "series-3",
              tracejado: [8, 3],
              pontos: pontos((s) => s.ibov),
            },
            {
              nome: "IPCA+6%",
              cor: "series-2",
              tracejado: [1, 3],
              pontos: pontos((s) => s.ipca6),
            },
            {
              nome: "CDI",
              cor: "benchmark",
              tracejado: [4, 3],
              pontos: pontos((s) => s.cdi),
            },
            { nome: "Carteira", cor: "series-1", pontos: pontos((s) => s.carteira) },
          ]}
        />
      )}
    </section>
  );
}

function Alocacao({ p }: { p: PainelDaCarteira }) {
  const [grupo, setGrupo] = useState<Agrupamento>("classe");
  const fatias = p.alocacao[grupo];
  // Ate 4 fatias e "Outros", como no design.
  const visiveis = fatias.length > 5 ? fatias.slice(0, 4) : fatias;
  const resto =
    fatias.length > 5 ? fatias.slice(4).reduce((s, f) => s + (f.fracao ?? 0), 0) : 0;
  const itens = [
    ...visiveis.map((f, i) => ({
      rotulo: f.chave,
      fracao: f.fracao ?? 0,
      cor: CORES[i] ?? "benchmark",
    })),
    ...(resto > 0 ? [{ rotulo: "Outros", fracao: resto, cor: "benchmark" }] : []),
  ];
  return (
    <section
      aria-label="Alocação"
      className="flex min-w-0 flex-[1_1_320px] flex-col gap-3.5 rounded-card border border-border bg-surface p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-base font-semibold">Alocação</h2>
        <SegmentedControl<Agrupamento>
          label="Agrupar por"
          value={grupo}
          onChange={setGrupo}
          options={[
            { value: "classe", label: "Classe" },
            { value: "setor", label: "Setor" },
            { value: "ativo", label: "Ativo" },
          ]}
        />
      </div>
      {itens.length === 0 ? (
        <p className="m-0 text-sm text-text-3">Sem cotação para as posições.</p>
      ) : (
        <>
          <div
            className="flex h-3.5 gap-0.5 overflow-hidden rounded-full"
            aria-hidden="true"
          >
            {itens.map((a) => (
              <div
                key={a.rotulo}
                style={{ width: `${a.fracao * 100}%`, background: `var(--${a.cor})` }}
              />
            ))}
          </div>
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {itens.map((a) => (
              <li key={a.rotulo} className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="size-2.5 rounded-[3px]"
                    style={{ background: `var(--${a.cor})` }}
                  />
                  {a.rotulo}
                </span>
                <span className="font-mono text-text-2">
                  {formatarPercentual(a.fracao, { casas: 0 })}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Posicoes({ p }: { p: PainelDaCarteira }) {
  const num = "px-2 py-2.5 text-right font-mono tabular-nums whitespace-nowrap";
  return (
    <section
      aria-label="Posições"
      className="flex min-w-0 flex-[999_1_620px] flex-col gap-3 rounded-card border border-border bg-surface p-4"
    >
      <h2 className="m-0 text-base font-semibold">Posições</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-[13px]">
          <thead>
            <tr className="text-text-3">
              <th scope="col" className="p-2 text-left font-medium">
                Ativo
              </th>
              {[
                "Qtd.",
                "Preço médio",
                "Custo",
                "Atual",
                "Não realizado",
                "Realizado",
                "Proventos",
              ].map((c) => (
                <th key={c} scope="col" className="p-2 text-right font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {p.posicoes.map((x) => (
              <tr key={x.ticker} className="border-t border-border">
                <th scope="row" className="px-2 py-2.5 text-left font-normal">
                  <Link
                    href={`/ativo/${x.ticker}`}
                    className="flex flex-col gap-0.5 text-text"
                  >
                    <span className="font-mono font-semibold">{x.ticker}</span>
                    {x.evento && (
                      <span className="text-[11px] text-link">{x.evento}</span>
                    )}
                  </Link>
                </th>
                <td className={num}>
                  {formatarNumero(x.quantidade, Number(x.quantidade) % 1 ? 4 : 0)}
                </td>
                <td className={num}>{formatarDinheiro(x.preco_medio)}</td>
                <td className={num}>
                  {x.preco_atual === null
                    ? "sem cotação"
                    : formatarDinheiro(x.preco_atual)}
                </td>
                <td className={num}>{formatarDinheiro(x.custo_total)}</td>
                <td className={num}>
                  {x.valor_de_mercado === null
                    ? "-"
                    : formatarDinheiro(x.valor_de_mercado)}
                </td>
                <td className={cn(num, corDoSinal(x.rentabilidade))}>
                  {x.rentabilidade === null
                    ? "-"
                    : seta(x.rentabilidade) +
                      formatarPercentual(Math.abs(x.rentabilidade))}
                </td>
                <td className={num}>{formatarDinheiro(x.resultado_realizado)}</td>
                <td className={num}>{formatarDinheiro(x.proventos_recebidos)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Proventos({ p }: { p: PainelDaCarteira }) {
  const maximo = Math.max(...p.proventos_mes.map((m) => m.valor), 0);
  return (
    <section
      aria-label="Proventos recebidos"
      className="flex min-w-0 flex-[1_1_320px] flex-col gap-3 rounded-card border border-border bg-surface p-4"
    >
      <div className="flex items-baseline justify-between">
        <h2 className="m-0 text-base font-semibold">Proventos por mês</h2>
        <span className="text-xs text-text-3">12 meses</span>
      </div>
      <ol className="m-0 flex h-[150px] list-none items-end gap-1.5 p-0">
        {p.proventos_mes.map((m) => (
          <li
            key={m.mes}
            className="flex h-full flex-1 flex-col items-center justify-end gap-1.5"
            title={`${m.mes}: ${formatarDinheiro(m.valor)}`}
          >
            <span className="sr-only">
              {m.mes}: {formatarDinheiro(m.valor)}
            </span>
            <div
              aria-hidden="true"
              className="w-full rounded-t-[3px] bg-series-4"
              style={{
                height:
                  maximo > 0
                    ? `${Math.max((m.valor / maximo) * 120, m.valor > 0 ? 3 : 0)}px`
                    : 0,
              }}
            />
            <span aria-hidden="true" className="text-[10px] text-text-3">
              {MESES[Number(m.mes.slice(5)) - 1]}
            </span>
          </li>
        ))}
      </ol>
      <span className="text-xs text-text-3">
        Dividendos e JCP lançados automaticamente a partir dos eventos corporativos.
      </span>
    </section>
  );
}
