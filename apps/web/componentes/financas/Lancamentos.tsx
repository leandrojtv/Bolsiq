"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash } from "lucide-react";
import { useState, type FormEvent } from "react";
import {
  EdicaoDeLancamento,
  NovoLancamento,
  STATUS_DE_LANCAMENTO,
  type Categoria,
  type Conta,
  type Lancamento,
  type StatusDeLancamento,
  type TipoDeLancamento,
} from "@bolsiq/finance/puro";
import { Button, Card, EmptyState, Money, Sheet, Skeleton, cn } from "@bolsiq/ui";
import { hojeEmSp } from "@/lib/indicadores-tecnicos";
import { CAMPO } from "../conta/campos";
import {
  apagarLancamento,
  CHAVE,
  criarLancamento,
  editarLancamento,
  STATUS_ROTULO,
  useCategorias,
  useContas,
  useLancamentos,
  valorComSinal,
} from "./cliente";
import { ROTULO } from "./Contas";

const POR_PAGINA = 50;
const dataBr = (d: string) => d.split("-").reverse().join("/");

function OpcoesDeCategoria({
  categorias,
  natureza,
}: {
  categorias: Categoria[];
  natureza: "receita" | "despesa";
}) {
  const ativas = categorias.filter((c) => c.natureza === natureza && !c.arquivada);
  const raizes = ativas.filter((c) => c.parent_id === null);
  return (
    <>
      <option value="">Sem categoria</option>
      {raizes.map((r) => [
        <option key={r.id} value={r.id}>
          {r.nome}
        </option>,
        ...ativas
          .filter((f) => f.parent_id === r.id)
          .map((f) => (
            <option key={f.id} value={f.id}>
              {`  ${r.nome} › ${f.nome}`}
            </option>
          )),
      ])}
    </>
  );
}

/**
 * Lancamento rapido: valor, descricao, data, conta e categoria. Enter em
 * qualquer campo salva (e um form), e o foco volta para o valor.
 */
