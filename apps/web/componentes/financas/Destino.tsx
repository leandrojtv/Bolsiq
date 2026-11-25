"use client";

import { useState } from "react";
import type { AnaliseDeImportacao } from "@bolsiq/finance/puro";
import { CAMPO } from "../conta/campos";
import { dataBr } from "./Cartoes";
import { useCartoes, useContas, useFaturas } from "./cliente";
import { ROTULO } from "./Contas";

type Sugestao = AnaliseDeImportacao["sugestao"];

/** Destino escolhido: conta, ou cartao e fatura. */
export function useDestino() {
  const [alvo, setAlvo] = useState<"conta" | "cartao">("conta");
  const [conta, setConta] = useState("");
  const [cartao, setCartao] = useState("");
  const [vencimento, setVencimento] = useState("");
  return {
    alvo,
    setAlvo,
    conta,
    setConta,
    cartao,
    setCartao,
    vencimento,
    setVencimento,
    sugerir: (s: Sugestao) => {
      if (s.alvo) setAlvo(s.alvo);
      setConta(s.account_id ?? "");
      setCartao(s.card_id ?? "");
      setVencimento(s.vencimento ?? "");
    },
    completo: alvo === "conta" ? Boolean(conta) : Boolean(cartao && vencimento),
    pedido: () =>
      alvo === "conta"
        ? { alvo, account_id: conta }
        : { alvo, card_id: cartao, vencimento },
  };
}
export type Destino = ReturnType<typeof useDestino>;

/** Conta, ou cartao e fatura, com a sugestao da leitura marcada. */
export function SeletorDeDestino({ d, sugestao }: { d: Destino; sugestao: Sugestao }) {
  const { data: contas = [] } = useContas();
  const { data: cartoes = [] } = useCartoes();
  const { data: faturas = [] } = useFaturas(d.alvo === "cartao" ? d.cartao : "");
  // A lista cobre os ciclos ao redor de hoje; extrato antigo sugere fatura fora dela.
  const sugerida = sugestao.card_id === d.cartao ? sugestao.vencimento : null;
  const opcoesDeFatura = [
    ...faturas,
    ...(sugerida && !faturas.some((f) => f.vencimento === sugerida)
      ? [{ vencimento: sugerida }]
      : []),
  ].sort((a, b) => b.vencimento.localeCompare(a.vencimento));

  return (
    <>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <label className={ROTULO}>
          Destino
          <select
            className={CAMPO}
            value={d.alvo}
            onChange={(e) => d.setAlvo(e.target.value as "conta" | "cartao")}
          >
            <option value="conta">Conta</option>
            <option value="cartao">Cartão de crédito</option>
          </select>
        </label>
        {d.alvo === "conta" ? (
          <label className={ROTULO}>
            Conta
            <select
              className={CAMPO}
              value={d.conta}
              onChange={(e) => d.setConta(e.target.value)}
            >
              <option value="">Escolha</option>
              {contas
                .filter((c) => !c.arquivada)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
            </select>
          </label>
        ) : (
          <>
            <label className={ROTULO}>
              Cartão
              <select
                className={CAMPO}
                value={d.cartao}
                onChange={(e) => d.setCartao(e.target.value)}
              >
                <option value="">Escolha</option>
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
              Fatura (vencimento)
              <select
                className={CAMPO}
                value={d.vencimento}
                onChange={(e) => d.setVencimento(e.target.value)}
              >
                <option value="">Escolha</option>
                {opcoesDeFatura.map((f) => (
                  <option key={f.vencimento} value={f.vencimento}>
                    {dataBr(f.vencimento)}
                    {f.vencimento === sugestao.vencimento ? " (sugerida)" : ""}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>
      {d.alvo === "cartao" && cartoes.length === 0 && (
        <p className="m-0 text-sm text-text-2">
          Cadastre o cartão antes, em <a href="/financas/cartoes">Cartões</a>.
        </p>
      )}
    </>
  );
}
