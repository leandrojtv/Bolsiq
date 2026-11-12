"use client";

import { useId, useState } from "react";
import {
  AJUDA_TECNICA,
  ajudaDoIndicador,
  avaliarIndicador,
  type IndicadorFiltravel,
  type SinaisTecnicos,
  type Sinal,
} from "@bolsiq/analytics/puro";
import {
  Card,
  cn,
  formatarNumero,
  formatarPercentual,
  Money,
  StatTile,
} from "@bolsiq/ui";
import type { Indicadores } from "@/lib/analytics";
import {
  BotaoDeAjuda,
  NOME_DO_NIVEL,
  PainelDeAjuda,
  PontoDoSinal,
  textoDoNivel,
} from "./Sinais";

const razao = (v: number | null) => (v === null ? "—" : formatarNumero(v));
const pct = (v: number | null) => (v === null ? "—" : formatarPercentual(v));

export function itensDeIndicadores(i: Indicadores | null) {
  const item = (
    nome: IndicadorFiltravel & keyof Indicadores,
    k: string,
    curto: string,
    formato: (v: number | null) => string,
  ) => {
    const v = i?.[nome] ?? null;
    return { nome, k, curto, v: formato(v), sinal: avaliarIndicador(nome, v) };
  };
  return [
    item("pl", "P/L", "P/L", razao),
    item("pvp", "P/VP", "P/VP", razao),
    item("dy_12m", "DY 12m", "DY 12m", pct),
    item("ev_ebitda", "EV/EBITDA", "EV/EBITDA", razao),
    item("roe", "ROE", "ROE", pct),
    item("margem_liquida", "Margem líq.", "Mg. líq.", pct),
    item("dl_ebitda", "DL/EBITDA", "DL/EBITDA", razao),
    item("beta", "Beta", "Beta", razao),
  ];
}

type Item = ReturnType<typeof itensDeIndicadores>[number];

/** Helper do indicador aberto, abaixo da grade: no celular um popover sairia da tela. */
function AjudaDoItem({ id, item }: { id: string; item: Item | undefined }) {
  const ajuda = item ? ajudaDoIndicador(item.nome) : null;
  if (!item || !ajuda) return null;
  return <PainelDeAjuda id={id} nome={item.k} ajuda={ajuda} sinal={item.sinal} />;
}

function Rotulo({
  item,
  aberto,
  aoAlternar,
  controla,
  curto = false,
}: {
  item: Item;
  aberto: boolean;
  aoAlternar: () => void;
  controla: string;
  curto?: boolean;
}) {
  return (
    <span className="flex items-center gap-1.5">
      {curto ? item.curto : item.k}
      {item.sinal && <PontoDoSinal nivel={item.sinal.nivel} />}
      <BotaoDeAjuda
        nome={item.k}
        aberto={aberto}
        aoAlternar={aoAlternar}
        controla={controla}
      />
    </span>
  );
}

function useAberto() {
  const [aberto, setAberto] = useState<string | null>(null);
  return {
    aberto,
    alternar: (k: string) => setAberto((a) => (a === k ? null : k)),
  };
}

