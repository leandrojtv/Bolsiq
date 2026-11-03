"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  IndicadorFiltravel,
  INDICADORES,
  NOME_DO_PRESET,
  presets,
  type NomeDePreset,
  type ResultadoDoScreener,
} from "@bolsiq/analytics/puro";
import {
  Button,
  Card,
  cn,
  CompactNumber,
  DataTable,
  EmptyState,
  ErrorState,
  formatarCompacto,
  formatarNumero,
  formatarPercentual,
  Money,
  RangeInput,
  Select,
  Switch,
  type Column,
} from "@bolsiq/ui";
import {
  estadoDoPreset,
  filtroDoEstado,
  POR_PAGINA,
  TIPOS,
  urlDoEstado,
  type EstadoDoScreener,
  type Tipo,
} from "@/lib/screener-url";

type Linha = ResultadoDoScreener["linhas"][number];
type Resposta = ResultadoDoScreener & { ms: number };

const ROTULO_DO_TIPO: Record<Tipo, string> = {
  stock: "Ações",
  fii: "FIIs",
  bdr: "BDRs",
  etf: "ETFs",
  fund: "Fundos",
};
const NOMES_DE_PRESET = Object.keys(presets) as NomeDePreset[];

function formatar(indicador: IndicadorFiltravel, v: number | null) {
  if (v === null) return "—";
  const f = INDICADORES[indicador].formato;
  if (f === "percentual") return formatarPercentual(v, { casas: 1 });
  if (f === "moeda") return `R$ ${formatarCompacto(v)}`;
  if (f === "quantidade") return formatarCompacto(v);
  return formatarNumero(v);
}

async function consultar(e: EstadoDoScreener, porPagina = POR_PAGINA): Promise<Resposta> {
  const res = await fetch("/api/screener", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(filtroDoEstado(e, porPagina)),
  });
  if (!res.ok) throw new Error(`screener respondeu ${res.status}`);
  return (await res.json()) as Resposta;
}

function csv(e: EstadoDoScreener, linhas: Linha[]): string {
  const campo = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const cabecalho = [
    "ticker",
    "nome",
    "tipo",
    "setor",
    "preco",
    "data_base",
    ...e.colunas,
  ];
  const corpo = linhas.map((l) =>
    [
      l.ticker,
      l.name,
      l.kind,
      l.sector ?? "",
      l.preco ?? "",
      l.reference_date,
      ...e.colunas.map((c) => (l.indicadores[c] ?? "").toString()),
    ]
      .map((v) => campo(String(v)))
      .join(";"),
  );
  return [cabecalho.join(";"), ...corpo].join("\n");
}

