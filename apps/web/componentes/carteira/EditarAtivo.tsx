"use client";

import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Button, cn, formatarDinheiro, formatarNumero } from "@bolsiq/ui";
import type { PosicaoDeExtrato, TransacaoNaTela } from "@/lib/carteira";
import {
  EdicaoDePosicao,
  SEM_PRECO,
  TIPOS_DE_TRANSACAO,
  dataCompleta,
  paraCampo,
  type PosicaoDigitada,
  type TipoNaTela,
} from "@/lib/carteira-modelo";
import { CAMPO } from "../conta/campos";
import {
  chaveDasTransacoes,
  editarPosicao,
  excluirAtivo,
  excluirPosicao,
  excluirTransacao,
  lerTransacoes,
} from "./cliente";
import { FormularioDeTransacao } from "./NovaTransacao";

const ROTULO = "flex flex-col gap-1.5 text-xs text-text-3";
const ORIGEM = { manual: "lançada", importada: "importada", automatica: "automática" };
const rotuloDoTipo = (t: string) =>
  TIPOS_DE_TRANSACAO.find((x) => x.tipo === t)?.rotulo ?? t;

/** Excluir pede um segundo toque: sem modal por cima do sheet. */
function Excluir({
  rotulo,
  confirmacao,
  onExcluir,
}: {
  rotulo: string;
  confirmacao: string;
  onExcluir: () => Promise<void>;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  if (!confirmando)
    return (
      <Button variant="ghost" className="text-down" onClick={() => setConfirmando(true)}>
        {rotulo}
      </Button>
    );
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-text-2">{confirmacao}</span>
      <Button
        className="border-down text-down"
        disabled={enviando}
        onClick={() => {
          setEnviando(true);
          void onExcluir().finally(() => setEnviando(false));
        }}
      >
        Confirmar exclusão
      </Button>
      <Button variant="ghost" onClick={() => setConfirmando(false)}>
        Cancelar
      </Button>
    </div>
  );
}

