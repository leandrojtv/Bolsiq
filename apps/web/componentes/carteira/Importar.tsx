"use client";

import { useState, type FormEvent } from "react";
import { Button, SegmentedControl, formatarDinheiro } from "@bolsiq/ui";
import type { Atalho } from "@bolsiq/assistant/puro";
import type { DecisaoDeDivergencia, RevisaoDeCarga } from "@bolsiq/portfolio";
import type { RelatorioNaTela } from "@/lib/carteira";
import { dataCompleta, ehLayoutDePosicao } from "@/lib/carteira-modelo";
import { importarArquivo, revisarPosicao, type FormatoDeImportacao } from "./cliente";
import { ImportarComIA } from "./ImportarComIA";

type Aba = FormatoDeImportacao | "ia";

const AJUDA: Record<Aba, string> = {
  bolsiq:
    "Colunas: data; ticker; tipo; quantidade; preco; taxas; corretora. Separador ; ou , e número em pt-BR.",
  b3: "Arquivo de movimentação exportado da Área do Investidor da B3, em CSV.",
  posicao_bolsiq:
    "Fotografia da carteira numa data, com renda fixa, Tesouro, fundos, previdência e COE. Você revisa antes de confirmar.",
  ia: "Qualquer formato, de qualquer banco ou corretora: a IA do assistente converte, o Bolsiq confere cada linha contra o documento e você revisa antes de gravar.",
};

/** Modelo para baixar em cada formato; os arquivos ficam em public/modelos. */
const MODELO: Record<FormatoDeImportacao, { arquivo: string; rotulo: string }> = {
  bolsiq: { arquivo: "transacoes-bolsiq.csv", rotulo: "Baixar modelo de transações" },
  b3: { arquivo: "extrato-b3.csv", rotulo: "Baixar exemplo do extrato da B3" },
  posicao_bolsiq: { arquivo: "posicoes-bolsiq.csv", rotulo: "Baixar modelo de posições" },
};

/**
 * CSV do Bolsiq, extrato da B3 ou posicoes. Transacoes gravam direto, com relatorio
 * de rejeitadas; posicao passa antes pela revisao contra a carga vigente.
 */
