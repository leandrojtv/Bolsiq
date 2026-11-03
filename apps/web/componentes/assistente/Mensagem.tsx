"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { Check, ChevronRight, LoaderCircle, TriangleAlert } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { rotuloDoPasso } from "@bolsiq/assistant/puro";
import { Button, cn } from "@bolsiq/ui";
import { comLinksDeTicker, linkPermitido } from "@/lib/assistente-modelo";
import { confirmarAlerta } from "./cliente";

/**
 * Texto do modelo em Markdown. So abre link interno das telas do Bolsiq: resposta
 * de modelo nao e fonte confiavel, e link externo seria um caminho de phishing.
 */
function componentes(aoNavegar: () => void): Components {
  return {
    a: ({ href, children }) =>
      linkPermitido(href) ? (
        <Link
          href={href as string}
          onClick={aoNavegar}
          className="font-mono text-link underline"
        >
          {children}
        </Link>
      ) : (
        <span>{children}</span>
      ),
    img: () => null,
    p: ({ children }) => <p className="m-0">{children}</p>,
    ul: ({ children }) => (
      <ul className="m-0 flex list-disc flex-col gap-1 pl-5">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="m-0 flex list-decimal flex-col gap-1 pl-5">{children}</ol>
    ),
    h1: ({ children }) => <h3 className="m-0 text-base font-semibold">{children}</h3>,
    h2: ({ children }) => <h3 className="m-0 text-base font-semibold">{children}</h3>,
    h3: ({ children }) => <h3 className="m-0 text-sm font-semibold">{children}</h3>,
    table: ({ children }) => (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">{children}</table>
      </div>
    ),
    th: ({ children }) => (
      <th className="border-b border-border px-2 py-1 text-left text-text-3">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="border-b border-border px-2 py-1 tabular-nums">{children}</td>
    ),
  };
}

function PassoDeFerramenta({
  nome,
  entrada,
  saida,
  estado,
}: {
  nome: string;
  entrada: Record<string, unknown> | undefined;
  saida: unknown;
  estado: string;
}) {
  const carregando = estado === "input-streaming" || estado === "input-available";
  const falhou =
    estado === "output-error" || Boolean((saida as { erro?: unknown } | undefined)?.erro);
  const rotulo = rotuloDoPasso(nome, entrada, saida);
  return (
    <details className="group rounded-item border border-border bg-sidebar text-[13px]">
      <summary className="flex min-h-touch cursor-pointer list-none items-center gap-2 px-3 text-text-2">
        {carregando ? (
          <LoaderCircle
            aria-hidden="true"
            size={14}
            className="animate-spin text-accent"
          />
        ) : falhou ? (
          <TriangleAlert aria-hidden="true" size={14} className="text-warn" />
        ) : (
          <Check aria-hidden="true" size={14} className="text-up" />
        )}
        <span className="min-w-0 flex-1 truncate">
          {rotulo}
          {carregando ? "..." : ""}
        </span>
        <ChevronRight
          aria-hidden="true"
          size={14}
          className="transition-transform group-open:rotate-90"
        />
      </summary>
      {!carregando && (
        <pre className="m-0 max-h-60 overflow-auto border-t border-border p-3 font-mono text-xs break-all whitespace-pre-wrap text-text-3">
          {JSON.stringify(saida ?? null, null, 2)}
        </pre>
      )}
    </details>
  );
}

interface PropostaDeAlerta {
  ticker: string;
  tipo: string;
  valor?: number;
}

/** O alerta so existe depois deste clique: a ferramenta nao grava nada. */
function ConfirmarAlerta({ proposta }: { proposta: PropostaDeAlerta }) {
  const [estado, setEstado] = useState<"proposta" | "enviando" | "criado" | "recusado">(
    "proposta",
  );
  const [erro, setErro] = useState<string | null>(null);
  const descricao = `${proposta.ticker}: ${proposta.tipo.replaceAll("_", " ")}${
    proposta.valor !== undefined ? ` ${proposta.valor}` : ""
  }`;
  return (
    <div
      role="group"
      aria-label="Confirmar alerta"
      className="flex flex-col gap-2 rounded-item border border-border-strong p-3 text-sm"
    >
      <span className="font-semibold">Criar alerta?</span>
      <span className="font-mono text-[13px] text-text-2">{descricao}</span>
      {estado === "criado" && (
        <span role="status" className="text-up">
          Alerta criado. Ele aparece em <Link href="/alertas">Alertas</Link>.
        </span>
      )}
      {estado === "recusado" && <span className="text-text-3">Alerta não criado.</span>}
      {erro && (
        <span role="alert" className="text-down">
          {erro}
        </span>
      )}
      {(estado === "proposta" || estado === "enviando") && (
        <div className="flex gap-2">
          <Button
            variant="primary"
            disabled={estado === "enviando"}
            onClick={() => {
              setEstado("enviando");
              setErro(null);
              confirmarAlerta(proposta)
                .then(() => setEstado("criado"))
                .catch((e: Error) => {
                  setErro(e.message);
                  setEstado("proposta");
                });
            }}
          >
            Confirmar alerta
          </Button>
          <Button onClick={() => setEstado("recusado")}>Agora não</Button>
        </div>
      )}
    </div>
  );
}

export function Mensagem({
  mensagem,
  aoNavegar,
}: {
  mensagem: UIMessage;
  aoNavegar: () => void;
}) {
  const doUsuario = mensagem.role === "user";
  const blocos: ReactNode[] = [];
  mensagem.parts.forEach((p, i) => {
    if (p.type === "text" && p.text) {
      blocos.push(
        doUsuario ? (
          <p key={i} className="m-0 whitespace-pre-wrap">
            {p.text}
          </p>
        ) : (
          <div key={i} className="flex flex-col gap-2 text-sm leading-relaxed">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={componentes(aoNavegar)}
            >
              {comLinksDeTicker(p.text)}
            </ReactMarkdown>
          </div>
        ),
      );
    } else if (isToolUIPart(p)) {
      const nome = getToolName(p);
      const saida = "output" in p ? p.output : undefined;
      blocos.push(
        <PassoDeFerramenta
          key={p.toolCallId}
          nome={nome}
          entrada={p.input as Record<string, unknown> | undefined}
          saida={saida}
          estado={p.state}
        />,
      );
      const proposta = (saida as { proposta?: PropostaDeAlerta } | undefined)?.proposta;
      if (nome === "criar_alerta" && proposta)
        blocos.push(
          <ConfirmarAlerta key={`${p.toolCallId}-alerta`} proposta={proposta} />,
        );
    }
  });
  return (
    <article
      aria-label={doUsuario ? "Sua mensagem" : "Resposta do Bolsiq"}
      className={cn(
        "flex flex-col gap-2",
        doUsuario && "ml-8 rounded-control bg-surface-2 px-3 py-2 text-sm",
      )}
    >
      {blocos}
    </article>
  );
}
