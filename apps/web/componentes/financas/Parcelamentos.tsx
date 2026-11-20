"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { NovoParcelamentoNoCartao, type Plano } from "@bolsiq/finance/puro";
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
  apagarPlano,
  CHAVE,
  criarParcelamento,
  quitarPlano,
  useCartoes,
  useCategorias,
  useComprometido,
  usePlanos,
} from "./cliente";
import { ROTULO } from "./Contas";
import { GraficoDeParcelas } from "./Graficos";
import { Barra } from "./Mes";

export function FormularioDeParcelamento({
  cartaoInicial,
  onSalvo,
}: {
  cartaoInicial?: string;
  onSalvo: () => void;
}) {
  const { data: cartoes = [] } = useCartoes();
  const { data: categorias = [] } = useCategorias();
  const [cartao, setCartao] = useState(cartaoInicial ?? "");
  const [descricao, setDescricao] = useState("");
  const [categoria, setCategoria] = useState("");
  const [data, setData] = useState(hojeEmSp());
  const [n, setN] = useState("");
  const [modo, setModo] = useState<"parcela" | "total">("parcela");
  const [valor, setValor] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const cartaoEscolhido = cartao || (cartoes.find((c) => !c.arquivado)?.id ?? "");

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const pedido = {
      card_id: cartaoEscolhido,
      descricao,
      category_id: categoria || null,
      data,
      n_parcelas: n,
      ...(modo === "parcela" ? { valor_parcela: valor } : { valor_total: valor }),
    };
    const r = NovoParcelamentoNoCartao.safeParse(pedido);
    if (!r.success) return setErro(r.error.issues[0]?.message ?? "Dados inválidos.");
    setEnviando(true);
    try {
      await criarParcelamento(pedido);
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
        <label className={cn(ROTULO, "col-span-2")}>
          Descrição
          <input
            className={CAMPO}
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Geladeira, curso, celular"
          />
        </label>
        <label className={ROTULO}>
          Cartão
          <select
            className={CAMPO}
            value={cartaoEscolhido}
            onChange={(e) => setCartao(e.target.value)}
          >
            {cartoes
              .filter((c) => !c.arquivado)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
          </select>
        </label>
        <label className={ROTULO}>
          Data da compra
          <input
            type="date"
            className={CAMPO}
            value={data}
            onChange={(e) => setData(e.target.value)}
          />
        </label>
        <label className={ROTULO}>
          Parcelas
          <input
            className={cn(CAMPO, "font-mono")}
            inputMode="numeric"
            value={n}
            onChange={(e) => setN(e.target.value)}
            placeholder="10"
          />
        </label>
        <label className={ROTULO}>
          Valor informado
          <select
            className={CAMPO}
            value={modo}
            onChange={(e) => setModo(e.target.value as "parcela" | "total")}
          >
            <option value="parcela">De cada parcela</option>
            <option value="total">Total da compra</option>
          </select>
        </label>
        <label className={ROTULO}>
          {modo === "parcela" ? "Valor da parcela (R$)" : "Valor total (R$)"}
          <input
            className={cn(CAMPO, "font-mono")}
            inputMode="decimal"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            placeholder="0,00"
          />
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
              .filter((c) => c.natureza === "despesa" && !c.arquivada)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
          </select>
        </label>
      </div>
      <p className="m-0 text-xs text-text-3">
        Cada parcela entra numa fatura, pelo ciclo do cartão. Ao importar a fatura, a
        parcela do arquivo concilia com a prevista.
      </p>
      {erro && (
        <p role="alert" className="m-0 text-sm text-down">
          {erro}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={enviando}>
        Lançar compra parcelada
      </Button>
    </form>
  );
}

export function PaginaDeParcelamentos() {
  const cliente = useQueryClient();
  const { data: planos, isPending } = usePlanos();
  const { data: comprometido = [] } = useComprometido();
  const { data: cartoes = [] } = useCartoes();
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const atualizar = () => void cliente.invalidateQueries({ queryKey: CHAVE });
  // /financas/parcelamentos?nova=1 vem do botao da tela de lancamentos.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("nova")) setAberto(true);
  }, []);
  const doCartao = (planos ?? []).filter((p) => p.origem === "cartao");
  const nomeDoCartao = new Map(cartoes.map((c) => [c.id, c.nome]));
  const restante = doCartao
    .filter((p) => p.ativo)
    .reduce((s, p) => s + Number(p.valor_restante), 0)
    .toFixed(2);
  const proximo = comprometido.find((m) => Number(m.total) > 0);

  const agir = (fn: () => Promise<unknown>) => {
    setErro(null);
    fn()
      .then(atualizar)
      .catch((f: Error) => setErro(f.message));
  };

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-[26px] font-bold tracking-tight">Parcelamentos</h1>
        <Button
          variant="primary"
          onClick={() => setAberto(true)}
          disabled={cartoes.length === 0}
        >
          <Plus aria-hidden="true" size={16} />
          Compra parcelada
        </Button>
      </header>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile
          label="A pagar em parcelas"
          value={<Money value={restante} />}
          subtitle="cartão"
        />
        <StatTile
          label="Próximo mês com parcelas"
          value={proximo ? <Money value={proximo.total} /> : "-"}
          subtitle={proximo?.mes.split("-").reverse().join("/")}
        />
        <StatTile
          label="Planos ativos"
          value={(planos ?? []).filter((p) => p.ativo).length}
        />
      </div>
      <Card title="Comprometido por mês (12 meses)">
        {comprometido.every((m) => Number(m.total) === 0) ? (
          <p className="m-0 text-sm text-text-3">Nenhuma parcela futura.</p>
        ) : (
          <GraficoDeParcelas meses={comprometido} />
        )}
      </Card>
      {erro && (
        <p role="alert" className="m-0 text-sm text-down">
          {erro}
        </p>
      )}
      <Card title="Compras parceladas">
        {isPending ? (
          <Skeleton className="h-24" />
        ) : doCartao.length === 0 ? (
          <EmptyState
            title="Nenhuma compra parcelada"
            description="Lance a compra em parcelas ou importe a fatura: a parcela do arquivo cria o plano sozinha."
          />
        ) : (
          <ul aria-label="Compras parceladas" className="m-0 flex list-none flex-col p-0">
            {doCartao.map((p: Plano) => {
              const pagas = p.parcelas_pagas;
              return (
                <li
                  key={p.id}
                  className={cn(
                    "flex flex-col gap-2 border-b border-border py-3 last:border-0",
                    !p.ativo && "opacity-60",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="font-semibold">{p.descricao}</span>
                      <span className="text-xs text-text-3">
                        {nomeDoCartao.get(p.card_id ?? "")} · {pagas}/{p.n_parcelas} pagas
                        {p.proxima
                          ? ` · próxima ${dataBr(p.proxima.data)}`
                          : " · quitado"}
                      </span>
                    </span>
                    <span className="flex flex-col items-end">
                      <Money value={p.valor_restante} className="font-semibold" />
                      <span className="text-xs text-text-3">
                        de <Money value={p.valor_total} />
                      </span>
                    </span>
                    <span className="flex gap-1">
                      {p.ativo && p.parcelas_restantes > 0 && (
                        <Button
                          variant="ghost"
                          className="px-2"
                          onClick={() => {
                            if (
                              window.confirm(
                                `Antecipar as ${p.parcelas_restantes} parcelas de ${p.descricao} para a fatura atual?`,
                              )
                            )
                              agir(() => quitarPlano(p.id, hojeEmSp()));
                          }}
                        >
                          Quitar
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        className="px-2"
                        aria-label={`Apagar ${p.descricao}`}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Apagar ${p.descricao} e as parcelas previstas?`,
                            )
                          )
                            agir(() => apagarPlano(p.id));
                        }}
                      >
                        <Trash aria-hidden="true" size={16} />
                      </Button>
                    </span>
                  </div>
                  <Barra
                    valor={pagas}
                    total={p.n_parcelas}
                    rotulo={`${p.descricao}: parcelas pagas`}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <Sheet open={aberto} onOpenChange={setAberto} title="Compra parcelada">
        {aberto && (
          <FormularioDeParcelamento
            onSalvo={() => {
              setAberto(false);
              atualizar();
            }}
          />
        )}
      </Sheet>
    </div>
  );
}