export function Screener({
  estado,
  inicial,
}: {
  estado: EstadoDoScreener;
  inicial: Resposta | null;
}) {
  const router = useRouter();
  const caminho = usePathname();
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [exportando, setExportando] = useState(false);

  const ir = (novo: EstadoDoScreener) => {
    router.replace(`${caminho}?${urlDoEstado(novo)}`, { scroll: false });
  };
  // Mudou filtro, volta para a primeira pagina e sai do preset (o filtro ja
  // nao e o do autor).
  const filtrar = (parcial: Partial<EstadoDoScreener>) =>
    ir({ ...estado, preset: null, pagina: 1, ...parcial });

  const chave = urlDoEstado(estado);
  const { data, isError, isFetching, refetch } = useQuery({
    queryKey: ["screener", chave],
    queryFn: () => consultar(estado),
    ...(inicial ? { initialData: inicial } : {}),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

  const disponiveis = IndicadorFiltravel.options.filter((i) => !(i in estado.faixas));
  const total = data?.total ?? 0;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  const colunas: Column<Linha>[] = [
    {
      key: "selecionar",
      header: <span className="sr-only">Selecionar</span>,
      cell: (l) => (
        <input
          type="checkbox"
          aria-label={`Selecionar ${l.ticker}`}
          checked={selecionados.includes(l.ticker)}
          disabled={!selecionados.includes(l.ticker) && selecionados.length >= 6}
          onChange={(e) =>
            setSelecionados((s) =>
              e.target.checked ? [...s, l.ticker] : s.filter((t) => t !== l.ticker),
            )
          }
          className="size-4 accent-accent"
        />
      ),
    },
    {
      key: "ativo",
      header: "Ativo",
      cell: (l) => (
        <Link
          href={`/ativo/${l.ticker}`}
          className="flex flex-col gap-0.5 text-text hover:text-link"
        >
          <span className="font-mono font-semibold">{l.ticker}</span>
          <span className="max-w-48 truncate text-xs text-text-3">{l.name}</span>
        </Link>
      ),
    },
    {
      key: "setor",
      header: "Setor",
      cell: (l) => <span className="text-text-2">{l.sector ?? "—"}</span>,
    },
    {
      key: "preco",
      header: "Preço",
      numeric: true,
      cell: (l) => (l.preco ? <Money value={l.preco} /> : "—"),
    },
    ...estado.colunas.map((c): Column<Linha> => ({
      key: c,
      header: INDICADORES[c].rotulo,
      numeric: true,
      sortValue: (l) => l.indicadores[c] ?? null,
      cell: (l) => (
        <span className={cn(c === estado.ordenarPor && "font-semibold text-up-strong")}>
          {formatar(c, l.indicadores[c] ?? null)}
        </span>
      ),
    })),
  ];

  const exportar = async () => {
    setExportando(true);
    try {
      const tudo = await consultar({ ...estado, pagina: 1 }, 1000);
      const blob = new Blob([`\uFEFF${csv(estado, tudo.linhas)}`], {
        type: "text/csv;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `screener-${estado.preset ?? "personalizado"}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExportando(false);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <h1 className="m-0 text-[26px] font-bold tracking-tight">Screener</h1>
        <p className="m-0 text-text-3">
          Filtre o universo da B3 por qualquer indicador. Presets são os critérios
          publicados por cada autor, não recomendação.
        </p>
      </div>

      <section
        aria-label="Presets"
        className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3"
      >
        {NOMES_DE_PRESET.map((p) => {
          const ativo = estado.preset === p;
          return (
            <button
              key={p}
              type="button"
              aria-pressed={ativo}
              onClick={() => ir(estadoDoPreset(p))}
              className={cn(
                "flex min-h-24 flex-col gap-1.5 rounded-[12px] border px-4 py-3.5 text-left text-text",
                ativo
                  ? "border-accent bg-accent-tint"
                  : "border-border bg-surface hover:border-border-strong",
              )}
            >
              <span className="text-[15px] font-bold">{NOME_DO_PRESET[p]}</span>
              <span className="text-[13px] leading-snug text-text-2">
                {presets[p].descricao}
              </span>
            </button>
          );
        })}
      </section>

      <div className="flex flex-wrap items-start gap-5">
        <Card
          aria-label="Filtros"
          className="min-w-0 flex-[1_1_280px] gap-4"
          title={<span className="text-base text-text">Filtros</span>}
          action={
            <Button
              variant="ghost"
              className="h-8 px-2.5"
              onClick={() =>
                filtrar({
                  faixas: {},
                  liquidezMinima: null,
                  incluirIndefinidos: false,
                  tipos: ["stock"],
                })
              }
            >
              Limpar
            </Button>
          }
        >
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="mb-2 text-xs font-semibold tracking-wider text-text-3">
              TIPO
            </legend>
            <div className="flex flex-wrap gap-2">
              {TIPOS.map((t) => (
                <label
                  key={t}
                  className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-item bg-sidebar px-2.5"
                >
                  <input
                    type="checkbox"
                    className="size-4 accent-accent"
                    checked={estado.tipos.includes(t)}
                    onChange={(e) => {
                      const tipos = e.target.checked
                        ? [...estado.tipos, t]
                        : estado.tipos.filter((x) => x !== t);
                      if (tipos.length > 0) filtrar({ tipos });
                    }}
                  />
                  {ROTULO_DO_TIPO[t]}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-col gap-2.5">
            <span className="text-xs font-semibold tracking-wider text-text-3">
              FAIXAS
            </span>
            {Object.entries(estado.faixas).map(([nome, faixa]) => {
              const indicador = nome as IndicadorFiltravel;
              return (
                <RangeInput
                  key={nome}
                  label={INDICADORES[indicador].rotulo}
                  min={faixa?.min?.toString() ?? ""}
                  max={faixa?.max?.toString() ?? ""}
                  removeLabel={`Remover filtro ${INDICADORES[indicador].rotulo}`}
                  onRemove={() => {
                    const faixas = { ...estado.faixas };
                    delete faixas[indicador];
                    filtrar({ faixas });
                  }}
                  onChange={({ min, max }) => {
                    const n = (v: string) =>
                      v.trim() === "" || Number.isNaN(Number(v.replace(",", ".")))
                        ? undefined
                        : Number(v.replace(",", "."));
                    filtrar({
                      faixas: {
                        ...estado.faixas,
                        [indicador]: { min: n(min), max: n(max) },
                      },
                    });
                  }}
                />
              );
            })}
            {disponiveis.length > 0 && (
              <Select
                label="Adicionar indicador"
                value=""
                placeholder={`+ Indicador (${disponiveis.length} disponíveis)`}
                options={disponiveis.map((i) => ({
                  value: i,
                  label: INDICADORES[i].rotulo,
                }))}
                onValueChange={(v) =>
                  filtrar({
                    faixas: { ...estado.faixas, [v]: { min: undefined, max: undefined } },
                  })
                }
                className="w-full border-dashed border-border-active text-link"
              />
            )}
          </div>

          <label className="flex flex-col gap-1.5 text-xs font-semibold tracking-wider text-text-3">
            LIQUIDEZ DIÁRIA MÍNIMA (R$)
            <input
              type="text"
              inputMode="numeric"
              defaultValue={estado.liquidezMinima?.toString() ?? ""}
              placeholder="ex.: 1000000"
              onBlur={(e) => {
                const v = Number(e.target.value.replace(/\D/g, ""));
                filtrar({ liquidezMinima: e.target.value.trim() === "" ? null : v });
              }}
              className="h-touch rounded-item border border-border-strong bg-sidebar px-2.5 font-mono text-sm tracking-normal text-text"
            />
          </label>
          <Switch
            checked={estado.incluirIndefinidos}
            onCheckedChange={(v) => filtrar({ incluirIndefinidos: v })}
            label="Incluir ativos com indicador indefinido (ex.: empresa sem lucro não tem P/L)"
          />
        </Card>

        <Card
          aria-label="Resultados"
          aria-busy={isFetching}
          className="min-w-0 flex-[999_1_620px]"
        >
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-baseline gap-2.5">
              <h2 className="m-0 text-base font-semibold">
                {total.toLocaleString("pt-BR")} ativos
              </h2>
              <span className="text-xs text-text-3">
                ordenado por {INDICADORES[estado.ordenarPor].rotulo} (
                {estado.ordem === "asc" ? "crescente" : "decrescente"})
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Select
                label="Colunas"
                value=""
                placeholder="Colunas"
                options={IndicadorFiltravel.options.map((i) => ({
                  value: i,
                  label: `${estado.colunas.includes(i) ? "✓ " : ""}${INDICADORES[i].rotulo}`,
                }))}
                onValueChange={(v) => {
                  const c = v as IndicadorFiltravel;
                  const colunas = estado.colunas.includes(c)
                    ? estado.colunas.filter((x) => x !== c)
                    : [...estado.colunas, c];
                  if (colunas.length > 0) ir({ ...estado, colunas });
                }}
                className="h-9 min-w-28"
              />
              <Button
                className="h-9"
                disabled={selecionados.length < 2}
                onClick={() => router.push(`/comparar?t=${selecionados.join(",")}`)}
              >
                Comparar selecionados
                {selecionados.length > 0 ? ` (${selecionados.length})` : ""}
              </Button>
              <Button
                variant="primary"
                className="h-9"
                disabled={total === 0 || exportando}
                onClick={() => void exportar()}
              >
                {exportando ? "Exportando…" : "Exportar CSV"}
              </Button>
            </div>
          </div>

          {isError ? (
            <ErrorState
              description="O screener não respondeu."
              onRetry={() => void refetch()}
            />
          ) : (
            <DataTable
              caption="Resultado do screener"
              columns={colunas}
              rows={data?.linhas ?? []}
              rowKey={(l) => l.ticker}
              minWidth={760}
              stickyFirstColumn={false}
              sort={{ key: estado.ordenarPor, direction: estado.ordem }}
              onSortChange={(s) =>
                ir({
                  ...estado,
                  ordenarPor: s.key as IndicadorFiltravel,
                  ordem: s.direction,
                  pagina: 1,
                })
              }
              empty={
                <EmptyState
                  title="Nenhum ativo passa nesses filtros"
                  description="Afrouxe uma faixa, inclua outros tipos ou marque 'incluir indefinidos'."
                />
              }
            />
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-3">
            <span>
              {total === 0
                ? "Sem resultados"
                : `Mostrando ${(estado.pagina - 1) * POR_PAGINA + 1}-${Math.min(estado.pagina * POR_PAGINA, total)} de ${total}`}
              {data ? ` · consulta em ${data.ms} ms` : ""}
            </span>
            <nav aria-label="Paginação" className="flex gap-1.5">
              <Button
                className="h-9"
                disabled={estado.pagina <= 1}
                onClick={() => ir({ ...estado, pagina: estado.pagina - 1 })}
              >
                Anterior
              </Button>
              <Button
                className="h-9"
                disabled={estado.pagina >= paginas}
                onClick={() => ir({ ...estado, pagina: estado.pagina + 1 })}
              >
                Próxima
              </Button>
            </nav>
          </div>
        </Card>
      </div>
      <p className="m-0 text-xs text-text-3">
        Volume financeiro em <CompactNumber value={1e6} prefix="R$ " /> = um milhão.
        Indicadores do último demonstrativo e do último pregão carregado.
      </p>
    </>
  );
}
