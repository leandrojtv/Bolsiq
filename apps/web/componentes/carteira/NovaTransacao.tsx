"use client";

import { useState, type FormEvent } from "react";
import { Button, cn } from "@bolsiq/ui";
import {
  NovaTransacao,
  SEM_PRECO,
  TIPOS_DE_TRANSACAO,
  type TipoNaTela,
} from "@/lib/carteira-modelo";
import { hojeEmSp } from "@/lib/indicadores-tecnicos";
import { CAMPO } from "../conta/campos";
import { adicionarTransacao } from "./cliente";

const ROTULO = "flex flex-col gap-1.5 text-xs text-text-3";

/** Formulario rapido de transacao; abre num sheet (embaixo no celular). */
export function FormularioDeTransacao({
  carteira,
  onSalva,
}: {
  carteira: string;
  onSalva: () => void;
}) {
  const [ticker, setTicker] = useState("");
  const [tipo, setTipo] = useState<TipoNaTela>("compra");
  const [data, setData] = useState(hojeEmSp());
  const [quantidade, setQuantidade] = useState("");
  const [preco, setPreco] = useState("");
  const [taxas, setTaxas] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const semPreco = SEM_PRECO.includes(tipo);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const r = NovaTransacao.safeParse({
      ticker,
      tipo,
      data,
      quantidade,
      preco: semPreco ? "0" : preco,
      taxas: taxas || "0",
    });
    if (!r.success) return setErro(r.error.issues[0]?.message ?? "Dados inválidos.");
    setEnviando(true);
    try {
      await adicionarTransacao(carteira, r.data);
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
        Salvar transação
      </Button>
    </form>
  );
}
