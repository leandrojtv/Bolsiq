"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Lightbulb, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import {
  ConfiguracaoDeInsights,
  custoDeOportunidade,
  ROTULO_DO_TIPO,
  type AcaoDeFeedback,
  type InsightDoBff,
  type ListaDeInsights,
  type TipoDeInsight,
} from "@bolsiq/finance/puro";
import {
  Button,
  Card,
  EmptyState,
  Money,
  Sheet,
  Skeleton,
  StatTile,
  ToggleChip,
  cn,
} from "@bolsiq/ui";
import { hojeEmSp } from "@/lib/indicadores-tecnicos";
import { CAMPO } from "../conta/campos";
import { dataBr } from "./Cartoes";
import {
  CHAVE,
  responderInsight,
  salvarAjustesDosInsights,
  transformarEmRecorrente,
  useInsight,
  useInsights,
} from "./cliente";
import { ROTULO } from "./Contas";
import { SeletorDeMes } from "./Mes";

const SEVERIDADE = {
  alta: { rotulo: "Prioridade alta", classe: "bg-down-soft text-down" },
  media: { rotulo: "Prioridade média", classe: "bg-surface-2 text-warn" },
  baixa: { rotulo: "Prioridade baixa", classe: "bg-surface-2 text-text-2" },
  info: { rotulo: "Informativo", classe: "bg-surface-2 text-text-3" },
} as const;

const ACAO_FEITA: Record<AcaoDeFeedback, string> = {
  dispensado: "Você dispensou este insight",
  ainda_uso: "Você marcou que ainda usa",
  vou_cancelar: "Você marcou para cancelar",
  ja_cancelei: "Você marcou que já cancelou, mas veio cobrança depois",
};

/** Insights com economia a propor (sem os informativos), por impacto anual. */
export const comEconomia = (lista: InsightDoBff[]) =>
  lista.filter((i) => i.severidade !== "info" && Number(i.impacto_anual) > 0);

export function PaginaDeInsights() {
  const [mes, setMes] = useState(hojeEmSp().slice(0, 7));
  const [filtro, setFiltro] = useState<TipoDeInsight | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [ajustes, setAjustes] = useState(false);
  const { data, isPending } = useInsights(mes);

  const tipos = [...new Set((data?.insights ?? []).map((i) => i.tipo))];
  const visiveis = (data?.insights ?? []).filter((i) => !filtro || i.tipo === filtro);
  const economia = comEconomia(data?.insights ?? []).reduce(
    (s, i) => s + Number(i.impacto_anual),
    0,
  );

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-[26px] font-bold tracking-tight">Insights</h1>
        <div className="flex flex-wrap items-center gap-2">
          <SeletorDeMes mes={mes} onMudar={setMes} />
          <Button onClick={() => setAjustes(true)} aria-label="Ajustes dos insights">
            <SlidersHorizontal aria-hidden="true" size={16} />
            <span className="hidden sm:inline">Ajustes</span>
          </Button>
        </div>
      </header>
      <p className="m-0 max-w-[70ch] text-sm text-text-2">
        Calculados a partir dos seus lançamentos, sempre com as mesmas regras. Cada card
        mostra os lançamentos que o geraram.{" "}
        <Link
          href="/financas/insights/simulador"
          className="text-link hover:text-link-hover"
        >
          Simular cortes
        </Link>{" "}
        ·{" "}
        <Link href="/financas/assinaturas" className="text-link hover:text-link-hover">
          Assinaturas
        </Link>
      </p>

      {isPending || !data ? (
        <Skeleton className="h-64" />
      ) : data.insights.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Lightbulb aria-hidden="true" size={28} />}
            title="Ainda não há insights"
            description="Lance ou importe alguns meses de extrato e fatura para ver onde você mais gasta e onde dá para economizar."
            action={
              <Button asChild variant="primary">
                <Link href="/financas/importar">Importar extrato</Link>
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <section
            aria-label="Resumo dos insights"
            className="grid grid-cols-1 gap-3 sm:grid-cols-2"
          >
            <StatTile
              label="Economia possível por ano"
              value={<Money value={economia.toFixed(2)} className="text-up" />}
              subtitle="soma dos insights com economia"
            />
            <StatTile
              label="Insights"
              value={String(data.insights.length)}
              subtitle={
                data.ocultos > 0
                  ? `${data.ocultos} dispensado(s) fora da lista`
                  : "nenhum dispensado"
              }
            />
          </section>
          <div
            role="group"
            aria-label="Filtrar por tipo"
            className="flex flex-wrap gap-2"
          >
            <ToggleChip pressed={filtro === null} onPressedChange={() => setFiltro(null)}>
              Todos
            </ToggleChip>
            {tipos.map((t) => (
              <ToggleChip
                key={t}
                pressed={filtro === t}
                onPressedChange={() => setFiltro(filtro === t ? null : t)}
              >
                {ROTULO_DO_TIPO[t]}
              </ToggleChip>
            ))}
          </div>
          <ul aria-label="Insights" className="m-0 flex list-none flex-col gap-3 p-0">
            {visiveis.map((i) => (
              <li key={i.id}>
                <CartaoDeInsight
                  insight={i}
                  mes={mes}
                  cdi={data.cdi}
                  aberto={aberto === i.id}
                  onAbrir={() => setAberto(aberto === i.id ? null : i.id)}
                />
              </li>
            ))}
          </ul>
        </>
      )}
      {data && (
        <AjustesDosInsights
          aberto={ajustes}
          onFechar={() => setAjustes(false)}
          atual={data.configuracao}
        />
      )}
    </div>
  );
}

