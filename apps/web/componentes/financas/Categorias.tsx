"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Lock, Pencil, Plus, Trash } from "lucide-react";
import { useState, type FormEvent } from "react";
import { NovaCategoria, type Categoria, type Natureza } from "@bolsiq/finance/puro";
import { Button, Card, Sheet, Skeleton, cn } from "@bolsiq/ui";
import { CAMPO } from "../conta/campos";
import {
  apagarCategoria,
  CHAVE,
  criarCategoria,
  editarCategoria,
  useCategorias,
} from "./cliente";
import { ROTULO } from "./Contas";

function FormularioDeCategoria({
  categorias,
  inicial,
  onSalva,
}: {
  categorias: Categoria[];
  inicial?: Categoria;
  onSalva: () => void;
}) {
  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [natureza, setNatureza] = useState<Natureza>(inicial?.natureza ?? "despesa");
  const [tipoCusto, setTipoCusto] = useState(inicial?.tipo_custo ?? "variavel");
  const [essencial, setEssencial] = useState(inicial?.essencial ?? false);
  const [pai, setPai] = useState(inicial?.parent_id ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const maes = categorias.filter(
    (c) => c.parent_id === null && c.natureza === natureza && c.id !== inicial?.id,
  );

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const digitada = {
      nome,
      natureza,
      tipo_custo: tipoCusto,
      essencial,
      parent_id: pai || null,
    };
    const r = NovaCategoria.safeParse(digitada);
    if (!r.success) return setErro(r.error.issues[0]?.message ?? "Dados inválidos.");
    setEnviando(true);
    try {
      await (inicial ? editarCategoria(inicial.id, digitada) : criarCategoria(digitada));
      onSalva();
    } catch (falha) {
      setErro((falha as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={(e) => void salvar(e)} className="flex flex-col gap-3" noValidate>
      <label className={ROTULO}>
        Nome da categoria
        <input className={CAMPO} value={nome} onChange={(e) => setNome(e.target.value)} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className={ROTULO}>
          Natureza
          <select
            className={CAMPO}
            value={natureza}
            disabled={inicial?.sistema}
            onChange={(e) => {
              setNatureza(e.target.value as Natureza);
              setPai("");
            }}
          >
            <option value="despesa">Despesa</option>
            <option value="receita">Receita</option>
          </select>
        </label>
        <label className={ROTULO}>
          Custo
          <select
            className={CAMPO}
            value={tipoCusto}
            onChange={(e) => setTipoCusto(e.target.value as "fixo" | "variavel")}
          >
            <option value="variavel">Variável</option>
            <option value="fixo">Fixo</option>
          </select>
        </label>
        <label className={cn(ROTULO, "col-span-2")}>
          Dentro de
          <select className={CAMPO} value={pai} onChange={(e) => setPai(e.target.value)}>
            <option value="">Nenhuma (categoria principal)</option>
            {maes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm text-text-2">
        <input
          type="checkbox"
          checked={essencial}
          onChange={(e) => setEssencial(e.target.checked)}
        />
        Essencial
      </label>
      {erro && (
        <p role="alert" className="m-0 text-sm text-down">
          {erro}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={enviando}>
        {inicial ? "Salvar alterações" : "Criar categoria"}
      </Button>
    </form>
  );
}

export function PaginaDeCategorias() {
  const cliente = useQueryClient();
  const { data: categorias = [], isPending } = useCategorias();
  const [aberta, setAberta] = useState<Categoria | "nova" | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const atualizar = () => void cliente.invalidateQueries({ queryKey: CHAVE });

  async function agir(fn: () => Promise<unknown>) {
    setErro(null);
    try {
      await fn();
      atualizar();
    } catch (falha) {
      setErro((falha as Error).message);
    }
  }

  const linha = (c: Categoria, sub: boolean) => (
    <li
      key={c.id}
      className={cn(
        "flex items-center gap-3 border-b border-border py-2.5 last:border-0",
        sub && "pl-6",
        c.arquivada && "opacity-60",
      )}
    >
      <span
        aria-hidden="true"
        className="size-3 shrink-0 rounded-full bg-text-3"
        // Cor da categoria e dado do usuario, nao token do tema.
        style={c.cor ? { backgroundColor: c.cor } : undefined}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="font-medium">
          {c.nome}
          {c.sistema && (
            <Lock
              aria-label="Categoria do sistema"
              size={12}
              className="ml-1.5 inline text-text-3"
            />
          )}
        </span>
        <span className="text-xs text-text-3">
          {c.tipo_custo === "fixo" ? "Fixo" : "Variável"}
          {c.essencial ? " · essencial" : ""}
          {c.arquivada ? " · arquivada" : ""}
        </span>
      </div>
      <Button
        variant="ghost"
        aria-label={`Editar ${c.nome}`}
        onClick={() => setAberta(c)}
      >
        <Pencil aria-hidden="true" size={16} />
      </Button>
      <Button
        variant="ghost"
        aria-label={c.arquivada ? `Desarquivar ${c.nome}` : `Arquivar ${c.nome}`}
        onClick={() =>
          void agir(() => editarCategoria(c.id, { arquivada: !c.arquivada }))
        }
      >
        {c.arquivada ? (
          <ArchiveRestore aria-hidden="true" size={16} />
        ) : (
          <Archive aria-hidden="true" size={16} />
        )}
      </Button>
      {!c.sistema && (
        <Button
          variant="ghost"
          aria-label={`Apagar ${c.nome}`}
          onClick={() => {
            if (
              window.confirm(
                `Apagar a categoria ${c.nome}? Os lançamentos ficam sem categoria.`,
              )
            )
              void agir(() => apagarCategoria(c.id));
          }}
        >
          <Trash aria-hidden="true" size={16} />
        </Button>
      )}
    </li>
  );

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-[26px] font-bold tracking-tight">Categorias</h1>
        <Button variant="primary" onClick={() => setAberta("nova")}>
          <Plus aria-hidden="true" size={16} />
          Nova categoria
        </Button>
      </header>
      {erro && (
        <p role="alert" className="m-0 text-sm text-down">
          {erro}
        </p>
      )}
      {isPending ? (
        <Skeleton className="h-48" />
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          {(["despesa", "receita"] as const).map((n) => {
            const daNatureza = categorias.filter((c) => c.natureza === n);
            return (
              <Card key={n} title={n === "despesa" ? "Despesas" : "Receitas"}>
                <ul
                  aria-label={
                    n === "despesa" ? "Categorias de despesa" : "Categorias de receita"
                  }
                  className="m-0 list-none p-0"
                >
                  {daNatureza
                    .filter((c) => c.parent_id === null)
                    .flatMap((r) => [
                      linha(r, false),
                      ...daNatureza
                        .filter((f) => f.parent_id === r.id)
                        .map((f) => linha(f, true)),
                    ])}
                </ul>
              </Card>
            );
          })}
        </div>
      )}
      <Sheet
        open={aberta !== null}
        onOpenChange={(v) => !v && setAberta(null)}
        title={
          aberta === "nova" || aberta === null ? "Nova categoria" : "Editar categoria"
        }
      >
        {aberta !== null && (
          <FormularioDeCategoria
            categorias={categorias}
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
