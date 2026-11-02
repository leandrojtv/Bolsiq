import { Card, formatarNumero, formatarPercentual, Money, StatTile } from "@bolsiq/ui";
import type { Indicadores } from "@/lib/analytics";
import { cn } from "@bolsiq/ui";

const razao = (v: number | null) => (v === null ? "—" : formatarNumero(v));
const pct = (v: number | null) => (v === null ? "—" : formatarPercentual(v));

export function itensDeIndicadores(i: Indicadores | null) {
  return [
    { k: "P/L", curto: "P/L", v: razao(i?.pl ?? null) },
    { k: "P/VP", curto: "P/VP", v: razao(i?.pvp ?? null) },
    { k: "DY 12m", curto: "DY 12m", v: pct(i?.dy_12m ?? null) },
    { k: "EV/EBITDA", curto: "EV/EBITDA", v: razao(i?.ev_ebitda ?? null) },
    { k: "ROE", curto: "ROE", v: pct(i?.roe ?? null) },
    { k: "Margem líq.", curto: "Mg. líq.", v: pct(i?.margem_liquida ?? null) },
    { k: "DL/EBITDA", curto: "DL/EBITDA", v: razao(i?.dl_ebitda ?? null) },
    { k: "Beta", curto: "Beta", v: razao(i?.beta ?? null) },
  ];
}

export function GradeDeIndicadores({ indicadores }: { indicadores: Indicadores | null }) {
  return (
    <Card title="Indicadores">
      {indicadores ? (
        <div className="grid grid-cols-2 gap-2.5">
          {itensDeIndicadores(indicadores).map((i) => (
            <StatTile key={i.k} label={i.k} value={i.v} />
          ))}
        </div>
      ) : (
        <p className="m-0 text-sm text-text-3">
          Indicadores ainda não calculados para este ativo.
        </p>
      )}
      {indicadores && (
        <span className="text-xs text-text-3">
          Data-base {indicadores.reference_date.split("-").reverse().join("/")}
        </span>
      )}
    </Card>
  );
}

function Barra({
  preco,
  justo,
  margem,
}: {
  preco: string;
  justo: string;
  margem: number | null;
}) {
  const proporcao = Math.max(0, Math.min(1, Number(preco) / Number(justo)));
  const positivo = (margem ?? 0) >= 0;
  return (
    <div className="h-2 overflow-hidden rounded-full bg-sidebar" aria-hidden="true">
      <div
        className={cn("h-2", positivo ? "bg-up" : "bg-down")}
        style={{ width: `${Math.round(proporcao * 100)}%` }}
      />
    </div>
  );
}

function Metodo({
  nome,
  justo,
  margem,
  preco,
}: {
  nome: string;
  justo: string | null;
  margem: number | null;
  preco: string | null;
}) {
  if (justo === null) {
    return (
      <div className="flex justify-between text-sm">
        <span>{nome}</span>
        <span className="text-text-3">indefinido</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between">
        <span>{nome}</span>
        <Money value={justo} className="font-semibold" />
      </div>
      {preco && <Barra preco={preco} justo={justo} margem={margem} />}
      {margem !== null && (
        <span className={cn("text-xs", margem >= 0 ? "text-up" : "text-down")}>
          Margem de segurança {formatarPercentual(margem, { sinal: true, casas: 1 })}
        </span>
      )}
    </div>
  );
}

export function PrecoJusto({
  indicadores,
  preco,
}: {
  indicadores: Indicadores | null;
  preco: string | null;
}) {
  return (
    <Card title="Preço justo" className="gap-3.5">
      <Metodo
        nome="Graham"
        justo={indicadores?.preco_graham ?? null}
        margem={indicadores?.margem_graham ?? null}
        preco={preco}
      />
      <Metodo
        nome="Bazin (6%)"
        justo={indicadores?.preco_bazin ?? null}
        margem={indicadores?.margem_bazin ?? null}
        preco={preco}
      />
      <p className="m-0 text-xs leading-normal text-text-3">
        Critérios publicados pelos autores dos métodos. Não é recomendação.
      </p>
    </Card>
  );
}

/** Versao do celular: grade de 3 colunas e cartao compacto de preco justo. */
export function LateralMobile({
  indicadores,
  preco,
}: {
  indicadores: Indicadores | null;
  preco: string | null;
}) {
  const itens = itensDeIndicadores(indicadores).filter(
    (i) => !["EV/EBITDA", "Beta"].includes(i.k),
  );
  return (
    <div className="flex flex-col gap-3.5 md:hidden">
      <div className="grid grid-cols-3 gap-2">
        {itens.map((i) => (
          <div
            key={i.k}
            className="flex flex-col gap-0.5 rounded-control border border-border bg-surface px-2.5 py-2"
          >
            <span className="text-[11px] text-text-3">{i.curto}</span>
            <span className="font-mono font-semibold tabular-nums">{i.v}</span>
          </div>
        ))}
      </div>
      {indicadores?.preco_graham && (
        <div className="flex flex-col gap-2 rounded-[12px] border border-border bg-surface p-3">
          <div className="flex justify-between">
            <span>Preço justo Graham</span>
            <Money value={indicadores.preco_graham} className="font-semibold" />
          </div>
          {preco && (
            <Barra
              preco={preco}
              justo={indicadores.preco_graham}
              margem={indicadores.margem_graham}
            />
          )}
          <div className="flex justify-between text-xs">
            <span className="text-text-3">
              Teto Bazin (6%){" "}
              {indicadores.preco_bazin ? <Money value={indicadores.preco_bazin} /> : "—"}
            </span>
            {indicadores.margem_graham !== null && (
              <span className={indicadores.margem_graham >= 0 ? "text-up" : "text-down"}>
                margem{" "}
                {formatarPercentual(indicadores.margem_graham, { sinal: true, casas: 1 })}
              </span>
            )}
          </div>
          <span className="text-[11px] text-text-3">Não é recomendação.</span>
        </div>
      )}
    </div>
  );
}
