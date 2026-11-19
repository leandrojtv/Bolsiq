"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash } from "lucide-react";
import { useState, type FormEvent } from "react";
import { MODOS_DE_REGRA, NovaRegra, type Regra } from "@bolsiq/finance/puro";
import { Button, Card, EmptyState, Sheet, Skeleton, cn } from "@bolsiq/ui";
import { CAMPO } from "../conta/campos";
import {
  apagarRegra,
  CHAVE,
  criarRegra,
  editarRegra,
  useCategorias,
  useRegras,
} from "./cliente";
import { ROTULO } from "./Contas";

const MODO = { contem: "Contém", comeca_com: "Começa com", regex: "Expressão regular" };

function FormularioDeRegra({
  inicial,
  onSalva,
}: {
  inicial?: Regra;
  onSalva: () => void;
}) {
  const { data: categorias = [] } = useCategorias();
  const [padrao, setPadrao] = useState(inicial?.padrao ?? "");
  const [modo, setModo] = useState<string>(inicial?.modo ?? "contem");
  const [categoria, setCategoria] = useState(inicial?.category_id ?? "");
  const [prioridade, setPrioridade] = useState(String(inicial?.prioridade ?? 100));
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const digitada = { padrao, modo, category_id: categoria, prioridade };
    const r = NovaRegra.safeParse(digitada);
    if (!r.success) return setErro(r.error.issues[0]?.message ?? "Dados inválidos.");
    setEnviando(true);
    try {
      await (inicial ? editarRegra(inicial.id, digitada) : criarRegra(digitada));
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
        Quando a descrição
        <select className={CAMPO} value={modo} onChange={(e) => setModo(e.target.value)}>
          {MODOS_DE_REGRA.map((m) => (
            <option key={m} value={m}>
              {MODO[m]}
            </option>
          ))}
        </select>
      </label>
      <label className={ROTULO}>
        Texto
        <input
          className={cn(CAMPO, modo === "regex" && "font-mono")}
          value={padrao}
          onChange={(e) => setPadrao(e.target.value)}
          placeholder={modo === "regex" ? "^UBER" : "padaria"}
          autoComplete="off"
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className={ROTULO}>
          Categoria
          <select
            className={CAMPO}
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
          >
            <option value="">Escolha</option>
            {categorias
              .filter((c) => !c.arquivada)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome} ({c.natureza})
                </option>
              ))}
          </select>
        </label>
        <label className={ROTULO}>
          Prioridade
          <input
            className={cn(CAMPO, "font-mono")}
            inputMode="numeric"
            value={prioridade}
            onChange={(e) => setPrioridade(e.target.value)}
          />
        </label>
      </div>
      <p className="m-0 text-xs text-text-3">
        A comparação ignora maiúsculas, acentos, prefixos de maquininha (PAG*, MP*) e a
        cidade no fim. Menor prioridade vem primeiro; suas regras sempre vêm antes das
        aprendidas.
      </p>
      {erro && (
        <p role="alert" className="m-0 text-sm text-down">
          {erro}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={enviando}>
        {inicial ? "Salvar alterações" : "Criar regra"}
      </Button>
    </form>
  );
}

export function PaginaDeRegras() {
  const cliente = useQueryClient();
  const { data: regras, isPending } = useRegras();
  const { data: categorias = [] } = useCategorias();
  const [aberta, setAberta] = useState<Regra | "nova" | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const nome = new Map(categorias.map((c) => [c.id, c.nome]));
  const atualizar = () => void cliente.invalidateQueries({ queryKey: CHAVE });

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-[26px] font-bold tracking-tight">Regras</h1>
        <Button variant="primary" onClick={() => setAberta("nova")}>
          <Plus aria-hidden="true" size={16} />
          Nova regra
        </Button>
      </header>
      {erro && (
        <p role="alert" className="m-0 text-sm text-down">
          {erro}
        </p>
      )}
      <Card>
        {isPending ? (
          <Skeleton className="h-24" />
        ) : !regras?.length ? (
          <EmptyState
            title="Nenhuma regra ainda"
            description="Crie uma aqui ou na revisão da importação, ao corrigir uma categoria. As correções também viram regras aprendidas."
          />
        ) : (
          <ul aria-label="Regras" className="m-0 flex list-none flex-col p-0">
            {regras.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center gap-3 border-b border-border py-3 last:border-0"
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="font-semibold break-words">
                    <span className="font-normal text-text-3">{MODO[r.modo]} </span>
                    <span className={cn(r.modo === "regex" && "font-mono")}>
                      {r.padrao}
                    </span>
                    <span className="font-normal text-text-3"> → </span>
                    {nome.get(r.category_id)}
                  </span>
                  <span className="text-xs text-text-3">
                    {r.origem === "aprendida" ? "Aprendida" : "Sua"} · prioridade{" "}
                    {r.prioridade} · usada {r.vezes_aplicada}{" "}
                    {r.vezes_aplicada === 1 ? "vez" : "vezes"}
                  </span>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    aria-label={`Editar regra ${r.padrao}`}
                    onClick={() => setAberta(r)}
                  >
                    <Pencil aria-hidden="true" size={16} />
                  </Button>
                  <Button
                    variant="ghost"
                    aria-label={`Apagar regra ${r.padrao}`}
                    onClick={() => {
                      if (!window.confirm(`Apagar a regra "${r.padrao}"?`)) return;
                      setErro(null);
                      apagarRegra(r.id)
                        .then(atualizar)
                        .catch((falha: Error) => setErro(falha.message));
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
        title={aberta === "nova" || aberta === null ? "Nova regra" : "Editar regra"}
      >
        {aberta !== null && (
          <FormularioDeRegra
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