export function Importar({
  carteira,
  onImportado,
}: {
  carteira: string;
  onImportado: () => void;
}) {
  const [formato, setFormato] = useState<Aba>("bolsiq");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [revisao, setRevisao] = useState<RevisaoDeCarga | null>(null);
  const [relatorio, setRelatorio] = useState<RelatorioNaTela | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function escolher(novo: File | null) {
    setArquivo(novo);
    setRevisao(null);
    setRelatorio(null);
    setErro(null);
    if (novo && ehLayoutDePosicao(await novo.text())) setFormato("posicao_bolsiq");
  }

  async function executar(acao: () => Promise<void>) {
    setErro(null);
    setEnviando(true);
    try {
      await acao();
    } catch (falha) {
      setErro((falha as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (!arquivo) return setErro("Escolha o arquivo.");
    void executar(async () => {
      // O cabecalho decide mesmo se a leitura em `escolher` ainda nao terminou.
      if (formato === "posicao_bolsiq" || ehLayoutDePosicao(await arquivo.text())) {
        setFormato("posicao_bolsiq");
        setRelatorio(null);
        setRevisao(await revisarPosicao(carteira, arquivo));
        return;
      }
      if (formato === "ia") return;
      setRelatorio(await importarArquivo(carteira, arquivo, formato));
      onImportado();
    });
  }

  function confirmar(decisoes: DecisaoDeDivergencia[]) {
    if (!arquivo) return;
    void executar(async () => {
      setRelatorio(await importarArquivo(carteira, arquivo, "posicao_bolsiq", decisoes));
      setRevisao(null);
      onImportado();
    });
  }

  /** Arquivo que a IA reconheceu como layout do Bolsiq: segue pelo importador sem IA. */
  function reconhecido(atalho: Atalho, f: File) {
    setFormato(atalho);
    setArquivo(f);
    setRevisao(null);
    setRelatorio(null);
    setErro(`${f.name} já está no layout ${atalho}: importe sem IA.`);
  }

  const seletor = (
    <SegmentedControl<Aba>
      label="Formato"
      value={formato}
      onChange={(f) => {
        setFormato(f);
        setRevisao(null);
      }}
      options={[
        { value: "bolsiq", label: "CSV Bolsiq" },
        { value: "b3", label: "Extrato B3" },
        { value: "posicao_bolsiq", label: "Posições" },
        { value: "ia", label: "Com IA" },
      ]}
    />
  );

  if (formato === "ia")
    return (
      <div className="flex flex-col gap-4">
        {seletor}
        <p className="m-0 text-[13px] text-text-2">
          <strong>Importar com IA (qualquer formato).</strong> {AJUDA.ia}
        </p>
        <ImportarComIA
          carteira={carteira}
          onImportado={onImportado}
          onAtalho={reconhecido}
        />
      </div>
    );

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={enviar} className="flex flex-col gap-3">
        {seletor}
        <p className="m-0 text-[13px] text-text-2">
          {AJUDA[formato]}{" "}
          <a
            href={`/modelos/${MODELO[formato].arquivo}`}
            download
            className="text-link underline"
          >
            {MODELO[formato].rotulo}
          </a>
        </p>
        <label className="flex flex-col gap-1.5 text-xs text-text-3">
          Arquivo CSV
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => void escolher(e.target.files?.[0] ?? null)}
            className="text-sm text-text file:mr-3 file:h-touch file:rounded-control file:border file:border-border-strong file:bg-surface file:px-3 file:text-text"
          />
        </label>
        {erro && (
          <p role="alert" className="m-0 text-sm text-down">
            {erro}
          </p>
        )}
        {!revisao && (
          <Button type="submit" variant="primary" disabled={enviando || !arquivo}>
            {enviando
              ? "Enviando…"
              : formato === "posicao_bolsiq"
                ? "Revisar"
                : "Importar"}
          </Button>
        )}
      </form>

      {revisao && (
        <Revisao revisao={revisao} enviando={enviando} onConfirmar={confirmar} />
      )}

      {relatorio && (
        <section aria-label="Relatório da importação" className="flex flex-col gap-2">
          <p role="status" className="m-0 text-sm">
            {relatorio.linhas_aceitas} de {relatorio.linhas_lidas} linhas importadas em{" "}
            {(relatorio.duracao_ms / 1000).toLocaleString("pt-BR", {
              maximumFractionDigits: 2,
            })}{" "}
            s.
            {relatorio.linhas_rejeitadas > 0 &&
              ` ${relatorio.linhas_rejeitadas} rejeitadas:`}
          </p>
          {relatorio.rejeicoes.length > 0 && <Rejeicoes itens={relatorio.rejeicoes} />}
        </section>
      )}
    </div>
  );
}

export function Rejeicoes({ itens }: { itens: RelatorioNaTela["rejeicoes"] }) {
  return (
    <div className="max-h-64 overflow-auto rounded-control border border-border">
      <table className="w-full border-collapse text-[12px]">
        <thead className="sticky top-0 bg-surface text-text-3">
          <tr>
            <th scope="col" className="p-2 text-left font-medium">
              Linha
            </th>
            <th scope="col" className="p-2 text-left font-medium">
              Motivo
            </th>
            <th scope="col" className="p-2 text-left font-medium">
              Conteúdo
            </th>
          </tr>
        </thead>
        <tbody>
          {itens.map((r, i) => (
            <tr key={`${r.linha}-${i}`} className="border-t border-border align-top">
              <td className="p-2 font-mono">{r.linha}</td>
              <td className="p-2">{r.motivo}</td>
              <td className="p-2 font-mono break-all text-text-2">{r.conteudo}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Grupo({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section aria-label={titulo} className="flex flex-col gap-1.5">
      <h3 className="m-0 text-[13px] font-semibold">{titulo}</h3>
      {children}
    </section>
  );
}

function ListaDeLinhas({
  itens,
}: {
  itens: { corretora: string; ativo: string; saldo_bruto: string; anterior?: string }[];
}) {
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
      {itens.map((l) => (
        <li key={`${l.corretora}|${l.ativo}`} className="flex justify-between gap-3">
          <span className="min-w-0">
            {l.ativo} <span className="text-text-3">({l.corretora})</span>
          </span>
          <span className="font-mono whitespace-nowrap">
            {l.anterior !== undefined && `${formatarDinheiro(l.anterior)} → `}
            {formatarDinheiro(l.saldo_bruto)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Revisao({
  revisao: r,
  enviando,
  onConfirmar,
  bloqueio = null,
}: {
  revisao: RevisaoDeCarga;
  enviando: boolean;
  onConfirmar: (decisoes: DecisaoDeDivergencia[]) => void;
  /** Motivo para nao confirmar ainda (carga com IA nao conciliada). */
  bloqueio?: string | null;
}) {
  const chave = (d: { corretora: string; ticker: string }) =>
    `${d.corretora}|${d.ticker}`;
  const [ajustar, setAjustar] = useState<Set<string>>(new Set());

  function alternar(k: string, gerar: boolean) {
    const novo = new Set(ajustar);
    if (gerar) novo.add(k);
    else novo.delete(k);
    setAjustar(novo);
  }

  const decisoes: DecisaoDeDivergencia[] = r.divergencias.flatMap((d) =>
    d.ajuste
      ? [
          {
            corretora: d.corretora,
            ticker: d.ticker,
            acao: ajustar.has(chave(d)) ? "gerar_ajuste" : "ignorar",
          },
        ]
      : [],
  );

  return (
    <section aria-label="Revisão da carga" className="flex flex-col gap-4">
      {r.recusas.length > 0 && (
        <div role="alert" className="flex flex-col gap-1 text-sm text-down">
          {r.recusas.map((m) => (
            <p key={m} className="m-0">
              {m}
            </p>
          ))}
        </div>
      )}

      <Grupo titulo="Total por corretora">
        {r.totais_por_corretora.length === 0 ? (
          <p className="m-0 text-[13px] text-text-3">Nenhuma linha válida no arquivo.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
            {r.totais_por_corretora.map((t) => (
              <li key={t.corretora} className="flex justify-between gap-3">
                <span>
                  {t.corretora}{" "}
                  <span className="text-text-3">
                    extrato de {dataCompleta(t.data_posicao)}, {t.linhas}{" "}
                    {t.linhas === 1 ? "linha" : "linhas"}
                  </span>
                </span>
                <span className="font-mono whitespace-nowrap">
                  {formatarDinheiro(t.saldo_bruto)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="m-0 text-xs text-text-3">
          Confira com o extrato da corretora. Linhas rejeitadas ficam fora da soma.
        </p>
      </Grupo>

      {r.novas.length > 0 && (
        <Grupo titulo={`Novas (${r.novas.length})`}>
          <ListaDeLinhas itens={r.novas} />
        </Grupo>
      )}
      {r.alteradas.length > 0 && (
        <Grupo titulo={`Alteradas (${r.alteradas.length})`}>
          <ListaDeLinhas
            itens={r.alteradas.map((l) => ({ ...l, anterior: l.saldo_anterior }))}
          />
        </Grupo>
      )}
      {r.removidas.length > 0 && (
        <Grupo titulo={`Deixarão de existir (${r.removidas.length})`}>
          <ListaDeLinhas itens={r.removidas} />
        </Grupo>
      )}

      {r.saldos_iniciais.length > 0 && (
        <Grupo titulo={`Saldo inicial na renda variável (${r.saldos_iniciais.length})`}>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
            {r.saldos_iniciais.map((s) => (
              <li key={chave(s)}>
                <span className="font-mono">{s.ticker}</span> ({s.corretora}):{" "}
                {s.quantidade} a {formatarDinheiro(s.preco)} em{" "}
                {dataCompleta(s.data_posicao)}
              </li>
            ))}
          </ul>
        </Grupo>
      )}

      {r.divergencias.length > 0 && (
        <Grupo titulo={`Divergências de quantidade (${r.divergencias.length})`}>
          <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[13px]">
            {r.divergencias.map((d) => (
              <li
                key={chave(d)}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <span>
                  <span className="font-mono">{d.ticker}</span>: sistema {d.sistema},
                  extrato {d.extrato} <span className="text-text-3">({d.corretora})</span>
                </span>
                {d.ajuste ? (
                  <SegmentedControl<"ignorar" | "gerar_ajuste">
                    label={`O que fazer com ${d.ticker} em ${d.corretora}`}
                    value={ajustar.has(chave(d)) ? "gerar_ajuste" : "ignorar"}
                    onChange={(v) => alternar(chave(d), v === "gerar_ajuste")}
                    options={[
                      { value: "ignorar", label: "Ignorar" },
                      {
                        value: "gerar_ajuste",
                        label: `Gerar ${d.ajuste.tipo} de ${d.ajuste.quantidade}`,
                      },
                    ]}
                  />
                ) : (
                  <span className="text-xs text-text-3">
                    Fora do extrato: lance a venda pelo formulário, se houve.
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Grupo>
      )}

      {r.pendencias.length > 0 && (
        <Grupo titulo={`Pendências (${r.pendencias.length})`}>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
            {r.pendencias.map((p) => (
              <li key={`${p.linha}|${p.motivo}`}>
                {p.ativo}: <span className="text-warn">{p.motivo}</span>
              </li>
            ))}
          </ul>
          <p className="m-0 text-xs text-text-3">Não impedem a confirmação.</p>
        </Grupo>
      )}

      {r.rejeicoes.length > 0 && (
        <Grupo titulo={`Rejeitadas (${r.rejeicoes.length})`}>
          <Rejeicoes itens={r.rejeicoes} />
        </Grupo>
      )}

      {bloqueio && <p className="m-0 text-xs text-warn">{bloqueio}</p>}
      <Button
        variant="primary"
        disabled={
          enviando || r.recusas.length > 0 || r.linhas_aceitas === 0 || bloqueio !== null
        }
        onClick={() => onConfirmar(decisoes)}
      >
        {enviando ? "Gravando…" : "Confirmar importação"}
      </Button>
    </section>
  );
}
