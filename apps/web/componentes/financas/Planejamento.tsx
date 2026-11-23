"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Copy, Repeat, Sparkles, Trash } from "lucide-react";
import { useState, type FormEvent } from "react";
import { NovoItemDoPlanejamento, type Planejamento } from "@bolsiq/finance/puro";
import { Button, Card, EmptyState, Money, Skeleton, StatTile, cn } from "@bolsiq/ui";
import { hojeEmSp } from "@/lib/indicadores-tecnicos";
import { CAMPO } from "../conta/campos";
import {
  apagarItem,
  CHAVE,
  copiarPlanejamento,
  definirValorDaCategoria,
  sugerirOrcamento,
  criarItem,
  editarItem,
  puxarRecorrencias,
  useCategorias,
  usePlanejamento,
} from "./cliente";
import { ROTULO } from "./Contas";
import { Barra, nomeDoMes, outroMes, SeletorDeMes } from "./Mes";

function NovoItem({ mes, onSalvo }: { mes: string; onSalvo: (p: Planejamento) => void }) {
  const { data: categorias = [] } = useCategorias();
  const [categoria, setCategoria] = useState("");
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [fixo, setFixo] = useState(false);
  const [dividido, setDividido] = useState(false);
  const [parte, setParte] = useState("50");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function salvar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro(null);
    const item = {
      mes,
      category_id: categoria,
      descricao,
      valor,
      fixo,
      parte_propria: dividido ? parte : null,
    };
    const r = NovoItemDoPlanejamento.safeParse(item);
    if (!r.success)
      return setErro(
        !categoria
          ? "Escolha a categoria."
          : (r.error.issues[0]?.message ?? "Dados inválidos."),
      );
    setEnviando(true);
    try {
      onSalvo(await criarItem(item));
      setDescricao("");
      setValor("");
    } catch (falha) {
      setErro((falha as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  const grupo = (natureza: "receita" | "despesa", rotulo: string) => (
    <optgroup label={rotulo}>
      {categorias
        .filter((c) => c.natureza === natureza && !c.arquivada)
        .map((c) => (
          <option key={c.id} value={c.id}>
            {c.nome}
          </option>
        ))}
    </optgroup>
  );

  return (
    <Card title="Adicionar ao planejamento">
      <form
        aria-label="Novo item do planejamento"
        onSubmit={(e) => void salvar(e)}
        className="grid grid-cols-2 gap-3 md:grid-cols-[1fr_1fr_140px_auto_auto_auto] md:items-end"
        noValidate
      >
        <label className={ROTULO}>
          Categoria
          <select
            className={CAMPO}
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
          >
            <option value="">Escolha</option>
            {grupo("despesa", "Despesas")}
            {grupo("receita", "Receitas")}
          </select>
        </label>
        <label className={ROTULO}>
          Descrição
          <input
            className={CAMPO}
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Opcional: feira, academia"
          />
        </label>
        <label className={ROTULO}>
          {dividido ? "Valor fechado" : "Valor planejado"}
          <input
            className={cn(CAMPO, "font-mono")}
            inputMode="decimal"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            placeholder="0,00"
          />
        </label>
        <label className="flex min-h-touch items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={fixo}
            onChange={(e) => setFixo(e.target.checked)}
          />
          Fixo
        </label>
        <div className="col-span-2 flex min-h-touch items-center gap-2 text-sm md:col-span-1">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={dividido}
              onChange={(e) => setDividido(e.target.checked)}
            />
            Dividido
          </label>
          {dividido && (
            <label className="flex items-center gap-1">
              <span className="sr-only">Sua parte (%)</span>
              <input
                aria-label="Sua parte (%)"
                className={cn(CAMPO, "h-8 w-16 py-0 text-right font-mono")}
                inputMode="decimal"
                value={parte}
                onChange={(e) => setParte(e.target.value)}
              />
              <span className="whitespace-nowrap">% seu</span>
            </label>
          )}
        </div>
        <Button type="submit" variant="primary" disabled={enviando}>
          Adicionar
        </Button>
      </form>
      {dividido && (
        <p className="m-0 text-xs text-text-3">
          Informe o valor fechado da conta; só a sua parte entra no planejado e na sobra.
        </p>
      )}
      {erro && (
        <p role="alert" className="m-0 text-sm text-down">
          {erro}
        </p>
      )}
    </Card>
  );
}

const ESTADO = { ok: "ok", atencao: "atenção", estourado: "estourado" } as const;

/** Valor da categoria editavel no lugar: clique, digite, Enter salva, Esc cancela. */
function ValorInline({
  valor,
  rotulo,
  onSalvar,
}: {
  valor: string;
  rotulo: string;
  onSalvar: (v: string) => Promise<unknown>;
}) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState("");
  if (!editando)
    return (
      <button
        type="button"
        aria-label={`${rotulo}: editar`}
        className="cursor-pointer border-0 border-b border-dashed border-border-strong bg-transparent p-0 text-text"
        onClick={() => {
          setTexto(valor.replace(".", ","));
          setEditando(true);
        }}
      >
        <Money value={valor} />
      </button>
    );
  return (
    <input
      autoFocus
      aria-label={rotulo}
      className={cn(CAMPO, "h-8 w-28 py-0 text-right font-mono")}
      inputMode="decimal"
      value={texto}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={() => setEditando(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape") setEditando(false);
        if (e.key === "Enter") {
          e.preventDefault();
          void onSalvar(texto).then(() => setEditando(false));
        }
      }}
    />
  );
}

/** Percentual do usuario num item dividido; Enter ou sair do campo salva. */
function ParteInline({
  parte,
  rotulo,
  onSalvar,
}: {
  parte: number;
  rotulo: string;
  onSalvar: (v: string) => Promise<unknown>;
}) {
  const [texto, setTexto] = useState(String(parte).replace(".", ","));
  const salvar = () => {
    if (texto.replace(",", ".") !== String(parte)) void onSalvar(texto);
  };
  return (
    <input
      aria-label={rotulo}
      className={cn(CAMPO, "h-7 w-14 py-0 text-right font-mono text-xs")}
      inputMode="decimal"
      value={texto}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={salvar}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          salvar();
        }
      }}
    />
  );
}