export function GradeDeIndicadores({ indicadores }: { indicadores: Indicadores | null }) {
  const id = useId();
  const { aberto, alternar } = useAberto();
  const itens = itensDeIndicadores(indicadores);
  return (
    <Card title="Indicadores">
      {indicadores ? (
        <>
          <div className="grid grid-cols-2 gap-2.5">
            {itens.map((i) => (
              <StatTile
                key={i.k}
                label={
                  <Rotulo
                    item={i}
                    aberto={aberto === i.k}
                    aoAlternar={() => alternar(i.k)}
                    controla={id}
                  />
                }
                value={i.v}
                {...(i.sinal ? { title: i.sinal.leitura } : {})}
              />
            ))}
          </div>
          <AjudaDoItem id={id} item={itens.find((i) => i.k === aberto)} />
          <Legenda />
        </>
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

function Legenda() {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-text-3">
      {(["verde", "amarelo", "vermelho"] as const).map((n) => (
        <span key={n} className="flex items-center gap-1">
          <PontoDoSinal nivel={n} /> {NOME_DO_NIVEL[n]}
        </span>
      ))}
      <span>Faixas gerais de mercado; banco e elétrica têm faixas próprias.</span>
    </div>
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

/** O que o metodo diz do preco atual: abaixo do justo indica compra, acima e caro. */
function Veredito({ sinal }: { sinal: Sinal }) {
  const titulo = {
    verde: "Indica compra",
    amarelo: "Desconto pequeno",
    vermelho: "Acima do justo",
  };
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs font-medium",
        textoDoNivel(sinal.nivel),
      )}
    >
      <PontoDoSinal nivel={sinal.nivel} />
      {titulo[sinal.nivel]}
    </span>
  );
}

function Metodo({
  nome,
  indicador,
  justo,
  margem,
  preco,
}: {
  nome: string;
  indicador: "margem_graham" | "margem_bazin";
  justo: string | null;
  margem: number | null;
  preco: string | null;
}) {
  const id = useId();
  const [aberto, setAberto] = useState(false);
  const ajuda = ajudaDoIndicador(indicador);
  const sinal = avaliarIndicador(indicador, margem);
  const cabecalho = (
    <span className="flex items-center gap-1.5">
      {nome}
      {ajuda && (
        <BotaoDeAjuda
          nome={nome}
          aberto={aberto}
          aoAlternar={() => setAberto((a) => !a)}
          controla={id}
        />
      )}
    </span>
  );
  return (
    <div className="flex flex-col gap-1.5">
      {justo === null ? (
        <div className="flex justify-between text-sm">
          {cabecalho}
          <span className="text-text-3">indefinido</span>
        </div>
      ) : (
        <>
          <div className="flex justify-between">
            {cabecalho}
            <Money value={justo} className="font-semibold" />
          </div>
          {preco && <Barra preco={preco} justo={justo} margem={margem} />}
          <div className="flex items-center justify-between gap-2">
            {margem !== null && (
              <span className={cn("text-xs", margem >= 0 ? "text-up" : "text-down")}>
                Margem de segurança{" "}
                {formatarPercentual(margem, { sinal: true, casas: 1 })}
              </span>
            )}
            {sinal && <Veredito sinal={sinal} />}
          </div>
          <span className="text-xs text-text-3">
            Abaixo de <Money value={justo} /> o método indica compra; acima, o preço está
            caro por ele.
          </span>
        </>
      )}
      {aberto && ajuda && (
        <PainelDeAjuda id={id} nome={nome} ajuda={ajuda} sinal={sinal} />
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
        indicador="margem_graham"
        justo={indicadores?.preco_graham ?? null}
        margem={indicadores?.margem_graham ?? null}
        preco={preco}
      />
      <Metodo
        nome="Bazin (6%)"
        indicador="margem_bazin"
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

const NOMES_TECNICOS: Record<keyof SinaisTecnicos["sinais"], string> = {
  tendencia: "Tendência (MM 50 x MM 200)",
  curto_prazo: "Curto prazo (MM 20 x MM 50)",
  ifr: "IFR 14",
};

/** MM 20/50/200 e IFR 14 do ultimo pregao, com as formulas do grafico. */
export function SinaisTecnicosCard({ tecnicos }: { tecnicos: SinaisTecnicos | null }) {
  const id = useId();
  const { aberto, alternar } = useAberto();
  if (!tecnicos || tecnicos.preco === null) return null;
  const valores = [
    { k: "MM 20", v: tecnicos.mm20 },
    { k: "MM 50", v: tecnicos.mm50 },
    { k: "MM 200", v: tecnicos.mm200 },
    { k: "IFR 14", v: tecnicos.ifr14, casas: 1 },
  ];
  const chaves = Object.keys(NOMES_TECNICOS) as (keyof typeof NOMES_TECNICOS)[];
  const abertoK = chaves.find((c) => c === aberto);
  return (
    <Card title="Sinais técnicos" className="gap-3">
      <div className="grid grid-cols-4 gap-2 text-center">
        {valores.map((x) => (
          <div
            key={x.k}
            className="flex flex-col gap-0.5 rounded-control bg-sidebar px-1 py-2"
          >
            <span className="text-[11px] text-text-3">{x.k}</span>
            <span className="font-mono text-sm font-semibold tabular-nums">
              {x.v === null ? "—" : formatarNumero(x.v, x.casas ?? 2)}
            </span>
          </div>
        ))}
      </div>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {chaves.map((c) => {
          const s = tecnicos.sinais[c];
          return (
            <li key={c} className="flex flex-col gap-0.5 text-sm">
              <span className="flex items-center gap-1.5">
                {s ? (
                  <PontoDoSinal nivel={s.nivel} />
                ) : (
                  <span
                    className="inline-block size-2 rounded-full bg-border"
                    aria-hidden="true"
                  />
                )}
                {NOMES_TECNICOS[c]}
                <BotaoDeAjuda
                  nome={NOMES_TECNICOS[c]}
                  aberto={aberto === c}
                  aoAlternar={() => alternar(c)}
                  controla={id}
                />
              </span>
              <span
                className={cn(
                  "pl-3.5 text-xs",
                  s ? textoDoNivel(s.nivel) : "text-text-3",
                )}
              >
                {s ? s.leitura : "histórico curto para calcular"}
              </span>
            </li>
          );
        })}
      </ul>
      {abertoK && (
        <PainelDeAjuda
          id={id}
          nome={NOMES_TECNICOS[abertoK]}
          ajuda={AJUDA_TECNICA[abertoK]}
          sinal={tecnicos.sinais[abertoK]}
        />
      )}
      <p className="m-0 text-xs leading-normal text-text-3">
        Último pregão, preço ajustado. Não é recomendação.
      </p>
    </Card>
  );
}

/** Versao do celular: grade de 3 colunas e cartao compacto de preco justo. */
export function LateralMobile({
  indicadores,
  preco,
  tecnicos,
}: {
  indicadores: Indicadores | null;
  preco: string | null;
  tecnicos: SinaisTecnicos | null;
}) {
  const id = useId();
  const { aberto, alternar } = useAberto();
  const itens = itensDeIndicadores(indicadores).filter(
    (i) => !["EV/EBITDA", "Beta"].includes(i.k),
  );
  const graham = avaliarIndicador("margem_graham", indicadores?.margem_graham ?? null);
  return (
    <div className="flex flex-col gap-3.5 md:hidden">
      <div className="grid grid-cols-3 gap-2">
        {itens.map((i) => (
          <div
            key={i.k}
            className="flex flex-col gap-0.5 rounded-control border border-border bg-surface px-2.5 py-2"
          >
            <span className="text-[11px] text-text-3">
              <Rotulo
                item={i}
                aberto={aberto === i.k}
                aoAlternar={() => alternar(i.k)}
                controla={id}
                curto
              />
            </span>
            <span className="font-mono font-semibold tabular-nums">{i.v}</span>
          </div>
        ))}
      </div>
      <AjudaDoItem id={id} item={itens.find((i) => i.k === aberto)} />
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
          {graham && <Veredito sinal={graham} />}
          <span className="text-[11px] text-text-3">Não é recomendação.</span>
        </div>
      )}
      <SinaisTecnicosCard tecnicos={tecnicos} />
    </div>
  );
}