function CartaoDeInsight({
  insight: i,
  mes,
  cdi,
  aberto,
  onAbrir,
}: {
  insight: InsightDoBff;
  mes: string;
  cdi: ListaDeInsights["cdi"];
  aberto: boolean;
  onAbrir: () => void;
}) {
  const s = SEVERIDADE[i.severidade];
  return (
    <article
      aria-label={i.titulo}
      className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={cn("rounded-item px-2 py-0.5 font-semibold", s.classe)}>
          {s.rotulo}
        </span>
        <span className="text-text-3">{ROTULO_DO_TIPO[i.tipo]}</span>
      </div>
      <h2 className="m-0 text-base font-semibold">{i.titulo}</h2>
      <p className="m-0 text-sm text-text-2">{i.descricao}</p>
      {i.severidade !== "info" && Number(i.impacto_anual) > 0 && (
        <p className="m-0 flex flex-wrap gap-x-4 text-sm">
          <span>
            <Money value={i.impacto_mensal} className="font-semibold" /> por mês
          </span>
          <span>
            <Money value={i.impacto_anual} className="font-semibold" /> por ano
          </span>
        </p>
      )}
      <p className="m-0 text-sm">
        <strong>Sugestão:</strong> {i.acao_sugerida}
      </p>
      {i.feedback && (
        <p className="m-0 text-xs text-text-3">
          {ACAO_FEITA[i.feedback.acao]} em {dataBr(i.feedback.registrado_em)}.
        </p>
      )}
      <div>
        <Button variant="ghost" className="px-0" aria-expanded={aberto} onClick={onAbrir}>
          {aberto ? "Fechar" : "Ver lançamentos e ações"}
        </Button>
      </div>
      {aberto && <DetalheDoInsight id={i.id} mes={mes} cdi={cdi} />}
    </article>
  );
}

