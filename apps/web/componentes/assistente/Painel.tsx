"use client";

import { useChat } from "@ai-sdk/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DefaultChatTransport, type UIMessage } from "ai";
import { History, Plus, Send, Square, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AVISO_EDUCACIONAL, type ModuloDoAssistente } from "@bolsiq/assistant/puro";
import { Button, moduloDaRota, Sheet, Skeleton } from "@bolsiq/ui";
import { contextoDaTela } from "@/lib/assistente-modelo";
import { useConta } from "../conta/Conta";
import {
  apagarConversa,
  CHAVES_DO_ASSISTENTE as CHAVES,
  consentir,
  lerConversa,
  lerEstado,
  listarConversas,
} from "./cliente";
import { Mensagem } from "./Mensagem";

const SUGESTOES: Record<ModuloDoAssistente, string[]> = {
  investimentos: [
    "Avalie minha carteira",
    "Onde aportar R$ 1.000 este mês?",
    "Compare PETR4 e PRIO3",
    "Quais ações passam no critério de Graham hoje?",
  ],
  financas: [
    "Como está o meu mês?",
    "Onde corto R$ 500 por mês?",
    "Posso comprar algo de R$ 3.000 em 10x?",
    "Quanto posso investir por mês?",
  ],
  painel: [
    "Quanto posso investir este mês e onde?",
    "Como está o meu mês?",
    "Avalie minha carteira",
  ],
};

const DICA: Record<ModuloDoAssistente, string> = {
  investimentos: "Pergunte sobre um ativo ou a sua carteira",
  financas: "Pergunte sobre seus gastos, parcelas ou orçamento",
  painel: "Pergunte sobre suas finanças ou a sua carteira",
};

type MensagemDoChat = UIMessage<{ conversa_id?: string; modulo?: ModuloDoAssistente }>;

/** Erro do BFF chega como texto JSON; o que interessa e a mensagem. */
function textoDoErro(e: Error): string {
  try {
    const c = JSON.parse(e.message) as { error?: { message?: string } };
    return c.error?.message ?? e.message;
  } catch {
    return e.message;
  }
}

function Consentimento({
  provedor,
  escopo,
}: {
  provedor: string | null;
  escopo: "investimentos" | "financas";
}) {
  const cliente = useQueryClient();
  const aceitar = useMutation({
    mutationFn: () => consentir(escopo),
    onSuccess: (e) => cliente.setQueryData(CHAVES.estado, e),
  });
  const para = provedor ? ` (${provedor})` : "";
  return (
    <section
      aria-label="Consentimento"
      className="flex flex-col gap-3 text-sm text-text-2"
    >
      {escopo === "financas" ? (
        <p className="m-0">
          No Bolsiq Finanças, o assistente envia ao provedor escolhido{para} sua pergunta
          e os dados financeiros que consulta: lançamentos (data, descrição, valor,
          categoria e conta ou cartão), resumo do mês, orçamento, saldos e fluxo
          projetado, parcelas, assinaturas e insights. Nomes de pessoas em PIX e
          transferências saem como [pessoa] antes do envio.
        </p>
      ) : (
        <p className="m-0">
          Para responder, o assistente envia ao provedor escolhido{para} sua pergunta e os
          dados que consulta, o que inclui a sua carteira: posições, preço médio,
          resultado e o seu perfil de investidor.
        </p>
      )}
      <p className="m-0">
        O tratamento desses dados pelo provedor segue a política dele. O Bolsiq não vende
        nem compartilha com mais ninguém.
      </p>
      <Button
        variant="primary"
        disabled={aceitar.isPending}
        onClick={() => aceitar.mutate()}
      >
        Concordo, continuar
      </Button>
    </section>
  );
}