export function LancamentoRapido({
  contas,
  onSalvo,
}: {
  contas: Conta[];
  onSalvo: () => void;
}) {
  const { data: categorias = [] } = useCategorias();
  const ativas = contas.filter((c) => !c.arquivada);
  const [tipo, setTipo] = useState<"despesa" | "receita">("despesa");
  const [valor, setValor] = useState("");
  const [descricao, setDescricao] = useState("");
  const [data, setData] = useState(hojeEmSp());
  const [conta, setConta] = useState(ativas[0]?.id ?? "");
  const [categoria, setCategoria] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const contaEscolhida = ativas.some((c) => c.id === conta)
    ? conta
    : (ativas[0]?.id ?? "");

  async function salvar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setErro(null);
    const digitado = {
      tipo,
      valor,
      descricao,
      data,
      account_id: contaEscolhida,
      category_id: categoria || null,
    };
    const r = NovoLancamento.safeParse(digitado);
    if (!r.success) return setErro(r.error.issues[0]?.message ?? "Dados inválidos.");
    setEnviando(true);
    try {
      await criarLancamento(digitado);
      setValor("");
      setDescricao("");
      setCategoria("");
      onSalvo();
      form.querySelector<HTMLInputElement>("input[name=valor]")?.focus();
    } catch (falha) {
      setErro((falha as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Card title="Lançamento rápido">
      <form
        aria-label="Lançamento rápido"
        onSubmit={(e) => void salvar(e)}
        className="grid grid-cols-2 gap-3 md:grid-cols-[120px_120px_1fr_150px_170px_190px_auto] md:items-end"
        noValidate
      >
        <label className={ROTULO}>
          Tipo
          <select
            className={CAMPO}
            value={tipo}
            onChange={(e) => {
              setTipo(e.target.value as "despesa" | "receita");
              setCategoria("");
            }}
          >
            <option value="despesa">Despesa</option>
            <option value="receita">Receita</option>
          </select>
        </label>
        <label className={ROTULO}>
          Valor
          <input
            name="valor"
            className={cn(CAMPO, "font-mono")}
            inputMode="decimal"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            placeholder="0,00"
            autoComplete="off"
          />
        </label>
        <label className={cn(ROTULO, "col-span-2 md:col-span-1")}>
          Descrição
          <input
            className={CAMPO}
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Padaria, aluguel, salário"
            autoComplete="off"
          />
        </label>
        <label className={ROTULO}>
          Data
          <input
            type="date"
            className={CAMPO}
            value={data}
            onChange={(e) => setData(e.target.value)}
          />
        </label>
        <label className={ROTULO}>
          Conta
          <select
            className={CAMPO}
            value={contaEscolhida}
            onChange={(e) => setConta(e.target.value)}
          >
            {ativas.map((c) => (
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
            <OpcoesDeCategoria categorias={categorias} natureza={tipo} />
          </select>
        </label>
        <Button
          type="submit"
          variant="primary"
          disabled={enviando}
          className="col-span-2 md:col-span-1"
        >
          Lançar
        </Button>
      </form>
      {erro && (
        <p role="alert" className="m-0 text-sm text-down">
          {erro}
        </p>
      )}
    </Card>
  );
}

/** Drawer de criar e editar lancamento, inclusive transferencia. */
export function FormularioDeLancamento({
  contas,
  categorias,
  inicial,
  onSalvo,
}: {
  contas: Conta[];
  categorias: Categoria[];
  inicial?: Lancamento;
  onSalvo: () => void;
}) {
  const ativas = contas.filter((c) => !c.arquivada || c.id === inicial?.account_id);
  const [tipo, setTipo] = useState<TipoDeLancamento>(inicial?.tipo ?? "despesa");
  const [valor, setValor] = useState(inicial?.valor.replace(".", ",") ?? "");
  const [descricao, setDescricao] = useState(inicial?.descricao ?? "");
  const [data, setData] = useState(inicial?.data ?? hojeEmSp());
  const [conta, setConta] = useState(inicial?.account_id ?? ativas[0]?.id ?? "");
  const [destino, setDestino] = useState("");
  const [categoria, setCategoria] = useState(inicial?.category_id ?? "");
  const [status, setStatus] = useState<StatusDeLancamento>(
    inicial?.status ?? "realizado",
  );
  const [observacao, setObservacao] = useState(inicial?.observacao ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const transferencia = tipo === "transferencia";

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      if (inicial) {
        const edicao = {
          valor,
          descricao,
          data,
          account_id: conta,
          status,
          observacao,
          ...(transferencia ? {} : { category_id: categoria || null }),
        };
        const r = EdicaoDeLancamento.safeParse(edicao);
        if (!r.success) return setErro(r.error.issues[0]?.message ?? "Dados inválidos.");
        await editarLancamento(inicial.id, edicao);
      } else {
        const novo = {
          tipo,
          valor,
          descricao,
          data,
          account_id: conta,
          status,
          observacao,
          ...(transferencia
            ? { conta_destino_id: destino }
            : { category_id: categoria || null }),
        };
        const r = NovoLancamento.safeParse(novo);
        if (!r.success) return setErro(r.error.issues[0]?.message ?? "Dados inválidos.");
        await criarLancamento(novo);
      }
      onSalvo();
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
            value={tipo}
            disabled={inicial !== undefined}
            onChange={(e) => {
              setTipo(e.target.value as TipoDeLancamento);
              setCategoria("");
            }}
          >
            <option value="despesa">Despesa</option>
            <option value="receita">Receita</option>
            <option value="transferencia">Transferência</option>
          </select>
        </label>
        <label className={ROTULO}>
          Valor
          <input
            className={cn(CAMPO, "font-mono")}
            inputMode="decimal"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            placeholder="0,00"
          />
        </label>
        <label className={cn(ROTULO, "col-span-2")}>
          Descrição
          <input
            className={CAMPO}
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
          />
        </label>
        <label className={ROTULO}>
          Data
          <input
            type="date"
            className={CAMPO}
            value={data}
            onChange={(e) => setData(e.target.value)}
          />
        </label>
        <label className={ROTULO}>
          Status
          <select
            className={CAMPO}
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusDeLancamento)}
          >
            {STATUS_DE_LANCAMENTO.map((s) => (
              <option key={s} value={s}>
                {STATUS_ROTULO[s]}
              </option>
            ))}
          </select>
        </label>
        <label className={ROTULO}>
          {transferencia ? "Conta de origem" : "Conta"}
          <select
            className={CAMPO}
            value={conta}
            onChange={(e) => setConta(e.target.value)}
          >
            {ativas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </label>
        {transferencia && !inicial ? (
          <label className={ROTULO}>
            Conta de destino
            <select
              className={CAMPO}
              value={destino}
              onChange={(e) => setDestino(e.target.value)}
            >
              <option value="">Escolha</option>
              {ativas
                .filter((c) => c.id !== conta)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
            </select>
          </label>
        ) : !transferencia ? (
          <label className={ROTULO}>
            Categoria
            <select
              className={CAMPO}
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
            >
              <OpcoesDeCategoria
                categorias={categorias}
                natureza={tipo === "receita" ? "receita" : "despesa"}
              />
            </select>
          </label>
        ) : null}
        <label className={cn(ROTULO, "col-span-2")}>
          Observação
          <input
            className={CAMPO}
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            placeholder="Opcional"
          />
        </label>
      </div>
      {transferencia && (
        <p className="m-0 text-xs text-text-3">
          Transferência move o saldo entre as contas e não conta como receita nem despesa.
        </p>
      )}
      {erro && (
        <p role="alert" className="m-0 text-sm text-down">
          {erro}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={enviando}>
        {inicial ? "Salvar alterações" : "Salvar lançamento"}
      </Button>
    </form>
  );
}

export function PaginaDeLancamentos() {
  const cliente = useQueryClient();
  const { data: contas = [], isPending: carregandoContas } = useContas();
  const { data: categorias = [] } = useCategorias();
  const [filtro, setFiltro] = useState({
    de: "",
    ate: "",
    conta: "",
    categoria: "",
    status: "",
    q: "",
  });
  const [pagina, setPagina] = useState(1);
  const { data, isPending } = useLancamentos({
    ...filtro,
    pagina: String(pagina),
    por_pagina: String(POR_PAGINA),
  });
  const [aberto, setAberto] = useState<Lancamento | "novo" | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const atualizar = () => void cliente.invalidateQueries({ queryKey: CHAVE });
  const nomeDaConta = new Map(contas.map((c) => [c.id, c.nome]));
  const nomeDaCategoria = new Map(categorias.map((c) => [c.id, c.nome]));
  const mudar = (k: keyof typeof filtro, v: string) => {
    setFiltro((f) => ({ ...f, [k]: v }));
    setPagina(1);
  };
  const total = data?.meta.total ?? 0;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-[26px] font-bold tracking-tight">Lançamentos</h1>
        <Button
          variant="primary"
          onClick={() => setAberto("novo")}
          disabled={contas.length === 0}
        >
          <Plus aria-hidden="true" size={16} />
          Novo lançamento
        </Button>
      </header>

      {!carregandoContas && contas.length === 0 ? (
        <Card>
          <EmptyState
            title="Crie uma conta primeiro"
            description="Todo lançamento pertence a uma conta."
            action={
              <Button asChild variant="primary">
                <a href="/financas/contas?nova=1">Criar conta</a>
              </Button>
            }
          />
        </Card>
      ) : (
        contas.length > 0 && <LancamentoRapido contas={contas} onSalvo={atualizar} />
      )}

      <Card title="Filtros">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-7">
          <label className={cn(ROTULO, "col-span-2")}>
            Buscar
            <input
              type="search"
              className={CAMPO}
              value={filtro.q}
              onChange={(e) => mudar("q", e.target.value)}
              placeholder="Descrição"
            />
          </label>
          <label className={ROTULO}>
            De
            <input
              type="date"
              className={CAMPO}
              value={filtro.de}
              onChange={(e) => mudar("de", e.target.value)}
            />
          </label>
          <label className={ROTULO}>
            Até
            <input
              type="date"
              className={CAMPO}
              value={filtro.ate}
              onChange={(e) => mudar("ate", e.target.value)}
            />
          </label>
          <label className={ROTULO}>
            Filtrar conta
            <select
              className={CAMPO}
              value={filtro.conta}
              onChange={(e) => mudar("conta", e.target.value)}
            >
              <option value="">Todas</option>
              {contas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </label>
          <label className={ROTULO}>
            Filtrar categoria
            <select
              className={CAMPO}
              value={filtro.categoria}
              onChange={(e) => mudar("categoria", e.target.value)}
            >
              <option value="">Todas</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </label>
          <label className={ROTULO}>
            Filtrar status
            <select
              className={CAMPO}
              value={filtro.status}
              onChange={(e) => mudar("status", e.target.value)}
            >
              <option value="">Todos</option>
              {STATUS_DE_LANCAMENTO.map((s) => (
                <option key={s} value={s}>
                  {STATUS_ROTULO[s]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Card>

      {erro && (
        <p role="alert" className="m-0 text-sm text-down">
          {erro}
        </p>
      )}

      <Card title={`${total} ${total === 1 ? "lançamento" : "lançamentos"}`}>
        {isPending ? (
          <Skeleton className="h-32" />
        ) : !data?.data.length ? (
          <EmptyState
            title="Nenhum lançamento"
            description="Ajuste os filtros ou lance um novo."
          />
        ) : (
          <table aria-label="Lançamentos" className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-text-3">
                <th className="hidden py-2 font-medium md:table-cell">Data</th>
                <th className="py-2 font-medium">Descrição</th>
                <th className="hidden py-2 font-medium md:table-cell">Conta</th>
                <th className="hidden py-2 font-medium md:table-cell">Categoria</th>
                <th className="hidden py-2 font-medium md:table-cell">Status</th>
                <th className="py-2 text-right font-medium">Valor</th>
                <th className="py-2">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((l) => {
                const valor = valorComSinal(l);
                return (
                  <tr key={l.id} className="border-t border-border">
                    <td className="hidden py-2.5 font-mono text-xs whitespace-nowrap md:table-cell">
                      {dataBr(l.data)}
                    </td>
                    <td className="py-2.5">
                      {l.descricao}
                      {l.tipo === "transferencia" && (
                        <span className="ml-2 text-xs text-text-3">transferência</span>
                      )}
                      <span className="block font-mono text-xs text-text-3 md:hidden">
                        {dataBr(l.data)} · {nomeDaConta.get(l.account_id)}
                      </span>
                    </td>
                    <td className="hidden py-2.5 text-text-2 md:table-cell">
                      {nomeDaConta.get(l.account_id)}
                    </td>
                    <td className="hidden py-2.5 text-text-2 md:table-cell">
                      {l.category_id ? nomeDaCategoria.get(l.category_id) : "-"}
                    </td>
                    <td className="hidden py-2.5 text-text-2 md:table-cell">
                      {STATUS_ROTULO[l.status]}
                    </td>
                    <td className="py-2.5 text-right whitespace-nowrap">
                      <Money
                        value={valor}
                        className={cn(
                          valor.startsWith("-") ? "text-down" : "text-up",
                          l.tipo === "transferencia" && "text-text-2",
                        )}
                      />
                    </td>
                    <td className="py-2.5 text-right whitespace-nowrap">
                      <Button
                        variant="ghost"
                        className="px-2"
                        aria-label={`Editar ${l.descricao}`}
                        onClick={() => setAberto(l)}
                      >
                        <Pencil aria-hidden="true" size={16} />
                      </Button>
                      <Button
                        variant="ghost"
                        className="px-2"
                        aria-label={`Apagar ${l.descricao}`}
                        onClick={() => {
                          if (!window.confirm(`Apagar "${l.descricao}"?`)) return;
                          setErro(null);
                          apagarLancamento(l.id)
                            .then(atualizar)
                            .catch((e: Error) => setErro(e.message));
                        }}
                      >
                        <Trash aria-hidden="true" size={16} />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {paginas > 1 && (
          <div className="flex items-center justify-end gap-2 text-sm">
            <Button disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>
              Anterior
            </Button>
            <span className="text-text-3">
              {pagina} de {paginas}
            </span>
            <Button disabled={pagina >= paginas} onClick={() => setPagina((p) => p + 1)}>
              Próxima
            </Button>
          </div>
        )}
      </Card>

      <Sheet
        open={aberto !== null}
        onOpenChange={(v) => !v && setAberto(null)}
        title={
          aberto === "novo" || aberto === null ? "Novo lançamento" : "Editar lançamento"
        }
      >
        {aberto !== null && (
          <FormularioDeLancamento
            contas={contas}
            categorias={categorias}
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