function DetalheDoInsight({
  id,
  mes,
  cdi,
}: {
  id: string;
  mes: string;
  cdi: ListaDeInsights["cdi"];
}) {
  const cliente = useQueryClient();
  const { data } = useInsight(id, mes);
  const [mostrar, setMostrar] = useState(20);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  if (!data) return <Skeleton className="h-32" />;
  const i = data.insight;
  const oportunidade =
    cdi && (i.tipo === "assinatura" || i.tipo === "formiga")
      ? custoDeOportunidade(i.impacto_mensal, cdi)
      : null;

  async function agir(f: () => Promise<unknown>, mensagem: string) {
    setErro(null);
    setEnviando(true);
    try {
      await f();
      setAviso(mensagem);
      await cliente.invalidateQueries({ queryKey: CHAVE });
    } catch (falha) {
      setErro((falha as Error).message);
    } finally {
      setEnviando(false);
    }
  }
  const responder = (acao: AcaoDeFeedback, mensagem: string) =>
    void agir(() => responderInsight(id, acao, mes), mensagem);

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3">
      <DadosDoInsight insight={i} />
      {oportunidade && (
        <p className="m-0 rounded-control bg-surface-2 p-3 text-sm">
          Investindo <Money value={oportunidade.valor_mensal} /> por mês no CDI, seriam{" "}
          <Money value={oportunidade.em_5_anos.acumulado} className="font-semibold" /> em
          5 anos e{" "}
          <Money value={oportunidade.em_10_anos.acumulado} className="font-semibold" /> em
          10 anos.
          <span className="mt-1 block text-xs text-text-3">
            Premissa: {oportunidade.premissa} Fonte: {oportunidade.fonte}.
          </span>
        </p>
      )}
      <table aria-label="Lançamentos de evidência" className="w-full text-sm">
        <thead>
          <tr className="text-xs text-text-3">
            <th className="py-1 pr-3 text-left font-medium">Data</th>
            <th className="py-1 pr-3 text-left font-medium">Descrição</th>
            <th className="py-1 text-right font-medium">Valor</th>
          </tr>
        </thead>
        <tbody>
          {data.evidencias.slice(0, mostrar).map((e) => (
            <tr key={e.id} className="border-t border-border">
              <td className="whitespace-nowrap py-1.5 pr-3">{dataBr(e.data)}</td>
              <td className="py-1.5 pr-3">
                {e.descricao}
                <span className="block text-xs text-text-3">
                  {[e.categoria, e.origem].filter(Boolean).join(" · ")}
                </span>
              </td>
              <td className="whitespace-nowrap py-1.5 text-right">
                <Money value={e.valor} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.evidencias.length > mostrar && (
        <Button
          variant="ghost"
          className="self-start px-0"
          onClick={() => setMostrar(mostrar + 50)}
        >
          Mostrar mais ({data.evidencias.length - mostrar})
        </Button>
      )}
      {erro && (
        <p role="alert" className="m-0 text-sm text-down">
          {erro}
        </p>
      )}
      {aviso && (
        <p role="status" className="m-0 text-sm text-up">
          {aviso}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {i.tipo === "assinatura" && (
          <>
            <Button
              disabled={enviando}
              onClick={() => responder("ainda_uso", "Anotado: você ainda usa.")}
            >
              Ainda uso
            </Button>
            <Button
              disabled={enviando}
              onClick={() => responder("vou_cancelar", "Anotado: você vai cancelar.")}
            >
              Vou cancelar
            </Button>
            <Button
              disabled={enviando}
              onClick={() =>
                responder("ja_cancelei", "Anotado: se vier cobrança, avisamos de novo.")
              }
            >
              Já cancelei
            </Button>
            <Button
              disabled={enviando}
              onClick={() =>
                void agir(
                  () => transformarEmRecorrente(id),
                  "Recorrência criada a partir da próxima cobrança.",
                )
              }
            >
              Transformar em recorrente
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          disabled={enviando}
          onClick={() => responder("dispensado", "Dispensado por 90 dias.")}
        >
          Dispensar
        </Button>
      </div>
    </div>
  );
}

interface Linha {
  nome: string;
  valor: string;
  extra?: string;
}

function ListaDeValores({ titulo, linhas }: { titulo: string; linhas: Linha[] }) {
  return (
    <div>
      <h3 className="m-0 mb-1 text-xs font-semibold text-text-3">{titulo}</h3>
      <ul aria-label={titulo} className="m-0 list-none p-0 text-sm">
        {linhas.map((l) => (
          <li key={l.nome} className="flex justify-between gap-3 py-1">
            <span>
              {l.nome}
              {l.extra && <span className="ml-2 text-xs text-text-3">{l.extra}</span>}
            </span>
            <Money value={l.valor} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Os numeros do detector, por tipo. */
function DadosDoInsight({ insight: i }: { insight: InsightDoBff }) {
  const dd = i.dados;
  if (i.tipo === "ranking") {
    const cats = dd.categorias as {
      nome: string;
      valor: string;
      pct_do_gasto: number;
      pct_da_renda: number | null;
    }[];
    return (
      <ListaDeValores
        titulo="Gasto por categoria"
        linhas={cats.map((c) => ({
          nome: c.nome,
          valor: c.valor,
          extra: `${c.pct_do_gasto}% do gasto${c.pct_da_renda === null ? "" : ` · ${c.pct_da_renda}% da renda`}`,
        }))}
      />
    );
  }
  if (i.tipo === "tarifas") {
    const tipos = dd.por_tipo as { rotulo: string; valor: string; lancamentos: number }[];
    return (
      <ListaDeValores
        titulo="Por tipo, em 12 meses"
        linhas={tipos.map((t) => ({
          nome: t.rotulo,
          valor: t.valor,
          extra: `${t.lancamentos}x`,
        }))}
      />
    );
  }
  if (i.tipo === "formiga") {
    const est = dd.estabelecimentos as {
      nome: string;
      anual: string;
      vezes_por_mes: number;
    }[];
    return (
      <ListaDeValores
        titulo="Projeção anual por lugar"
        linhas={est.map((e) => ({
          nome: e.nome,
          valor: e.anual,
          extra: `${e.vezes_por_mes.toLocaleString("pt-BR")}x por mês`,
        }))}
      />
    );
  }
  if (i.tipo === "essencial_superfluo") {
    const v = dd.valores as Record<string, string>;
    const p = dd.percentuais as Record<string, number>;
    const r = dd.referencia as Record<string, number>;
    return (
      <ListaDeValores
        titulo="Divisão da renda do mês"
        linhas={(
          [
            ["essenciais", "Essenciais"],
            ["nao_essenciais", "Não essenciais"],
            ["poupanca", "Poupança e investimentos"],
          ] as const
        ).map(([k, nome]) => ({
          nome,
          valor: v[k] ?? "0",
          extra: `${p[k]}% (referência ${r[k]}%)`,
        }))}
      />
    );
  }
  return null;
}

function AjustesDosInsights({
  aberto,
  onFechar,
  atual,
}: {
  aberto: boolean;
  onFechar: () => void;
  atual: ListaDeInsights["configuracao"];
}) {
  const cliente = useQueryClient();
  const [limite, setLimite] = useState(atual.limite_formiga.replace(".", ","));
  const [ref, setRef] = useState(atual.referencia);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const pedido = { limite_formiga: limite, referencia: ref };
    const r = ConfiguracaoDeInsights.safeParse(pedido);
    if (!r.success) return setErro(r.error.issues[0]?.message ?? "Dados inválidos.");
    try {
      await salvarAjustesDosInsights(pedido);
      await cliente.invalidateQueries({ queryKey: CHAVE });
      onFechar();
    } catch (falha) {
      setErro((falha as Error).message);
    }
  }

  const campo = (k: keyof typeof ref, rotulo: string) => (
    <label className={ROTULO}>
      {rotulo}
      <input
        className={cn(CAMPO, "font-mono")}
        inputMode="numeric"
        value={ref[k]}
        onChange={(e) => setRef({ ...ref, [k]: Number(e.target.value) || 0 })}
      />
    </label>
  );

  return (
    <Sheet
      open={aberto}
      onOpenChange={(a) => !a && onFechar()}
      title="Ajustes dos insights"
    >
      <form onSubmit={(e) => void salvar(e)} className="flex flex-col gap-3" noValidate>
        <label className={ROTULO}>
          Efeito formiga: compras abaixo de (R$)
          <input
            className={cn(CAMPO, "font-mono")}
            inputMode="decimal"
            value={limite}
            onChange={(e) => setLimite(e.target.value)}
          />
        </label>
        <fieldset className="m-0 grid grid-cols-3 gap-3 border-0 p-0">
          <legend className="mb-2 text-sm text-text-2">
            Referência da renda (%), soma 100
          </legend>
          {campo("essenciais", "Essenciais")}
          {campo("nao_essenciais", "Não essenciais")}
          {campo("poupanca", "Poupança")}
        </fieldset>
        {erro && (
          <p role="alert" className="m-0 text-sm text-down">
            {erro}
          </p>
        )}
        <Button type="submit" variant="primary">
          Salvar ajustes
        </Button>
      </form>
    </Sheet>
  );
}