function Historico({
  modulo,
  aoAbrir,
  aoApagar,
}: {
  modulo: ModuloDoAssistente;
  aoAbrir: (id: string) => void;
  aoApagar: (id: string) => void;
}) {
  const cliente = useQueryClient();
  const { data } = useQuery({
    queryKey: [...CHAVES.conversas, modulo],
    queryFn: () => listarConversas(modulo),
  });
  const apagar = useMutation({
    mutationFn: apagarConversa,
    onSuccess: (_r, id) => {
      aoApagar(id);
      void cliente.invalidateQueries({ queryKey: CHAVES.conversas });
    },
  });
  if (!data) return <Skeleton className="h-40" />;
  if (data.length === 0)
    return <p className="m-0 text-sm text-text-3">Nenhuma conversa ainda.</p>;
  return (
    <ul aria-label="Conversas" className="m-0 flex list-none flex-col gap-1 p-0">
      {data.map((c) => (
        <li key={c.id} className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => aoAbrir(c.id)}
            className="flex min-h-touch min-w-0 flex-1 items-center truncate rounded-item px-2 text-left text-sm text-text hover:bg-surface-2"
          >
            <span className="truncate">{c.titulo}</span>
          </button>
          <button
            type="button"
            aria-label={`Apagar conversa ${c.titulo}`}
            onClick={() => apagar.mutate(c.id)}
            className="flex size-touch shrink-0 items-center justify-center text-text-3 hover:text-down"
          >
            <Trash2 aria-hidden="true" size={16} />
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * "Pergunte ao Bolsiq": lateral no desktop, tela cheia no celular. Fica montado
 * depois da primeira abertura, para fechar o painel nao perder a conversa.
 */
export default function PainelDoAssistente({
  aberto,
  aoMudar,
}: {
  aberto: boolean;
  aoMudar: (aberto: boolean) => void;
}) {
  const caminho = usePathname();
  const modulo = moduloDaRota(caminho);
  const { uid } = useConta();
  const cliente = useQueryClient();
  const conversa = useRef<string | undefined>(undefined);
  // Cada conversa fica no modulo em que comecou (ADR 0036).
  const moduloDaConversa = useRef<ModuloDoAssistente>(modulo);
  const caminhoAtual = useRef(caminho);
  caminhoAtual.current = caminho;
  const fim = useRef<HTMLDivElement>(null);
  const [texto, setTexto] = useState("");
  const [vendoHistorico, setVendoHistorico] = useState(false);

  const { data: estado } = useQuery({
    queryKey: CHAVES.estado,
    queryFn: lerEstado,
    enabled: Boolean(uid) && aberto,
  });

  const transporte = useMemo(
    () =>
      new DefaultChatTransport<MensagemDoChat>({
        api: "/api/assistente/chat",
        // So o texto novo: o historico o servidor le do banco.
        prepareSendMessagesRequest: ({ messages }) => {
          const ultima = messages.at(-1);
          return {
            body: {
              conversa_id: conversa.current,
              texto:
                ultima?.parts.map((p) => (p.type === "text" ? p.text : "")).join("") ??
                "",
              contexto: contextoDaTela(caminhoAtual.current, window.location.search),
            },
          };
        },
      }),
    [],
  );

  const { messages, setMessages, sendMessage, status, stop, error, clearError } =
    useChat<MensagemDoChat>({
      transport: transporte,
      onFinish: () => {
        void cliente.invalidateQueries({ queryKey: CHAVES.conversas });
        void cliente.invalidateQueries({ queryKey: CHAVES.estado });
      },
    });

  const ocupado = status === "submitted" || status === "streaming";

  useEffect(() => {
    const id = messages.findLast((m) => m.metadata?.conversa_id)?.metadata?.conversa_id;
    if (id) conversa.current = id;
    fim.current?.scrollIntoView?.({ block: "end" });
  }, [messages]);

  const novaConversa = () => {
    conversa.current = undefined;
    moduloDaConversa.current = modulo;
    setMessages([]);
    clearError();
    setVendoHistorico(false);
  };

  // Trocou de modulo com uma conversa aberta: a proxima pergunta abre outra,
  // com o prompt e as ferramentas do modulo novo.
  useEffect(() => {
    if (moduloDaConversa.current !== modulo && !ocupado) novaConversa();
  }, [modulo]);

  const abrirConversa = async (id: string) => {
    const c = await lerConversa(id);
    conversa.current = id;
    moduloDaConversa.current = modulo;
    setMessages(c.mensagens as MensagemDoChat[]);
    clearError();
    setVendoHistorico(false);
  };

  const enviar = (t: string) => {
    const limpo = t.trim();
    if (!limpo || ocupado) return;
    setTexto("");
    clearError();
    void sendMessage({ text: limpo });
  };

  const aoEnviar = (e: FormEvent) => {
    e.preventDefault();
    enviar(texto);
  };

  // No celular o painel cobre a tela: ao seguir um link, ele sai da frente.
  const aoNavegar = () => {
    if (window.matchMedia("(max-width: 767px)").matches) aoMudar(false);
  };

  const precisa: ("investimentos" | "financas")[] = estado
    ? [
        ...(modulo !== "financas" && !estado.consentiu
          ? (["investimentos"] as const)
          : []),
        ...(modulo !== "investimentos" && !estado.consentiu_financas
          ? (["financas"] as const)
          : []),
      ]
    : [];
  const conversaLiberada =
    estado && precisa.length === 0 && (estado.configurado || estado.plataforma);

  return (
    <Sheet
      open={aberto}
      onOpenChange={aoMudar}
      title="Pergunte ao Bolsiq"
      fullscreenOnMobile
    >
      {!uid ? (
        <p className="m-0 text-sm text-text-2">
          <Link href="/entrar" onClick={() => aoMudar(false)}>
            Entre na sua conta
          </Link>{" "}
          para conversar com o assistente.
        </p>
      ) : !estado ? (
        <Skeleton className="h-40" />
      ) : !estado.configurado && !estado.plataforma ? (
        <p className="m-0 text-sm text-text-2">
          O assistente usa a sua chave de um provedor de IA.{" "}
          <Link href="/configuracoes/assistente" onClick={() => aoMudar(false)}>
            Configure o provedor
          </Link>{" "}
          para começar.
        </p>
      ) : precisa[0] ? (
        <Consentimento provedor={estado.provedor} escopo={precisa[0]} />
      ) : null}

      {conversaLiberada && (
        <>
          <div className="flex items-center gap-2">
            <Button onClick={novaConversa} className="px-3">
              <Plus aria-hidden="true" size={16} /> Nova
            </Button>
            <Button
              onClick={() => setVendoHistorico((v) => !v)}
              aria-pressed={vendoHistorico}
              className="px-3"
            >
              <History aria-hidden="true" size={16} /> Histórico
            </Button>
            <Link
              href="/configuracoes/assistente"
              onClick={() => aoMudar(false)}
              className="ml-auto text-sm"
            >
              Configurações
            </Link>
          </div>

          {estado.modo === "educational" && (
            <p
              role="note"
              className="m-0 rounded-item bg-warn-bg px-3 py-2 text-[13px] text-warn"
            >
              {AVISO_EDUCACIONAL}
            </p>
          )}
          {estado.aviso_modelo && (
            <p role="note" className="m-0 text-xs text-text-3">
              {estado.aviso_modelo}
            </p>
          )}

          {vendoHistorico ? (
            <Historico
              modulo={modulo}
              aoAbrir={(id) => void abrirConversa(id)}
              aoApagar={(id) => {
                if (conversa.current === id) novaConversa();
                setVendoHistorico(true);
              }}
            />
          ) : (
            <div
              aria-live="polite"
              className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto"
            >
              {messages.length === 0 && (
                <>
                  {modulo !== "financas" && !estado.perfil_preenchido && (
                    <p className="m-0 text-[13px] text-text-3">
                      Para avaliar a carteira e sugerir aportes, preencha o{" "}
                      <Link href="/configuracoes/perfil" onClick={() => aoMudar(false)}>
                        perfil do investidor
                      </Link>
                      .
                    </p>
                  )}
                  <ul
                    aria-label="Sugestões"
                    className="m-0 flex list-none flex-col gap-2 p-0"
                  >
                    {SUGESTOES[modulo].map((s) => (
                      <li key={s}>
                        <Button
                          className="h-auto min-h-touch w-full justify-start py-2 text-left"
                          onClick={() => enviar(s)}
                        >
                          {s}
                        </Button>
                      </li>
                    ))}
                  </ul>
                  {modulo !== "financas" && (
                    <p className="m-0 text-xs text-text-3">
                      Sem acesso a notícias nem a fatos relevantes.
                    </p>
                  )}
                </>
              )}
              {messages.map((m) => (
                <Mensagem key={m.id} mensagem={m} aoNavegar={aoNavegar} />
              ))}
              {status === "submitted" && (
                <Skeleton className="h-6 w-1/2" aria-label="Pensando" />
              )}
              {error && (
                <p role="alert" className="m-0 text-sm text-down">
                  {textoDoErro(error)}
                </p>
              )}
              <div ref={fim} />
            </div>
          )}

          <form onSubmit={aoEnviar} className="mt-auto flex items-end gap-2">
            <label className="sr-only" htmlFor="pergunta-ao-bolsiq">
              Sua pergunta
            </label>
            <textarea
              id="pergunta-ao-bolsiq"
              rows={2}
              maxLength={4000}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  enviar(texto);
                }
              }}
              placeholder={DICA[modulo]}
              className="min-w-0 flex-1 resize-none rounded-control border border-border-strong bg-sidebar px-3 py-2 text-sm text-text placeholder:text-text-3"
            />
            {ocupado ? (
              <Button aria-label="Parar" onClick={() => void stop()} className="px-3">
                <Square aria-hidden="true" size={16} />
              </Button>
            ) : (
              <Button
                variant="primary"
                type="submit"
                aria-label="Enviar"
                className="px-3"
              >
                <Send aria-hidden="true" size={16} />
              </Button>
            )}
          </form>
        </>
      )}
    </Sheet>
  );
}
