"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import Link from "next/link";
import { Button, Select, Switch, formatarDinheiro } from "@bolsiq/ui";
import type { Atalho, GrupoDaLinha, LinhaProposta } from "@bolsiq/assistant/puro";
import type { DecisaoDeDivergencia, RevisaoDeCarga } from "@bolsiq/portfolio";
import { ErroDaApi } from "@/lib/api";
import type { RelatorioNaTela } from "@/lib/carteira";
import {
  camposDaLinha,
  conciliacaoDaSelecao,
  custoNaTela,
  ROTULO_DA_ESTRATEGIA,
  ROTULO_DO_GRUPO,
  sugerirCorretora,
  TERMINAIS,
  textoDoProgresso,
  type EstadoDaImportacaoIA,
  type JobNaTela,
  type LinhaEditada,
  type ResultadoNaTela,
} from "@/lib/importacao-ia-modelo";
import {
  acompanharJob,
  cancelarJobDaIA,
  confirmarCustoDaIA,
  confirmarIA,
  consentirImportacaoIA,
  enviarParaIA,
  lerEstadoDaImportacaoIA,
  reprocessarNaIA,
  resultadoDoArquivo,
  revisarIA,
  ultimoJobDaIA,
} from "./cliente";
import { Rejeicoes, Revisao } from "./Importar";

const ACEITOS = ".pdf,.csv,.txt,.xlsx,.xls,.ods,.png,.jpg,.jpeg,.webp,.heic,.heif";

const ROTULO_DA_CONFIANCA = { alta: "alta", media: "média", baixa: "baixa" } as const;
const COR_DA_CONFIANCA = {
  alta: "text-up",
  media: "text-warn",
  baixa: "text-down",
} as const;
const GRUPOS: GrupoDaLinha[] = ["pronta", "preenchida", "ajuste", "a_receber"];

interface ArquivoEscolhido {
  arquivo: File;
  corretora: string;
}

