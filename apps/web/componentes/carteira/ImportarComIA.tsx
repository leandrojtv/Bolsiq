"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import Link from "next/link";
import { Button, Select, Switch, formatarDinheiro } from "@bolsiq/ui";
import type { Atalho, LinhaProposta } from "@bolsiq/assistant/puro";
import type { DecisaoDeDivergencia, RevisaoDeCarga } from "@bolsiq/portfolio";
import type { RelatorioNaTela } from "@/lib/carteira";
import {
  CAMPOS_EDITAVEIS,
  conciliacaoDaSelecao,
  custoNaTela,
  ROTULO_DA_ETAPA,
  type EstadoDaImportacaoIA,
  type EstimativaDoArquivo,
  type Etapa,
  type LinhaEditada,
  type ResultadoNaTela,
} from "@/lib/importacao-ia-modelo";
import {
  confirmarIA,
  consentirImportacaoIA,
  estimarIA,
  lerEstadoDaImportacaoIA,
  processarIA,
  revisarIA,
} from "./cliente";
import { Rejeicoes, Revisao } from "./Importar";

const ACEITOS = ".pdf,.csv,.txt,.xlsx,.xls,.png,.jpg,.jpeg,.webp";

const ROTULO_DA_CONFIANCA = { alta: "alta", media: "média", baixa: "baixa" } as const;
const COR_DA_CONFIANCA = {
  alta: "text-up",
  media: "text-warn",
  baixa: "text-down",
} as const;

/**
 * "Importar com IA (qualquer formato)". A IA propoe linhas; o usuario marca,
 * edita e confirma; a gravacao e a mesma da importacao de posicoes e de CSV.
 */
