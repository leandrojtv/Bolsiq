"use client";

import { useState, type FormEvent } from "react";
import { Button, cn } from "@bolsiq/ui";
import type { TransacaoNaTela } from "@/lib/carteira";
import {
  NovaTransacao,
  SEM_PRECO,
  TIPOS_DE_TRANSACAO,
  paraCampo,
  type TipoNaTela,
} from "@/lib/carteira-modelo";
import { hojeEmSp } from "@/lib/indicadores-tecnicos";
import { CAMPO } from "../conta/campos";
import { adicionarTransacao, editarTransacao } from "./cliente";

const ROTULO = "flex flex-col gap-1.5 text-xs text-text-3";

/**
 * Formulario rapido de transacao; abre num sheet (embaixo no celular). Com
 * `inicial`, edita a transacao em vez de criar outra.
 */
export function FormularioDeTransacao({
  carteira,
  inicial,
  onSalva,
}: {
  carteira: string;
  inicial?: TransacaoNaTela;
  onSalva: () => void;
}) {
  const [ticker, setTicker] = useState(inicial?.ticker ?? "");
  const [tipo, setTipo] = useState<TipoNaTela>(
    (inicial?.tipo as TipoNaTela | undefined) ?? "compra",
  );
  const [data, setData] = useState(inicial?.data ?? hojeEmSp());
  const [quantidade, setQuantidade] = useState(paraCampo(inicial?.quantidade ?? null));
  const [preco, setPreco] = useState(paraCampo(inicial?.preco ?? null));
  const [taxas, setTaxas] = useState(paraCampo(inicial?.taxas ?? null));
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const semPreco = SEM_PRECO.includes(tipo);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    // Vai o texto digitado: converter aqui e de novo no BFF leria "0.125" como 125.
    const digitada = {
      ticker,
      tipo,
      data,
      quantidade,
      preco: semPreco ? "0" : preco,
      taxas: taxas || "0",
    };
    const r = NovaTransacao.safeParse(digitada);
    if (!r.success) return setErro(r.error.issues[0]?.message ?? "Dados inválidos.");
    setEnviando(true);
    try {
      await (inicial
        ? editarTransacao(carteira, inicial.id, digitada)
        : adicionarTransacao(carteira, digitada));
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
          Ativo
          <input
            className={cn(CAMPO, "font-mono")}
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            placeholder="PETR4"
            autoComplete="off"
          />
        </label>
        <label className={ROTULO}>
          Tipo
          <select
            className={CAMPO}
            aria-label="Tipo"
            value={tipo}
            onChange={(e) => setTipo(e.target.value as TipoNaTela)}
          >
            {TIPOS_DE_TRANSACAO.map((t) => (
              <option key={t.tipo} value={t.tipo}>
                {t.rotulo}
              </option>
            ))}
          </select>
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
          {semPreco ? "Fator (1:2 é 2)" : "Quantidade"}
          <input
            className={cn(CAMPO, "font-mono")}
            inputMode="decimal"
            value={quantidade}
            onChange={(e) => setQuantidade(e.target.value)}
          />
        </label>
        <label className={ROTULO}>
          Preço (R$)
          <input
            className={cn(CAMPO, "font-mono")}
            inputMode="decimal"
            value={semPreco ? "" : preco}
            disabled={semPreco}
            placeholder={semPreco ? "não se aplica" : "0,00"}
            onChange={(e) => setPreco(e.target.value)}
          />
        </label>
        <label className={ROTULO}>
          Taxas (R$)
          <input
            className={cn(CAMPO, "font-mono")}
            inputMode="decimal"
            value={taxas}
            onChange={(e) => setTaxas(e.target.value)}
            placeholder="0,00"
          />
        </label>
      </div>
      {erro && (
        <p role="alert" className="m-0 text-sm text-down">
          {erro}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={enviando}>
        {inicial ? "Salvar alterações" : "Salvar transação"}
      </Button>
    </form>
  );
}
