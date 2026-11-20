"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash } from "lucide-react";
import { useState, type FormEvent } from "react";
import { NovaRecorrencia, type Recorrencia } from "@bolsiq/finance/puro";
import {
  Button,
  Card,
  EmptyState,
  Money,
  Sheet,
  Skeleton,
  StatTile,
  cn,
} from "@bolsiq/ui";
import { hojeEmSp } from "@/lib/indicadores-tecnicos";
import { CAMPO } from "../conta/campos";
import { dataBr } from "./Cartoes";
import {
  apagarRecorrencia,
  CHAVE,
  criarRecorrencia,
  destinoDoSeletor,
  editarRecorrencia,
  PREFIXO_CARTAO,
  useCartoes,
  useCategorias,
  useContas,
  useRecorrencias,
} from "./cliente";
import { ROTULO } from "./Contas";

const SEMANA = ["", "segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"];

const quando = (r: Recorrencia) =>
  r.frequencia === "semanal"
    ? `toda ${SEMANA[r.dia]}`
    : r.frequencia === "anual"
      ? `todo ano, dia ${r.dia}/${r.inicio.slice(5, 7)}`
      : `todo dia ${r.dia}`;

function FormularioDeRecorrencia({
  inicial,
  onSalva,
}: {
  inicial?: Recorrencia;
  onSalva: () => void;
}) {
  const { data: contas = [] } = useContas();
  const { data: cartoes = [] } = useCartoes();
  const { data: categorias = [] } = useCategorias();
  const [tipo, setTipo] = useState<"receita" | "despesa">(inicial?.tipo ?? "despesa");
  const [descricao, setDescricao] = useState(inicial?.descricao ?? "");
  const [valor, setValor] = useState(inicial?.valor.replace(".", ",") ?? "");
  const [destino, setDestino] = useState(
    inicial?.card_id
      ? `${PREFIXO_CARTAO}${inicial.card_id}`
      : (inicial?.account_id ?? contas[0]?.id ?? ""),
  );
  const [categoria, setCategoria] = useState(inicial?.category_id ?? "");
  const [frequencia, setFrequencia] = useState<string>(inicial?.frequencia ?? "mensal");
  const [dia, setDia] = useState(String(inicial?.dia ?? ""));
  const [inicio, setInicio] = useState(inicial?.inicio ?? hojeEmSp());
  const [fim, setFim] = useState(inicial?.fim ?? "");
  const [variavel, setVariavel] = useState(inicial?.valor_variavel ?? false);
  const [ativa, setAtiva] = useState(inicial?.ativa ?? true);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  // As contas podem chegar depois do formulario abrir: sem escolha, a primeira.
  const destinoEscolhido = destino || (contas.find((c) => !c.arquivada)?.id ?? "");

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const comum = {
      tipo,
      descricao,
      valor,
      category_id: categoria || null,
      frequencia,
      dia,
      inicio,
      fim: fim || null,
      valor_variavel: variavel,
      ativa,
    };
    const nova = { ...comum, ...destinoDoSeletor(destinoEscolhido) };
    const r = NovaRecorrencia.safeParse(nova);
    if (!r.success) return setErro(r.error.issues[0]?.message ?? "Dados inválidos.");
    setEnviando(true);
    try {
      await (inicial ? editarRecorrencia(inicial.id, comum) : criarRecorrencia(nova));
      onSalva();
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
            onChange={(e) => {
              setTipo(e.target.value as "receita" | "despesa");
              setCategoria("");
            }}
          >
            <option value="despesa">Despesa</option>
            <option value="receita">Receita</option>
          </select>
        </label>
        <label className={ROTULO}>
          Valor (R$)
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
            placeholder="Salário, aluguel, streaming"
          />
        </label>
        <label className={ROTULO}>
          Conta ou cartão
          <select
            className={CAMPO}
            value={destinoEscolhido}
            disabled={inicial !== undefined}
            onChange={(e) => setDestino(e.target.value)}
          >
            {contas
              .filter((c) => !c.arquivada)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            {tipo === "despesa" && cartoes.length > 0 && (
              <optgroup label="Cartões">
                {cartoes
                  .filter((c) => !c.arquivado)
                  .map((c) => (
                    <option key={c.id} value={`${PREFIXO_CARTAO}${c.id}`}>
                      {c.nome}
                    </option>
                  ))}
              </optgroup>
            )}
          </select>
        </label>
        <label className={ROTULO}>
          Categoria
          <select
            className={CAMPO}
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
          >
            <option value="">Sem categoria</option>
            {categorias
              .filter((c) => c.natureza === tipo && !c.arquivada)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
          </select>
        </label>
        <label className={ROTULO}>
          Frequência
          <select
            className={CAMPO}
            value={frequencia}
            onChange={(e) => setFrequencia(e.target.value)}
          >
            <option value="mensal">Mensal</option>
            <option value="semanal">Semanal</option>
            <option value="anual">Anual</option>
          </select>
        </label>
        <label className={ROTULO}>
          {frequencia === "semanal" ? "Dia da semana (1 = segunda)" : "Dia do mês"}
          <input
            className={cn(CAMPO, "font-mono")}
            inputMode="numeric"
            value={dia}
            onChange={(e) => setDia(e.target.value)}
            placeholder={frequencia === "semanal" ? "1" : "5"}
          />
        </label>
        <label className={ROTULO}>
          Início
          <input
            type="date"
            className={CAMPO}
            value={inicio}
            onChange={(e) => setInicio(e.target.value)}
          />
        </label>
        <label className={ROTULO}>
          Fim (opcional)
          <input
            type="date"
            className={CAMPO}
            value={fim}
            onChange={(e) => setFim(e.target.value)}
          />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={variavel}
          onChange={(e) => setVariavel(e.target.checked)}
        />
        Valor muda todo mês (usa o último valor pago no previsto)
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={ativa}
          onChange={(e) => setAtiva(e.target.checked)}
        />
        Ativa
      </label>
      <p className="m-0 text-xs text-text-3">
        Os lançamentos previstos aparecem até 90 dias à frente. Editar muda só os
        previstos futuros; o que já foi realizado fica como está.
      </p>
      {erro && (
        <p role="alert" className="m-0 text-sm text-down">
          {erro}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={enviando}>
        {inicial ? "Salvar alterações" : "Criar recorrente"}
      </Button>
    </form>
  );
}

export function PaginaDeRecorrentes() {
  const cliente = useQueryClient();
  const { data, isPending } = useRecorrencias();
  const { data: categorias = [] } = useCategorias();
  const [aberta, setAberta] = useState<Recorrencia | "nova" | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const nome = new Map(categorias.map((c) => [c.id, c.nome]));
  const atualizar = () => void cliente.invalidateQueries({ queryKey: CHAVE });
  const lista = data?.data ?? [];

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-[26px] font-bold tracking-tight">Recorrentes</h1>
        <Button variant="primary" onClick={() => setAberta("nova")}>
          <Plus aria-hidden="true" size={16} />
          Nova recorrente
        </Button>
      </header>
      {data && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatTile
            label="Receitas fixas por mês"
            value={<Money value={data.totais.receitas_mensais} className="text-up" />}
          />
          <StatTile
            label="Despesas fixas por mês"
            value={<Money value={data.totais.despesas_mensais} className="text-down" />}
          />
          <StatTile
            label="Sobra fixa"
            value={
              <Money
                value={(
                  Number(data.totais.receitas_mensais) -
                  Number(data.totais.despesas_mensais)
                ).toFixed(2)}
              />
            }
            subtitle="antes dos gastos variáveis"
          />
        </div>
      )}
      {erro && (
        <p role="alert" className="m-0 text-sm text-down">
          {erro}
        </p>
      )}
      <Card>
        {isPending ? (
          <Skeleton className="h-24" />
        ) : lista.length === 0 ? (
          <EmptyState
            title="Nenhuma recorrente ainda"
            description="Cadastre o salário, o aluguel e as assinaturas: eles viram lançamentos previstos e entram no saldo previsto do mês."
          />
        ) : (
          <ul aria-label="Recorrentes" className="m-0 flex list-none flex-col p-0">
            {lista.map((r) => (
              <li
                key={r.id}
                className={cn(
                  "flex flex-wrap items-center gap-3 border-b border-border py-3 last:border-0",
                  !r.ativa && "opacity-60",
                )}
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="font-semibold">
                    {r.descricao}
                    {!r.ativa && (
                      <span className="ml-2 text-xs text-text-3">pausada</span>
                    )}
                  </span>
                  <span className="text-xs text-text-3">
                    {quando(r)}
                    {r.category_id ? ` · ${nome.get(r.category_id)}` : ""}
                    {r.valor_variavel ? " · valor variável" : ""}
                    {r.proxima ? ` · próxima ${dataBr(r.proxima)}` : ""}
                  </span>
                </div>
                <Money
                  value={r.tipo === "despesa" ? `-${r.valor}` : r.valor}
                  className={cn(
                    "font-semibold",
                    r.tipo === "despesa" ? "text-down" : "text-up",
                  )}
                />
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    className="px-2"
                    aria-label={`Editar ${r.descricao}`}
                    onClick={() => setAberta(r)}
                  >
                    <Pencil aria-hidden="true" size={16} />
                  </Button>
                  <Button
                    variant="ghost"
                    className="px-2"
                    aria-label={`Apagar ${r.descricao}`}
                    onClick={() => {
                      if (
                        !window.confirm(`Apagar "${r.descricao}" e os previstos futuros?`)
                      )
                        return;
                      setErro(null);
                      apagarRecorrencia(r.id)
                        .then(atualizar)
                        .catch((f: Error) => setErro(f.message));
                    }}
                  >
                    <Trash aria-hidden="true" size={16} />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Sheet
        open={aberta !== null}
        onOpenChange={(v) => !v && setAberta(null)}
        title={
          aberta === "nova" || aberta === null ? "Nova recorrente" : "Editar recorrente"
        }
      >
        {aberta !== null && (
          <FormularioDeRecorrencia
            {...(aberta === "nova" ? {} : { inicial: aberta })}
            onSalva={() => {
              setAberta(null);
              atualizar();
            }}
          />
        )}
      </Sheet>
    </div>
  );
}