export function ImportarComIA({
  carteira,
  onImportado,
  onAtalho,
}: {
  carteira: string;
  onImportado: () => void;
  /** Arquivo ja no layout do Bolsiq: vai para o importador sem IA. */
  onAtalho: (atalho: Atalho, arquivo: File) => void;
}) {
  const [estado, setEstado] = useState<EstadoDaImportacaoIA | null>(null);
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [texto, setTexto] = useState("");
  const [modelo, setModelo] = useState<string>("");
  const [estimativas, setEstimativas] = useState<EstimativaDoArquivo[] | null>(null);
  const [aceitarImagem, setAceitarImagem] = useState(false);
  const [progresso, setProgresso] = useState<
    Record<string, { etapa: Etapa; detalhe?: string }>
  >({});
  const [resultados, setResultados] = useState<ResultadoNaTela[]>([]);
  const [erros, setErros] = useState<{ arquivo: string; mensagem: string }[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    lerEstadoDaImportacaoIA()
      .then((e) => {
        setEstado(e);
        setModelo(e.modelo ?? "");
      })
      .catch((e: Error) => setErro(e.message));
  }, []);

  function limpar() {
    setEstimativas(null);
    setResultados([]);
    setErros([]);
    setProgresso({});
    setErro(null);
  }

  async function executar(acao: () => Promise<void>) {
    setErro(null);
    setOcupado(true);
    try {
      await acao();
    } catch (falha) {
      setErro((falha as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  const modeloEscolhido = modelo && modelo !== estado?.modelo ? modelo : undefined;

  function estimar() {
    void executar(async () => {
      limpar();
      const e = await estimarIA(carteira, arquivos, texto, modeloEscolhido);
      setEstimativas(e);
    });
  }

  function processar(opcoes: { reprocessar?: boolean; modelo?: string } = {}) {
    const escolhido = opcoes.modelo ?? modeloEscolhido;
    void executar(async () => {
      setResultados([]);
      setErros([]);
      setProgresso({});
      await processarIA(
        carteira,
        arquivos,
        texto,
        {
          ...(escolhido ? { modelo: escolhido } : {}),
          reprocessar: opcoes.reprocessar ?? false,
          aceitar_imagem: aceitarImagem,
        },
        (ev) => {
          if (ev.tipo === "etapa")
            setProgresso((p) => ({
              ...p,
              [ev.arquivo]: {
                etapa: ev.etapa,
                ...(ev.detalhe ? { detalhe: ev.detalhe } : {}),
              },
            }));
          else if (ev.tipo === "resultado") setResultados((r) => [...r, ev.resultado]);
          else if (ev.tipo === "erro")
            setErros((x) => [...x, { arquivo: ev.arquivo, mensagem: ev.mensagem }]);
          else if (ev.tipo === "atalho") {
            const f =
              arquivos.find((a) => a.name === ev.arquivo) ??
              new File([texto], "texto-colado.csv", { type: "text/csv" });
            onAtalho(ev.atalho, f);
          }
        },
      );
      setProgresso({});
      setEstado(await lerEstadoDaImportacaoIA());
    });
  }

  function soltar(e: DragEvent) {
    e.preventDefault();
    setArquivos((a) => [...a, ...Array.from(e.dataTransfer.files)]);
    limpar();
  }

  if (!estado)
    return erro ? (
      <p role="alert" className="m-0 text-sm text-down">
        {erro}
      </p>
    ) : (
      <p className="m-0 text-sm text-text-3">Carregando…</p>
    );

  if (!estado.configurado || !estado.pode_importar)
    return (
      <p className="m-0 text-sm text-text-2">
        Para importar com IA, configure um provedor e um modelo.{" "}
        <Link href="/configuracoes/assistente" className="text-link underline">
          Configurações do assistente
        </Link>
      </p>
    );

  if (!estado.consentiu) return <Consentimento onAceito={setEstado} />;

  const vazio = arquivos.length === 0 && !texto.trim();
  const algumaVisao = estimativas?.some((x) => x.precisa_visao) ?? false;
  const custoTotal = estimativas?.reduce<number | null>(
    (s, x) =>
      x.em_cache || x.atalho
        ? s
        : s === null || !x.estimativa?.custo_estimado
          ? null
          : s + Number(x.estimativa.custo_estimado),
    0,
  );

  return (
    <div className="flex flex-col gap-4">
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={soltar}
        className="flex flex-col gap-2 rounded-control border border-dashed border-border-strong p-4 text-[13px] text-text-2"
      >
        <p className="m-0">
          Arraste os extratos aqui (PDF, CSV, XLSX, TXT ou imagem), um por instituição, ou
          escolha:
        </p>
        <input
          type="file"
          multiple
          accept={ACEITOS}
          aria-label="Arquivos do extrato"
          onChange={(e) => {
            setArquivos(Array.from(e.target.files ?? []));
            limpar();
          }}
          className="text-sm text-text file:mr-3 file:h-touch file:rounded-control file:border file:border-border-strong file:bg-surface file:px-3 file:text-text"
        />
        {arquivos.length > 0 && (
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {arquivos.map((a, i) => (
              <li
                key={`${a.name}-${i}`}
                className="flex items-center gap-1 font-mono text-xs"
              >
                {a.name}
                <button
                  type="button"
                  aria-label={`Remover ${a.name}`}
                  onClick={() => {
                    setArquivos(arquivos.filter((_, j) => j !== i));
                    limpar();
                  }}
                  className="text-text-3"
                >
                  x
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <label className="flex flex-col gap-1.5 text-xs text-text-3">
        Ou cole o texto do extrato
        <textarea
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            limpar();
          }}
          rows={4}
          className="rounded-control border border-border-strong bg-surface p-2 font-mono text-xs text-text"
        />
      </label>
      {estado.modelos.length > 1 && (
        <Select
          label="Modelo"
          value={modelo}
          onValueChange={(m) => {
            setModelo(m);
            setEstimativas(null);
          }}
          options={estado.modelos.map((m) => ({
            value: m.modelo,
            label: `${m.modelo}${m.visao ? " (lê imagem)" : ""}${m.homologado ? "" : " - experimental"}`,
          }))}
        />
      )}
      <p className="m-0 text-xs text-text-3">
        {estado.feitas_hoje} de {estado.limite_diario} importações com IA hoje. O conteúdo
        vai anonimizado ao provedor {estado.provedor}; CPF, conta, nome e endereço saem
        antes.
      </p>

      {erro && (
        <p role="alert" className="m-0 text-sm text-down">
          {erro}
        </p>
      )}

      {!estimativas && (
        <Button variant="primary" disabled={ocupado || vazio} onClick={estimar}>
          {ocupado ? "Lendo os arquivos…" : "Estimar custo"}
        </Button>
      )}

      {estimativas && resultados.length === 0 && (
        <section aria-label="Estimativa" className="flex flex-col gap-2 text-[13px]">
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {estimativas.map((x) => (
              <li key={x.hash}>
                <span className="font-mono">{x.nome}</span>:{" "}
                {x.atalho
                  ? `já no layout ${x.atalho}; vai pela importação sem IA.`
                  : x.em_cache
                    ? "já extraído com este modelo: sem custo."
                    : `~${(x.estimativa?.tokens_entrada ?? 0).toLocaleString("pt-BR")} tokens de entrada e ~${(x.estimativa?.tokens_saida ?? 0).toLocaleString("pt-BR")} de saída, ${custoNaTela(x.estimativa?.custo_estimado ?? null)}.`}
                {x.remocoes.cpf + x.remocoes.conta + x.remocoes.linhas > 0 && (
                  <span className="text-text-3">
                    {" "}
                    Removidos: {x.remocoes.cpf} CPF, {x.remocoes.conta} conta/agência,{" "}
                    {x.remocoes.linhas} linhas do titular.
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="m-0">
            Total estimado:{" "}
            <strong>
              {custoNaTela(
                custoTotal === undefined ? null : (custoTotal?.toFixed(6) ?? null),
              )}
            </strong>
            . O valor real vem do provedor e entra no consumo do mês.
          </p>
          {algumaVisao && (
            <Switch
              checked={aceitarImagem}
              onCheckedChange={setAceitarImagem}
              label="Imagem e página escaneada vão ao provedor como estão, sem anonimização. Enviar mesmo assim."
            />
          )}
          <Button
            variant="primary"
            disabled={ocupado || (algumaVisao && !aceitarImagem)}
            onClick={() => processar()}
          >
            {ocupado ? "Processando…" : "Processar com IA"}
          </Button>
        </section>
      )}

      {Object.keys(progresso).length > 0 && (
        <ul
          aria-label="Progresso"
          className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]"
        >
          {Object.entries(progresso).map(([a, p]) => (
            <li key={a} role="status">
              <span className="font-mono">{a}</span>: {ROTULO_DA_ETAPA[p.etapa]}
              {p.detalhe ? ` (${p.detalhe})` : ""}…
            </li>
          ))}
        </ul>
      )}

      {erros.map((e) => (
        <p key={e.arquivo} role="alert" className="m-0 text-sm text-down">
          {e.arquivo}: {e.mensagem}
        </p>
      ))}

      {resultados.map((r) => (
        <RevisaoDaIA
          key={r.extracao_id}
          carteira={carteira}
          resultado={r}
          modelos={estado.modelos.map((m) => m.modelo)}
          ocupado={ocupado}
          onReprocessar={(m) =>
            processar({ reprocessar: true, ...(m ? { modelo: m } : {}) })
          }
          onImportado={onImportado}
        />
      ))}
    </div>
  );
}

function Consentimento({ onAceito }: { onAceito: (e: EstadoDaImportacaoIA) => void }) {
  const [guardar, setGuardar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  return (
    <section
      aria-label="Consentimento"
      className="flex flex-col gap-3 text-[13px] text-text-2"
    >
      <p className="m-0">
        A importação com IA envia o conteúdo do extrato ao provedor que você escolheu nas
        configurações do assistente, com a sua chave. Antes do envio, o Bolsiq tira CPF,
        número de conta e agência, e as linhas de nome, endereço, e-mail e telefone. CNPJ
        de fundo e códigos de ativo ficam. Imagem e PDF escaneado não têm como ser
        anonimizados: para eles, o Bolsiq pede confirmação a cada envio.
      </p>
      <p className="m-0">
        A IA só propõe linhas. Nada entra na carteira sem a sua confirmação. O Bolsiq
        guarda o resultado da extração e o relatório; o arquivo original, só se você
        pedir. Tudo sai com a exclusão da conta.
      </p>
      <Switch
        checked={guardar}
        onCheckedChange={setGuardar}
        label="Guardar também o arquivo original"
      />
      {erro && (
        <p role="alert" className="m-0 text-sm text-down">
          {erro}
        </p>
      )}
      <Button
        variant="primary"
        onClick={() => {
          consentirImportacaoIA(guardar)
            .then(onAceito)
            .catch((e: Error) => setErro(e.message));
        }}
      >
        Concordo e quero importar com IA
      </Button>
    </section>
  );
}

interface LinhaNaTela extends LinhaProposta {
  dados: Record<string, string>;
}

function RevisaoDaIA({
  carteira,
  resultado: r,
  modelos,
  ocupado,
  onReprocessar,
  onImportado,
}: {
  carteira: string;
  resultado: ResultadoNaTela;
  modelos: string[];
  ocupado: boolean;
  onReprocessar: (modelo?: string) => void;
  onImportado: () => void;
}) {
  const v = r.validacao;
  const [linhas, setLinhas] = useState<LinhaNaTela[]>(v.linhas);
  const [marcadas, setMarcadas] = useState<Set<string>>(
    new Set(v.linhas.filter((l) => l.marcada).map((l) => l.id)),
  );
  const [origem, setOrigem] = useState<LinhaNaTela | null>(null);
  const [revisao, setRevisao] = useState<RevisaoDeCarga | null>(null);
  const [aceitar, setAceitar] = useState(false);
  const [outro, setOutro] = useState(r.modelo);
  const [relatorio, setRelatorio] = useState<RelatorioNaTela | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const origemRef = useRef<HTMLDivElement>(null);

  const selecionadas: LinhaEditada[] = linhas
    .filter((l) => marcadas.has(l.id))
    .map((l) => ({ id: l.id, tipo: l.tipo, dados: l.dados }));
  const conciliacao = conciliacaoDaSelecao(selecionadas, v.documento.totais_declarados);
  const conciliada =
    conciliacao.every((c) => c.conciliada) && v.notas.every((n) => n.conciliada);
  const soTransacoes = !selecionadas.some((l) => l.tipo === "posicao");

  function editar(id: string, campo: string, valor: string) {
    setLinhas((ls) =>
      ls.map((l) => (l.id === id ? { ...l, dados: { ...l.dados, [campo]: valor } } : l)),
    );
    setRevisao(null);
  }

  function marcar(id: string, sim: boolean) {
    const novo = new Set(marcadas);
    if (sim) novo.add(id);
    else novo.delete(id);
    setMarcadas(novo);
    setRevisao(null);
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

  function confirmar(decisoes: DecisaoDeDivergencia[]) {
    void executar(async () => {
      setRelatorio(
        await confirmarIA(carteira, {
          extracao_id: r.extracao_id,
          linhas: selecionadas,
          decisoes,
          aceitar_nao_conciliada: aceitar,
        }),
      );
      setRevisao(null);
      onImportado();
    });
  }

  const textoDaOrigem = origem
    ? r.partes
        .filter(
          (p) => p.origem.toLowerCase() === origem.origem.pagina_ou_aba.toLowerCase(),
        )
        .map((p) => p.texto)
        .join("\n")
    : "";

  if (relatorio)
    return (
      <p role="status" className="m-0 text-sm">
        {r.arquivo.nome}: {relatorio.linhas_aceitas} linhas gravadas.
        {relatorio.linhas_rejeitadas > 0 && ` ${relatorio.linhas_rejeitadas} rejeitadas.`}
      </p>
    );

  return (
    <section
      aria-label={`Revisão de ${r.arquivo.nome}`}
      className="flex flex-col gap-3 rounded-control border border-border p-3"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
        <span>
          <span className="rounded-control bg-accent-soft px-2 py-0.5 text-xs text-accent-soft-text">
            extraído por IA
          </span>{" "}
          <span className="font-mono">{r.arquivo.nome}</span>{" "}
          <span className="text-text-3">
            {r.provedor}/{r.modelo},{" "}
            {r.do_cache ? "do cache, sem custo" : custoNaTela(r.custo_estimado)}
          </span>
        </span>
        <span className="flex items-center gap-2">
          {modelos.length > 1 && (
            <Select
              label="Reprocessar com"
              value={outro}
              onValueChange={setOutro}
              options={modelos.map((m) => ({ value: m, label: m }))}
            />
          )}
          <Button
            disabled={ocupado}
            onClick={() => onReprocessar(outro === r.modelo ? undefined : outro)}
          >
            Reprocessar
          </Button>
        </span>
      </header>

      {v.avisos.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-xs text-warn">
          {v.avisos.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}

      {conciliacao.length > 0 && (
        <div className="flex flex-col gap-1 text-[13px]">
          <h3 className="m-0 text-[13px] font-semibold">Totais por corretora</h3>
          {conciliacao.map((c) => (
            <p key={c.corretora} className="m-0 flex flex-wrap justify-between gap-2">
              <span>{c.corretora}</span>
              <span className="font-mono">
                linhas marcadas {formatarDinheiro(c.soma)}; documento{" "}
                {c.declarado
                  ? `${formatarDinheiro(c.declarado)} (${c.descricao ?? ""})`
                  : "sem total"}{" "}
                <span className={c.conciliada ? "text-up" : "text-down"}>
                  {c.conciliada ? "conciliado" : "não conciliado"}
                </span>
              </span>
            </p>
          ))}
        </div>
      )}
      {v.notas.map((n) => (
        <p key={n.numero} className="m-0 text-[13px]">
          Nota {n.numero}: compras {formatarDinheiro(n.compras)}, vendas{" "}
          {formatarDinheiro(n.vendas)}, taxas {formatarDinheiro(n.taxas)}, líquido
          calculado {formatarDinheiro(n.liquido_calculado)}{" "}
          <span className={n.conciliada ? "text-up" : "text-down"}>
            {n.conciliada ? "confere com a nota" : `não confere: ${n.motivo ?? ""}`}
          </span>
        </p>
      ))}

      <div className="max-h-96 overflow-auto rounded-control border border-border">
        <table className="w-full border-collapse text-[12px]">
          <thead className="sticky top-0 bg-surface text-text-3">
            <tr>
              <th scope="col" className="p-2 text-left font-medium">
                Importar
              </th>
              <th scope="col" className="p-2 text-left font-medium">
                Confiança
              </th>
              <th scope="col" className="p-2 text-left font-medium">
                Linha
              </th>
              <th scope="col" className="p-2 text-left font-medium">
                Origem
              </th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.id} className="border-t border-border align-top">
                <td className="p-2">
                  <input
                    type="checkbox"
                    aria-label={`Importar ${l.dados.ativo || l.dados.ticker || l.id}`}
                    checked={marcadas.has(l.id)}
                    onChange={(e) => marcar(l.id, e.target.checked)}
                  />
                </td>
                <td className={`p-2 ${COR_DA_CONFIANCA[l.confianca]}`}>
                  {ROTULO_DA_CONFIANCA[l.confianca]}
                </td>
                <td className="p-2">
                  <div className="flex flex-wrap gap-1">
                    {CAMPOS_EDITAVEIS[l.tipo].map((c) => (
                      <label
                        key={c.campo}
                        className="flex flex-col text-[11px] text-text-3"
                      >
                        {c.rotulo}
                        <input
                          value={l.dados[c.campo] ?? ""}
                          onChange={(e) => editar(l.id, c.campo, e.target.value)}
                          className="w-28 rounded-control border border-border bg-surface px-1 py-0.5 font-mono text-[12px] text-text"
                        />
                      </label>
                    ))}
                  </div>
                  {l.avisos.length > 0 && (
                    <p className="m-0 mt-1 text-[11px] text-warn">{l.avisos.join(" ")}</p>
                  )}
                </td>
                <td className="p-2">
                  <button
                    type="button"
                    onClick={() => {
                      setOrigem(l);
                      origemRef.current?.scrollIntoView({ block: "nearest" });
                    }}
                    className="max-w-56 text-left font-mono text-[11px] break-all text-link underline"
                  >
                    {l.origem.pagina_ou_aba}: {l.origem.trecho_original}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div ref={origemRef}>
        {origem && (
          <section aria-label="Origem da linha" className="flex flex-col gap-1">
            <h3 className="m-0 text-[13px] font-semibold">
              {origem.origem.pagina_ou_aba} (texto anonimizado enviado ao modelo)
            </h3>
            <pre className="m-0 max-h-64 overflow-auto rounded-control border border-border bg-surface-2 p-2 text-[11px] whitespace-pre-wrap">
              {textoDaOrigem || "Lida de imagem: sem texto extraído para mostrar."}
            </pre>
          </section>
        )}
      </div>

      {v.rejeicoes.length > 0 && (
        <details className="text-[13px]">
          <summary>Rejeitadas ({v.rejeicoes.length})</summary>
          <Rejeicoes
            itens={v.rejeicoes.map((x, i) => ({
              linha: i + 1,
              motivo: x.motivo,
              conteudo: x.origem
                ? `${x.origem.pagina_ou_aba}: ${x.origem.trecho_original}`
                : x.conteudo,
            }))}
          />
        </details>
      )}

      {!conciliada && (
        <Switch
          checked={aceitar}
          onCheckedChange={setAceitar}
          label="A carga não concilia com o documento. Conferi os valores e quero importar assim."
        />
      )}
      {erro && (
        <p role="alert" className="m-0 text-sm text-down">
          {erro}
        </p>
      )}

      {revisao ? (
        <Revisao
          revisao={revisao}
          enviando={enviando}
          bloqueio={
            !conciliada && !aceitar ? "Confirme a carga não conciliada acima." : null
          }
          onConfirmar={confirmar}
        />
      ) : soTransacoes ? (
        <Button
          variant="primary"
          disabled={enviando || selecionadas.length === 0 || (!conciliada && !aceitar)}
          onClick={() => confirmar([])}
        >
          {enviando ? "Gravando…" : `Confirmar ${selecionadas.length} lançamentos`}
        </Button>
      ) : (
        <Button
          variant="primary"
          disabled={enviando || selecionadas.length === 0}
          onClick={() =>
            void executar(async () => {
              setRevisao(await revisarIA(carteira, r.extracao_id, selecionadas));
            })
          }
        >
          {enviando ? "Revisando…" : `Revisar carga (${selecionadas.length} linhas)`}
        </Button>
      )}
    </section>
  );
}