/** Transacoes de um ticker, com editar e excluir; renda variavel nasce delas. */
export function TransacoesDoAtivo({
  carteira,
  ticker,
  onMudou,
  onAtivoExcluido,
}: {
  carteira: string;
  ticker: string;
  onMudou: () => void;
  onAtivoExcluido: () => void;
}) {
  const { data, refetch, error } = useQuery({
    queryKey: chaveDasTransacoes(carteira, ticker),
    queryFn: () => lerTransacoes(carteira, ticker),
  });
  const [editando, setEditando] = useState<TransacaoNaTela | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const mudou = () => {
    onMudou();
    void refetch();
  };

  if (editando)
    return (
      <div className="flex flex-col gap-3">
        <p className="m-0 text-sm text-text-2">
          Editando {rotuloDoTipo(editando.tipo).toLowerCase()} de{" "}
          {dataCompleta(editando.data)}
        </p>
        <FormularioDeTransacao
          carteira={carteira}
          inicial={editando}
          onSalva={() => {
            setEditando(null);
            mudou();
          }}
        />
        <Button variant="ghost" onClick={() => setEditando(null)}>
          Voltar à lista
        </Button>
      </div>
    );

  const falha = erro ?? error?.message ?? null;
  return (
    <div className="flex flex-col gap-4">
      {falha && (
        <p role="alert" className="m-0 text-sm text-down">
          {falha}
        </p>
      )}
      {!data ? (
        <p role="status" className="m-0 text-sm text-text-3">
          Carregando…
        </p>
      ) : data.length === 0 ? (
        <p className="m-0 text-sm text-text-3">Nenhuma transação deste ativo.</p>
      ) : (
        <ul
          aria-label={`Transações de ${ticker}`}
          className="m-0 flex list-none flex-col p-0"
        >
          {data.map((t) => (
            <li
              key={t.id}
              aria-label={`${rotuloDoTipo(t.tipo)} de ${dataCompleta(t.data)}`}
              className="flex flex-col gap-2 border-t border-border py-3 first:border-t-0"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold">
                  {rotuloDoTipo(t.tipo)}{" "}
                  <span className="font-normal text-text-3">{dataCompleta(t.data)}</span>
                </span>
                <span className="text-xs text-text-3">
                  {ORIGEM[t.origem]}
                  {t.corretora ? ` · ${t.corretora}` : ""}
                </span>
              </div>
              <span className="font-mono text-sm text-text-2 tabular-nums">
                {SEM_PRECO.includes(t.tipo as TipoNaTela)
                  ? `fator ${formatarNumero(t.quantidade, Number(t.quantidade) % 1 ? 4 : 0)}`
                  : `${formatarNumero(t.quantidade, Number(t.quantidade) % 1 ? 4 : 0)} x ${formatarDinheiro(t.preco)}`}
                {Number(t.taxas) > 0 ? ` + ${formatarDinheiro(t.taxas)} de taxas` : ""}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => setEditando(t)}>Editar</Button>
                <Excluir
                  rotulo="Excluir"
                  confirmacao="Excluir esta transação?"
                  onExcluir={async () => {
                    setErro(null);
                    try {
                      await excluirTransacao(carteira, t.id);
                      mudou();
                    } catch (e) {
                      setErro((e as Error).message);
                    }
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      {data && data.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <p className="m-0 text-xs text-text-3">
            Excluir o ativo apaga as {data.length} transações dele nesta carteira. A
            rentabilidade é recalculada.
          </p>
          <Excluir
            rotulo={`Excluir ${ticker} da carteira`}
            confirmacao={`Apagar ${data.length} transações?`}
            onExcluir={async () => {
              setErro(null);
              try {
                await excluirAtivo(carteira, ticker);
                onMudou();
                onAtivoExcluido();
              } catch (e) {
                setErro((e as Error).message);
              }
            }}
          />
        </div>
      )}
    </div>
  );
}

/** Corrige ou exclui uma posicao de extrato (renda fixa, fundo, previdencia, COE). */
export function EditarPosicao({
  carteira,
  posicao,
  onMudou,
}: {
  carteira: string;
  posicao: PosicaoDeExtrato;
  onMudou: () => void;
}) {
  const [campos, setCampos] = useState<PosicaoDigitada>({
    ativo: posicao.ativo,
    saldo_bruto: paraCampo(posicao.saldo_bruto),
    valor_aplicado: paraCampo(posicao.valor_aplicado),
    saldo_liquido: paraCampo(posicao.saldo_liquido),
    vencimento: posicao.vencimento ?? "",
    indexador: posicao.indexador ?? "",
    pct_indexador: paraCampo(posicao.pct_indexador, true),
    taxa_aa: paraCampo(posicao.taxa_aa, true),
  });
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const campo = (k: keyof PosicaoDigitada) => ({
    value: campos[k],
    onChange: (e: { target: { value: string } }) =>
      setCampos((c) => ({ ...c, [k]: e.target.value })),
  });

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const r = EdicaoDePosicao.safeParse(campos);
    if (!r.success) return setErro(r.error.issues[0]?.message ?? "Dados inválidos.");
    setEnviando(true);
    try {
      await editarPosicao(carteira, posicao.id, campos);
      onMudou();
    } catch (falha) {
      setErro((falha as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  const numero = cn(CAMPO, "font-mono");
  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={(e) => void salvar(e)} className="flex flex-col gap-3" noValidate>
        <label className={ROTULO}>
          Ativo
          <input className={CAMPO} {...campo("ativo")} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className={ROTULO}>
            Saldo bruto (R$)
            <input className={numero} inputMode="decimal" {...campo("saldo_bruto")} />
          </label>
          <label className={ROTULO}>
            Saldo líquido (R$)
            <input className={numero} inputMode="decimal" {...campo("saldo_liquido")} />
          </label>
          <label className={ROTULO}>
            Valor aplicado (R$)
            <input className={numero} inputMode="decimal" {...campo("valor_aplicado")} />
          </label>
          <label className={ROTULO}>
            Vencimento
            <input type="date" className={CAMPO} {...campo("vencimento")} />
          </label>
          <label className={ROTULO}>
            Indexador
            <input
              className={CAMPO}
              placeholder="CDI, IPCA, PRE"
              autoComplete="off"
              {...campo("indexador")}
            />
          </label>
          <label className={ROTULO}>
            % do indexador
            <input
              className={numero}
              inputMode="decimal"
              placeholder="120"
              {...campo("pct_indexador")}
            />
          </label>
          <label className={ROTULO}>
            Taxa ao ano (%)
            <input
              className={numero}
              inputMode="decimal"
              placeholder="7,95"
              {...campo("taxa_aa")}
            />
          </label>
        </div>
        {erro && (
          <p role="alert" className="m-0 text-sm text-down">
            {erro}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={enviando}>
          Salvar alterações
        </Button>
      </form>
      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <p className="m-0 text-xs text-text-3">
          A próxima carga de {posicao.corretora} substitui estes valores.
        </p>
        <Excluir
          rotulo="Excluir posição"
          confirmacao="Excluir esta posição?"
          onExcluir={async () => {
            setErro(null);
            try {
              await excluirPosicao(carteira, posicao.id);
              onMudou();
            } catch (e) {
              setErro((e as Error).message);
            }
          }}
        />
      </div>
    </div>
  );
}