/**
 * "Importar com IA (qualquer formato)". O envio cria um job que roda em segundo
 * plano: da para fechar a pagina e voltar. A IA propoe as linhas; o usuario
 * confere, ajusta e confirma; a gravacao e a de sempre.
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
  const [escolhidos, setEscolhidos] = useState<ArquivoEscolhido[]>([]);
  const [texto, setTexto] = useState("");
  const [corretoraDoTexto, setCorretoraDoTexto] = useState("");
  const [senhas, setSenhas] = useState<Record<string, string>>({});
  const [pedeSenha, setPedeSenha] = useState(false);
  const [aceitarImagem, setAceitarImagem] = useState(false);
  const [atalhos, setAtalhos] = useState<{ nome: string; atalho: Atalho }[]>([]);
  const [job, setJob] = useState<JobNaTela | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const fechar = useRef<(() => void) | null>(null);

  const acompanhar = (id: string) => {
    fechar.current?.();
    fechar.current = acompanharJob(carteira, id, setJob);
  };

  useEffect(() => {
    lerEstadoDaImportacaoIA()
      .then(setEstado)
      .catch((e: Error) => setErro(e.message));
    // Volta ao ultimo job: o processamento continuou com a pagina fechada.
    ultimoJobDaIA(carteira)
      .then((j) => {
        if (!j) return;
        setJob(j);
        if (!TERMINAIS.includes(j.status)) {
          fechar.current?.();
          fechar.current = acompanharJob(carteira, j.id, setJob);
        }
      })
      .catch(() => undefined);
    return () => fechar.current?.();
  }, [carteira]);

  async function executar(acao: () => Promise<void>) {
    setErro(null);
    setOcupado(true);
    try {
      await acao();
    } catch (falha) {
      if (falha instanceof ErroDaApi && falha.codigo === "precisa_senha")
        setPedeSenha(true);
      setErro((falha as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  function adicionar(files: File[]) {
    setEscolhidos((atual) => [
      ...atual,
      ...files.map((f) => ({ arquivo: f, corretora: sugerirCorretora(f.name) })),
    ]);
  }

  function soltar(e: DragEvent) {
    e.preventDefault();
    adicionar(Array.from(e.dataTransfer.files));
  }

  function enviar() {
    void executar(async () => {
      setAtalhos([]);
      const r = await enviarParaIA(carteira, {
        arquivos: escolhidos,
        texto,
        corretora_do_texto: corretoraDoTexto,
        senhas,
        aceitar_imagem: aceitarImagem,
      });
      setAtalhos(r.atalhos);
      setPedeSenha(false);
      if (r.job_id) {
        setEscolhidos((atual) =>
          atual.filter((a) => r.atalhos.some((x) => x.nome === a.arquivo.name)),
        );
        setTexto("");
        acompanhar(r.job_id);
      }
    });
  }

  if (!estado)
    return erro ? (
      <p role="alert" className="m-0 text-sm text-down">
        {erro}
      </p>
    ) : (
      <p className="m-0 text-sm text-text-3">Carregando…</p>
    );

  if (!estado.pode_importar)
    return (
      <p className="m-0 text-sm text-text-2">
        Para importar com IA, configure um provedor e um modelo.{" "}
        <Link href="/configuracoes/assistente" className="text-link underline">
          Configurações do assistente
        </Link>
      </p>
    );

  if (!estado.consentiu) return <Consentimento onAceito={setEstado} />;

  const vazio = escolhidos.length === 0 && !texto.trim();
  const temPdf = escolhidos.some((e) => /\.pdf$/i.test(e.arquivo.name));
  const temImagem = escolhidos.some((e) =>
    /\.(png|jpe?g|webp|heic|heif|pdf)$/i.test(e.arquivo.name),
  );
  const emAndamento = job !== null && !TERMINAIS.includes(job.status);

  return (
    <div className="flex flex-col gap-4">
      {!emAndamento && (
        <section aria-label="Envio" className="flex flex-col gap-3">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={soltar}
            className="flex flex-col gap-2 rounded-control border border-dashed border-border-strong p-4 text-[13px] text-text-2"
          >
            <p className="m-0">
              Arraste os extratos aqui, vários de uma vez (PDF, CSV, XLSX, ODS, TXT ou
              foto), até {estado.limites.arquivos} arquivos de {estado.limites.mb} MB, ou
              escolha:
            </p>
            <input
              type="file"
              multiple
              accept={ACEITOS}
              aria-label="Arquivos do extrato"
              onChange={(e) => {
                adicionar(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
              className="text-sm text-text file:mr-3 file:h-touch file:rounded-control file:border file:border-border-strong file:bg-surface file:px-3 file:text-text"
            />
            {escolhidos.length > 0 && (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {escolhidos.map((a, i) => (
                  <li
                    key={`${a.arquivo.name}-${i}`}
                    className="flex flex-wrap items-end gap-2"
                  >
                    <span className="min-w-40 font-mono text-xs">{a.arquivo.name}</span>
                    <label className="flex flex-col text-[11px] text-text-3">
                      Corretora
                      <input
                        value={a.corretora}
                        placeholder="ex.: XP"
                        aria-label={`Corretora de ${a.arquivo.name}`}
                        onChange={(e) =>
                          setEscolhidos(
                            escolhidos.map((x, j) =>
                              j === i ? { ...x, corretora: e.target.value } : x,
                            ),
                          )
                        }
                        className="w-32 rounded-control border border-border bg-surface px-1 py-0.5 text-[12px] text-text"
                      />
                    </label>
                    {pedeSenha && /\.pdf$/i.test(a.arquivo.name) && (
                      <label className="flex flex-col text-[11px] text-text-3">
                        Senha do PDF
                        <input
                          type="password"
                          autoComplete="off"
                          aria-label={`Senha de ${a.arquivo.name}`}
                          value={senhas[a.arquivo.name] ?? ""}
                          onChange={(e) =>
                            setSenhas({ ...senhas, [a.arquivo.name]: e.target.value })
                          }
                          className="w-32 rounded-control border border-border bg-surface px-1 py-0.5 text-[12px] text-text"
                        />
                      </label>
                    )}
                    <button
                      type="button"
                      aria-label={`Remover ${a.arquivo.name}`}
                      onClick={() => setEscolhidos(escolhidos.filter((_, j) => j !== i))}
                      className="text-xs text-text-3 underline"
                    >
                      remover
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {pedeSenha && temPdf && (
              <p className="m-0 text-xs text-text-3">
                A senha abre o PDF no servidor e é descartada em seguida; não é gravada.
                Muitos bancos usam parte do CPF.
              </p>
            )}
          </div>
          <label className="flex flex-col gap-1.5 text-xs text-text-3">
            Ou cole o texto do extrato
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              rows={3}
              className="rounded-control border border-border-strong bg-surface p-2 font-mono text-xs text-text"
            />
          </label>
          {texto.trim() && (
            <label className="flex flex-col text-[11px] text-text-3">
              Corretora do texto colado
              <input
                value={corretoraDoTexto}
                onChange={(e) => setCorretoraDoTexto(e.target.value)}
                className="w-40 rounded-control border border-border bg-surface px-1 py-0.5 text-[12px] text-text"
              />
            </label>
          )}
          <p className="m-0 text-xs text-text-3">
            {estado.feitas_hoje} de {estado.limite_diario} importações com IA hoje. O
            texto vai anonimizado ao provedor {estado.provedor} ({estado.modelo}); CPF,
            conta, nome e endereço saem antes. Páginas escaneadas:{" "}
            {estado.visao && aceitarImagem
              ? "vão como imagem ao modelo"
              : "lidas por OCR aqui no servidor"}
            .
          </p>
          {estado.visao && temImagem && (
            <Switch
              checked={aceitarImagem}
              onCheckedChange={setAceitarImagem}
              label="Página escaneada ou foto: enviar a imagem ao provedor como está (sem anonimização), em vez do OCR local."
            />
          )}
          {erro && (
            <p role="alert" className="m-0 text-sm text-down">
              {erro}
            </p>
          )}
          {atalhos.map((a) => {
            const f = escolhidos.find((x) => x.arquivo.name === a.nome)?.arquivo;
            return (
              <p key={a.nome} className="m-0 text-[13px] text-text-2">
                <span className="font-mono">{a.nome}</span> já está no layout {a.atalho}:
                vai pela importação sem IA, sem custo.{" "}
                {f && (
                  <button
                    type="button"
                    className="text-link underline"
                    onClick={() => onAtalho(a.atalho, f)}
                  >
                    Importar assim
                  </button>
                )}
              </p>
            );
          })}
          <Button variant="primary" disabled={ocupado || vazio} onClick={enviar}>
            {ocupado ? "Enviando…" : "Importar com IA"}
          </Button>
        </section>
      )}

      {job && (
        <Progresso
          job={job}
          ocupado={ocupado}
          limiteUsd={estado.limites.confirmar_acima_usd}
          onConfirmarCusto={() =>
            void executar(async () => {
              await confirmarCustoDaIA(carteira, job.id);
              acompanhar(job.id);
            })
          }
          onCancelar={() =>
            void executar(async () => {
              await cancelarJobDaIA(carteira, job.id);
            })
          }
          onNovo={() => {
            fechar.current?.();
            setJob(null);
          }}
        />
      )}

      {erro && emAndamento && (
        <p role="alert" className="m-0 text-sm text-down">
          {erro}
        </p>
      )}

      {job?.arquivos
        .filter((a) => a.tem_resultado && a.estado === "pronto")
        .map((a) => (
          <RevisaoDoArquivo
            key={`${job.id}-${a.indice}`}
            carteira={carteira}
            job={job.id}
            indice={a.indice}
            modelos={estado.modelos.map((m) => m.modelo)}
            modeloAtual={estado.modelo ?? ""}
            ocupado={ocupado || emAndamento}
            onReprocessar={(c) =>
              void executar(async () => {
                await reprocessarNaIA(carteira, job.id, { indice: a.indice, ...c });
                acompanhar(job.id);
              })
            }
            onImportado={onImportado}
          />
        ))}
    </div>
  );
}

function Progresso({
  job,
  ocupado,
  limiteUsd,
  onConfirmarCusto,
  onCancelar,
  onNovo,
}: {
  job: JobNaTela;
  ocupado: boolean;
  limiteUsd: number;
  onConfirmarCusto: () => void;
  onCancelar: () => void;
  onNovo: () => void;
}) {
  const terminado = TERMINAIS.includes(job.status);
  return (
    <section
      aria-label="Progresso da importação"
      className="flex flex-col gap-2 text-[13px]"
    >
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {job.arquivos.map((a) => (
          <li key={a.indice} className="flex flex-wrap justify-between gap-2">
            <span>
              <span className="font-mono">{a.nome}</span>
              {a.corretora && <span className="text-text-3"> ({a.corretora})</span>}
              {a.estrategia && (
                <span className="text-text-3">
                  , {ROTULO_DA_ESTRATEGIA[a.estrategia]}
                </span>
              )}
            </span>
            <span
              aria-label={`Etapa de ${a.nome}`}
              className={a.estado === "falhou" ? "text-down" : "text-text-2"}
            >
              {a.estado === "falhou" ? a.erro : textoDoProgresso(a)}
              {a.estimativa?.custo_estimado && a.estado !== "pronto"
                ? `, ~${custoNaTela(a.estimativa.custo_estimado)}`
                : ""}
            </span>
          </li>
        ))}
      </ul>
      {job.status === "aguardando_confirmacao" && (
        <div className="flex flex-col gap-2 rounded-control border border-border p-3">
          <p className="m-0">
            Custo estimado:{" "}
            <strong>{custoNaTela(job.estimativa?.custo_estimado ?? null)}</strong>, acima
            do limite de {custoNaTela(limiteUsd.toFixed(2))} que pede confirmação. O valor
            real vem do provedor e entra no consumo do mês.
          </p>
          <span className="flex gap-2">
            <Button variant="primary" disabled={ocupado} onClick={onConfirmarCusto}>
              Continuar
            </Button>
            <Button disabled={ocupado} onClick={onCancelar}>
              Cancelar
            </Button>
          </span>
        </div>
      )}
      {job.erro && (
        <p role="alert" className="m-0 text-sm text-down">
          {job.erro}
        </p>
      )}
      {!terminado && job.status !== "aguardando_confirmacao" && (
        <p className="m-0 flex flex-wrap items-center gap-2 text-xs text-text-3">
          Pode fechar a página: a importação continua e aparece aqui quando você voltar.
          <Button disabled={ocupado} onClick={onCancelar}>
            Cancelar
          </Button>
        </p>
      )}
      {terminado && (
        <p className="m-0 text-xs text-text-3">
          {job.status === "cancelado" ? "Importação cancelada." : "Leitura concluída."}{" "}
          <button type="button" className="text-link underline" onClick={onNovo}>
            Nova importação
          </button>
        </p>
      )}
    </section>
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
        de fundo e códigos de ativo ficam. Página escaneada é lida por OCR aqui no
        servidor e anonimizada como o resto; com um modelo que vê imagens, você pode
        escolher mandar a imagem, que não tem como ser anonimizada.
      </p>
      <p className="m-0">
        A IA só propõe linhas. Nada entra na carteira sem a sua confirmação. O arquivo
        fica no servidor só enquanto a importação pode ser reprocessada: sai na
        confirmação, no cancelamento ou em 24 horas. Fica o resultado da extração e o
        relatório; o arquivo original, só se você pedir. Tudo sai com a exclusão da conta.
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

interface PropsDaRevisao {
  carteira: string;
  job: string;
  indice: number;
  modelos: string[];
  modeloAtual: string;
  ocupado: boolean;
  onReprocessar: (c: { lotes?: number[]; modelo?: string }) => void;
  onImportado: () => void;
}

function RevisaoDoArquivo(props: PropsDaRevisao) {
  const [resultado, setResultado] = useState<ResultadoNaTela | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    resultadoDoArquivo(props.carteira, props.job, props.indice)
      .then(setResultado)
      .catch((e: Error) => setErro(e.message));
  }, [props.carteira, props.job, props.indice]);
  if (erro)
    return (
      <p role="alert" className="m-0 text-sm text-down">
        {erro}
      </p>
    );
  if (!resultado) return <p className="m-0 text-sm text-text-3">Carregando a revisão…</p>;
  return <RevisaoDaIA {...props} resultado={resultado} />;
}

function RevisaoDaIA({
  carteira,
  job,
  resultado: r,
  modelos,
  modeloAtual,
  ocupado,
  onReprocessar,
  onImportado,
}: PropsDaRevisao & { resultado: ResultadoNaTela }) {
  const v = r.validacao;
  const [linhas, setLinhas] = useState<LinhaProposta[]>(v.linhas);
  const [marcadas, setMarcadas] = useState<Set<string>>(
    new Set(v.linhas.filter((l) => l.marcada).map((l) => l.id)),
  );
  const [origem, setOrigem] = useState<LinhaProposta | null>(null);
  const [revisao, setRevisao] = useState<RevisaoDeCarga | null>(null);
  const [aceitar, setAceitar] = useState(false);
  const [outro, setOutro] = useState(r.modelo || modeloAtual);
  const [relatorio, setRelatorio] = useState<RelatorioNaTela | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const origemRef = useRef<HTMLDivElement>(null);

  const selecionadas: LinhaEditada[] = linhas
    .filter((l) => marcadas.has(l.id))
    .map((l) => ({ id: l.id, tipo: l.tipo, dados: l.dados }));
  const conciliacao = conciliacaoDaSelecao(selecionadas, v.documento.totais_declarados);
  const divergente =
    conciliacao.some((c) => c.declarado !== null && !c.conciliada) ||
    v.notas.some((n) => !n.conciliada);
  const soTransacoes = !selecionadas.some((l) => l.tipo === "posicao");
  const marcaveis = linhas.filter((l) => l.grupo !== "a_receber").map((l) => l.id);

  function editar(id: string, campo: string, valor: string) {
    setLinhas((ls) =>
      ls.map((l) => (l.id === id ? { ...l, dados: { ...l.dados, [campo]: valor } } : l)),
    );
    setRevisao(null);
  }

  function marcar(ids: string[], sim: boolean) {
    const novo = new Set(marcadas);
    for (const id of ids) {
      if (sim) novo.add(id);
      else novo.delete(id);
    }
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
          job_id: job,
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
            {r.provedor}/{r.modelo}, {ROTULO_DA_ESTRATEGIA[r.estrategia]},{" "}
            {r.do_cache ? "do cache, sem custo" : custoNaTela(r.custo_estimado)}
            {r.correcao.recuperadas > 0 &&
              `, ${r.correcao.recuperadas} linha(s) corrigida(s) automaticamente`}
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
          <Button disabled={ocupado} onClick={() => onReprocessar({ modelo: outro })}>
            {outro === r.modelo ? "Reprocessar" : "Reprocessar com outro modelo"}
          </Button>
        </span>
      </header>

      {r.lotes_falhos.length > 0 && (
        <div role="alert" className="flex flex-col gap-1 text-[13px] text-down">
          {r.lotes_falhos.map((l) => (
            <p key={l.indice} className="m-0">
              Lote {l.indice + 1} ({l.origens.join(", ")}): {l.motivo}
            </p>
          ))}
          <Button
            disabled={ocupado}
            onClick={() => onReprocessar({ lotes: r.lotes_falhos.map((l) => l.indice) })}
          >
            Reprocessar lote{r.lotes_falhos.length > 1 ? "s" : ""}
          </Button>
        </div>
      )}

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
          {conciliacao.map((c) => {
            const secoes =
              v.conciliacao.find((x) => x.corretora === c.corretora)?.secoes ?? [];
            return (
              <div key={c.corretora} className="flex flex-col gap-0.5">
                <p className="m-0 flex flex-wrap justify-between gap-2">
                  <span>{c.corretora}</span>
                  <span className="font-mono">
                    linhas marcadas {formatarDinheiro(c.soma)};{" "}
                    {c.declarado === null ? (
                      <span className="text-text-3">sem total para conferir</span>
                    ) : (
                      <>
                        documento {formatarDinheiro(c.declarado)} ({c.descricao ?? ""}){" "}
                        <span className={c.conciliada ? "text-up" : "text-down"}>
                          {c.conciliada ? "conciliado" : "não conciliado"}
                        </span>
                      </>
                    )}
                  </span>
                </p>
                {!c.conciliada &&
                  secoes
                    .filter((s) => !s.confere)
                    .map((s) => (
                      <p key={s.secao} className="m-0 text-xs text-warn">
                        {s.secao}: documento {formatarDinheiro(s.declarado)}, linhas{" "}
                        {formatarDinheiro(s.soma)} (
                        {Number(s.diferenca) < 0 ? "faltam" : "sobram"}{" "}
                        {formatarDinheiro(String(Math.abs(Number(s.diferenca))))}).
                        Confira essa seção.
                      </p>
                    ))}
              </div>
            );
          })}
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

      {marcaveis.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="text-text-3">
            {selecionadas.length} de {marcaveis.length} linhas marcadas
          </span>
          <button
            type="button"
            className="text-link underline"
            onClick={() => marcar(marcaveis, true)}
          >
            Marcar todas
          </button>
          <button
            type="button"
            className="text-link underline"
            onClick={() => marcar(marcaveis, false)}
          >
            Desmarcar todas
          </button>
        </div>
      )}

      {GRUPOS.map((grupo) => {
        const doGrupo = linhas.filter((l) => l.grupo === grupo);
        if (doGrupo.length === 0) return null;
        return (
          <section
            key={grupo}
            aria-label={ROTULO_DO_GRUPO[grupo]}
            className="flex flex-col gap-1.5"
          >
            <h3 className="m-0 text-[13px] font-semibold">
              {ROTULO_DO_GRUPO[grupo]} ({doGrupo.length})
            </h3>
            {grupo === "preenchida" && (
              <p className="m-0 text-xs text-text-3">
                Os campos em destaque não estavam no documento e foram preenchidos pela
                política de padrões (IR e IOF zero, quantidade 1 em renda fixa, data do
                documento...). Confira.
              </p>
            )}
            {grupo === "a_receber" && (
              <p className="m-0 text-xs text-text-3">
                Proventos provisionados no documento, com pagamento ainda por vir. Não
                entram na carteira agora: importe o extrato depois do pagamento.
              </p>
            )}
            <TabelaDeLinhas
              linhas={doGrupo}
              marcadas={marcadas}
              onMarcar={(ids, sim) => marcar(ids, sim)}
              onEditar={editar}
              onOrigem={(l) => {
                setOrigem(l);
                origemRef.current?.scrollIntoView({ block: "nearest" });
              }}
            />
          </section>
        );
      })}

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
          <summary>
            Recusadas por não aparecerem no documento ({v.rejeicoes.length})
          </summary>
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

      {divergente && (
        <Switch
          checked={aceitar}
          onCheckedChange={setAceitar}
          label="Os totais não batem com o documento. Conferi os valores e quero importar assim."
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
            divergente && !aceitar ? "Confirme a carga não conciliada acima." : null
          }
          onConfirmar={confirmar}
        />
      ) : soTransacoes ? (
        <Button
          variant="primary"
          disabled={enviando || selecionadas.length === 0 || (divergente && !aceitar)}
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

function TabelaDeLinhas({
  linhas,
  marcadas,
  onMarcar,
  onEditar,
  onOrigem,
}: {
  linhas: LinhaProposta[];
  marcadas: Set<string>;
  onMarcar: (ids: string[], sim: boolean) => void;
  onEditar: (id: string, campo: string, valor: string) => void;
  onOrigem: (l: LinhaProposta) => void;
}) {
  const ids = linhas.filter((l) => l.grupo !== "a_receber").map((l) => l.id);
  const todas = ids.length > 0 && ids.every((id) => marcadas.has(id));
  const algumas = !todas && ids.some((id) => marcadas.has(id));
  return (
    <div className="max-h-96 overflow-auto rounded-control border border-border">
      <table className="w-full border-collapse text-[12px]">
        <thead className="sticky top-0 bg-surface text-text-3">
          <tr>
            <th scope="col" className="p-2 text-left font-medium">
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  aria-label="Marcar todas do grupo"
                  checked={todas}
                  disabled={ids.length === 0}
                  ref={(el) => {
                    if (el) el.indeterminate = algumas;
                  }}
                  onChange={(e) => onMarcar(ids, e.target.checked)}
                />
                Importar
              </label>
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
                  disabled={l.grupo === "a_receber"}
                  onChange={(e) => onMarcar([l.id], e.target.checked)}
                />
              </td>
              <td className={`p-2 ${COR_DA_CONFIANCA[l.confianca]}`}>
                {ROTULO_DA_CONFIANCA[l.confianca]}
              </td>
              <td className="p-2">
                <div className="flex flex-wrap gap-1">
                  {camposDaLinha(l).map((c) => {
                    const preenchido = l.preenchidos.includes(c.campo);
                    const problema = l.problemas.includes(c.campo);
                    return (
                      <label
                        key={c.campo}
                        className="flex flex-col text-[11px] text-text-3"
                      >
                        {c.rotulo}
                        {preenchido && (
                          <span className="text-[10px] text-accent">
                            preenchido automaticamente
                          </span>
                        )}
                        <input
                          value={l.dados[c.campo] ?? ""}
                          aria-invalid={problema}
                          onChange={(e) => onEditar(l.id, c.campo, e.target.value)}
                          className={`w-28 rounded-control border px-1 py-0.5 font-mono text-[12px] text-text ${
                            problema
                              ? "border-down"
                              : preenchido
                                ? "border-accent bg-accent-tint"
                                : "border-border bg-surface"
                          }`}
                        />
                      </label>
                    );
                  })}
                </div>
                {l.motivo && <p className="m-0 mt-1 text-[11px] text-down">{l.motivo}</p>}
                {l.avisos.length > 0 && (
                  <p className="m-0 mt-1 text-[11px] text-warn">{l.avisos.join(" ")}</p>
                )}
              </td>
              <td className="p-2">
                <button
                  type="button"
                  onClick={() => onOrigem(l)}
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
  );
}