/**
 * Planejamento do mes (orcamento): o que se pretende receber e gastar por
 * categoria, fixo ou variavel, contra o que aconteceu. Nao cria lancamento.
 */
export function PaginaDePlanejamento() {
  const cliente = useQueryClient();
  const [mes, setMes] = useState(hojeEmSp().slice(0, 7));
  const { data, isPending } = usePlanejamento(mes);
  const { data: categorias = [] } = useCategorias();
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const nome = new Map(categorias.map((c) => [c.id, c.nome]));
  const guardar = (p: Planejamento) =>
    cliente.setQueryData([...CHAVE, "planejamento", mes], p);
  const recarregar = () =>
    void cliente.invalidateQueries({ queryKey: [...CHAVE, "planejamento", mes] });

  async function agir(fn: () => Promise<unknown>) {
    setErro(null);
    setAviso(null);
    try {
      await fn();
    } catch (falha) {
      setErro((falha as Error).message);
    }
  }

  const anterior = outroMes(mes, -1);
  const t = data?.totais;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-[26px] font-bold tracking-tight">Planejamento</h1>
        <SeletorDeMes mes={mes} onMudar={setMes} />
      </header>
      <p className="m-0 max-w-[70ch] text-sm text-text-2">
        Planeje quanto pretende receber e gastar em cada categoria e marque o que é fixo.
        O planejamento não mexe nos seus lançamentos: ele só compara o planejado com o
        realizado.
      </p>

      {t && (
        <section
          aria-label="Resumo do planejamento"
          className="grid grid-cols-2 gap-3 md:grid-cols-5"
        >
          <StatTile
            label="Receitas planejadas"
            value={<Money value={t.receitas_planejadas} />}
          />
          <StatTile
            label="Despesas planejadas"
            value={<Money value={t.despesas_planejadas} />}
            subtitle={
              Number(t.despesas_de_terceiros) > 0 ? (
                <>
                  sua parte; outros cobrem <Money value={t.despesas_de_terceiros} />
                </>
              ) : undefined
            }
          />
          <StatTile label="Fixas" value={<Money value={t.despesas_fixas} />} />
          <StatTile label="Variáveis" value={<Money value={t.despesas_variaveis} />} />
          <StatTile
            label="Sobra planejada"
            value={
              <Money
                value={t.sobra_planejada}
                className={t.sobra_planejada.startsWith("-") ? "text-down" : "text-up"}
              />
            }
            subtitle={
              <>
                realizado: <Money value={t.receitas_realizadas} /> -{" "}
                <Money value={t.despesas_realizadas} />
              </>
            }
          />
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={() =>
            void agir(async () => {
              const r = await copiarPlanejamento(anterior, mes);
              setAviso(
                r.data.itens > 0
                  ? `${r.data.itens} itens copiados de ${nomeDoMes(anterior)}.`
                  : `Nada novo para copiar de ${nomeDoMes(anterior)}.`,
              );
              recarregar();
            })
          }
        >
          <Copy aria-hidden="true" size={16} />
          Copiar do mês anterior
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            void agir(async () => {
              const r = await puxarRecorrencias(mes);
              setAviso(
                r.data.itens > 0
                  ? `${r.data.itens} recorrentes adicionados como fixos.`
                  : "Nenhum recorrente novo para adicionar.",
              );
              recarregar();
            })
          }
        >
          <Repeat aria-hidden="true" size={16} />
          Puxar recorrentes
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            void agir(async () => {
              const r = await sugerirOrcamento(mes);
              setAviso(
                r.data.itens > 0
                  ? `${r.data.itens} categorias sugeridas pela média dos últimos 3 meses.`
                  : "Nada a sugerir: as categorias com gasto já têm planejamento.",
              );
              recarregar();
            })
          }
        >
          <Sparkles aria-hidden="true" size={16} />
          Sugerir pela média
        </Button>
      </div>
      {aviso && (
        <p role="status" className="m-0 text-sm text-text-2">
          {aviso}
        </p>
      )}
      {erro && (
        <p role="alert" className="m-0 text-sm text-down">
          {erro}
        </p>
      )}

      <NovoItem mes={mes} onSalvo={guardar} />

      {isPending || !data ? (
        <Skeleton className="h-40" />
      ) : data.categorias.length === 0 ? (
        <Card>
          <EmptyState
            title="Nada planejado neste mês"
            description="Adicione itens por categoria, copie o mês anterior ou puxe os recorrentes."
          />
        </Card>
      ) : (
        <Card title="Planejado x realizado">
          <table
            aria-label="Planejado x realizado"
            className="w-full border-collapse text-sm"
          >
            <thead>
              <tr className="text-left text-xs text-text-3">
                <th className="py-2 font-medium">Categoria</th>
                <th className="py-2 text-right font-medium">Planejado</th>
                <th className="hidden py-2 text-right font-medium md:table-cell">
                  Realizado
                </th>
                <th className="hidden py-2 text-right font-medium md:table-cell">
                  Previsto
                </th>
                <th className="py-2 text-right font-medium">Restante</th>
              </tr>
            </thead>
            <tbody>
              {data.categorias.map((c) => {
                const itens = data.itens.filter((i) => i.category_id === c.category_id);
                return [
                  <tr key={c.category_id} className="border-t border-border align-top">
                    <td className="py-2.5">
                      <span className="font-semibold">{c.nome}</span>
                      <span className="block text-xs text-text-3">
                        {c.natureza === "receita" ? "receita" : "despesa"}
                        {Number(c.fixo) > 0 ? " · tem fixo" : ""}
                        {c.natureza === "despesa" && c.estado !== "ok" && (
                          <span
                            className={cn(
                              "ml-1.5 font-semibold",
                              c.estado === "estourado" ? "text-down" : "text-warn",
                            )}
                          >
                            · {ESTADO[c.estado]}
                          </span>
                        )}
                      </span>
                      <span className="mt-1 block md:hidden">
                        <span className="text-xs text-text-3">
                          realizado <Money value={c.realizado} />
                        </span>
                      </span>
                      <span className="mt-1.5 block max-w-[260px]">
                        <Barra
                          valor={Number(c.realizado) + Number(c.previsto)}
                          total={Number(c.planejado)}
                          rotulo={`${c.nome}: realizado e previsto sobre o planejado`}
                        />
                      </span>
                    </td>
                    <td className="py-2.5 text-right">
                      <ValorInline
                        valor={c.planejado}
                        rotulo={`Planejado para ${c.nome}`}
                        onSalvar={(v) =>
                          agir(async () =>
                            guardar(await definirValorDaCategoria(mes, c.category_id, v)),
                          )
                        }
                      />
                    </td>
                    <td className="hidden py-2.5 text-right md:table-cell">
                      <Money value={c.realizado} />
                    </td>
                    <td className="hidden py-2.5 text-right text-text-2 md:table-cell">
                      <Money value={c.previsto} />
                    </td>
                    <td className="py-2.5 text-right">
                      <Money
                        value={c.restante}
                        className={c.restante.startsWith("-") ? "text-down" : undefined}
                      />
                    </td>
                  </tr>,
                  ...itens.map((i) => (
                    <tr key={i.id} className="text-text-2">
                      <td className="py-1 pl-4 text-xs">
                        {i.descricao ?? nome.get(i.category_id)}
                        <label className="ml-3 inline-flex items-center gap-1">
                          <input
                            type="checkbox"
                            aria-label={`Fixo: ${i.descricao ?? nome.get(i.category_id)}`}
                            checked={i.fixo}
                            onChange={(e) =>
                              void agir(async () =>
                                guardar(
                                  await editarItem(i.id, { fixo: e.target.checked }),
                                ),
                              )
                            }
                          />
                          fixo
                        </label>
                        <label className="ml-3 inline-flex items-center gap-1">
                          <input
                            type="checkbox"
                            aria-label={`Dividido: ${i.descricao ?? nome.get(i.category_id)}`}
                            checked={i.parte_propria !== null}
                            onChange={(e) =>
                              void agir(async () =>
                                guardar(
                                  await editarItem(i.id, {
                                    parte_propria: e.target.checked ? 50 : null,
                                  }),
                                ),
                              )
                            }
                          />
                          dividido
                        </label>
                        {i.parte_propria !== null && (
                          <span className="ml-2 inline-flex items-center gap-1">
                            <ParteInline
                              key={`${i.id}-${i.parte_propria}`}
                              parte={i.parte_propria}
                              rotulo={`Sua parte (%): ${i.descricao ?? nome.get(i.category_id)}`}
                              onSalvar={(v) =>
                                agir(async () =>
                                  guardar(await editarItem(i.id, { parte_propria: v })),
                                )
                              }
                            />
                            % seu
                          </span>
                        )}
                      </td>
                      <td className="py-1 text-right text-xs">
                        <Money value={i.valor_proprio} />
                        {i.parte_propria !== null && (
                          <span className="block text-text-3">
                            de <Money value={i.valor} />
                          </span>
                        )}
                      </td>
                      <td className="hidden md:table-cell" colSpan={2} />
                      <td className="py-1 text-right">
                        <Button
                          variant="ghost"
                          className="h-8 px-2"
                          aria-label={`Remover ${i.descricao ?? nome.get(i.category_id)} do planejamento`}
                          onClick={() =>
                            void agir(async () => guardar(await apagarItem(i.id)))
                          }
                        >
                          <Trash aria-hidden="true" size={14} />
                        </Button>
                      </td>
                    </tr>
                  )),
                ];
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
