"use client";

import { FileText, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  ImportacaoComLinhas,
  JobDeLeitura,
  LeituraDeFatura,
} from "@bolsiq/finance/puro";
import { Button, Card, Money, cn } from "@bolsiq/ui";
import { api } from "@/lib/api";
import type { EstadoDaImportacaoIA } from "@/lib/importacao-ia-modelo";
import { ROTULO_DO_ESTADO, TERMINAIS } from "@/lib/importacao-ia-modelo";
import { CAMPO } from "../conta/campos";
import { dataBr } from "./Cartoes";
import { ROTULO } from "./Contas";
import { SeletorDeDestino, useDestino } from "./Destino";

/**
 * Fatura e extrato em PDF ou foto (ADR 0040): a leitura com IA do assistente,
 * em segundo plano, com o atalho sem IA para os layouts de Nubank, Itau, Inter
 * e C6. O resultado entra na mesma revisao do OFX e do CSV.
 */

const ESTADO = ROTULO_DO_ESTADO as Record<string, string>;

const json = (method: string, corpo: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(corpo),
});

function etapa(a: JobDeLeitura["arquivos"][number]) {
  const p = a.progresso;
  if (a.estado === "analisando" && p?.total)
    return `IA lote ${p.feitos ?? 0} de ${p.total}`;
  return ESTADO[a.estado] ?? a.estado;
}

function Leitura({
  job,
  indice,
  onRevisao,
}: {
  job: string;
  indice: number;
  onRevisao: (i: ImportacaoComLinhas) => void;
}) {
  const [l, setL] = useState<LeituraDeFatura | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const destino = useDestino();
  const { sugerir } = destino;

  useEffect(() => {
    api<{ data: LeituraDeFatura }>(`financas/importacoes/ia/${job}/arquivos/${indice}`)
      .then(({ data }) => {
        setL(data);
        sugerir(data.sugestao);
      })
      .catch((e: Error) => setErro(e.message));
    // sugerir so usa setters estaveis do useState.
  }, [job, indice]);

  async function revisar() {
    setErro(null);
    setOcupado(true);
    try {
      const { data } = await api<{ data: ImportacaoComLinhas }>(
        `financas/importacoes/ia/${job}/arquivos/${indice}`,
        json("POST", destino.pedido()),
      );
      onRevisao(data);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  if (erro && !l)
    return (
      <p role="alert" className="m-0 text-sm text-down">
        {erro}
      </p>
    );
  if (!l) return <p className="m-0 text-sm text-text-3">Carregando a leitura…</p>;
  return (
    <section
      aria-label={`Leitura de ${l.nome}`}
      className="flex flex-col gap-3 rounded-control border border-border p-3"
    >
      <p className="m-0 text-sm">
        <span className="font-semibold">{l.nome}</span>
        <span className="text-text-3">
          {" · "}
          {l.tipo === "cartao" ? "fatura de cartão" : "extrato de conta"}
          {l.banco ? ` · ${l.banco}` : ""}
          {l.vencimento ? ` · vence ${dataBr(l.vencimento)}` : ""}
          {" · "}
          {l.linhas} {l.linhas === 1 ? "linha" : "linhas"}
          {" · "}
          {l.atalho ? "lida pelo layout do banco, sem IA" : "lida por IA"}
        </span>
        {l.total_informado && (
          <span className="block text-xs text-text-2">
            Total da fatura: <Money value={l.total_informado} />
          </span>
        )}
      </p>
      {l.avisos.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-xs text-warn">
          {l.avisos.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
      {l.rejeitadas.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-text-2">
            {l.rejeitadas.length}{" "}
            {l.rejeitadas.length === 1 ? "linha recusada" : "linhas recusadas"} (não estão
            no documento ou não são lançamento): lance à mão se precisar
          </summary>
          <ul className="m-0 mt-1 flex list-none flex-col gap-0.5 p-0">
            {l.rejeitadas.map((r, i) => (
              <li key={i}>
                <span className="font-mono">{r.trecho}</span>
                <span className="text-text-3"> · {r.motivo}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <SeletorDeDestino d={destino} sugestao={l.sugestao} />
      {erro && (
        <p role="alert" className="m-0 text-sm text-down">
          {erro}
        </p>
      )}
      <Button
        variant="primary"
        disabled={ocupado || l.linhas === 0 || !destino.completo}
        onClick={() => void revisar()}
      >
        <Upload aria-hidden="true" size={16} />
        Revisar linhas desta fatura
      </Button>
    </section>
  );
}

export function LeituraComIA({
  onRevisao,
}: {
  onRevisao: (i: ImportacaoComLinhas) => void;
}) {
  const [estado, setEstado] = useState<EstadoDaImportacaoIA | null>(null);
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [senha, setSenha] = useState("");
  const [aceitarImagem, setAceitarImagem] = useState(false);
  const [job, setJob] = useState<JobDeLeitura | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pedeSenha, setPedeSenha] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    api<{ data: EstadoDaImportacaoIA }>("assistente/importacao")
      .then(({ data }) => setEstado(data))
      .catch(() => setEstado(null));
  }, []);

  // Progresso por SSE; fecha quando a leitura termina.
  const id = job?.id;
  const terminado = job ? TERMINAIS.includes(job.status) : true;
  useEffect(() => {
    if (!id || terminado) return;
    const fonte = new EventSource(`/api/financas/importacoes/ia/${id}/eventos`);
    fonte.onmessage = (ev: MessageEvent<string>) => {
      const j = JSON.parse(ev.data) as JobDeLeitura;
      setJob(j);
      if (TERMINAIS.includes(j.status)) fonte.close();
    };
    return () => fonte.close();
  }, [id, terminado]);

  const temImagem = arquivos.some((a) => a.type.startsWith("image/"));

  async function ler() {
    setErro(null);
    setOcupado(true);
    const form = new FormData();
    for (const a of arquivos) form.append("arquivos", a);
    // A senha vale para todos os PDFs do envio; o servidor a usa so para abrir.
    if (senha)
      form.set(
        "senhas",
        JSON.stringify(Object.fromEntries(arquivos.map((a) => [a.name, senha]))),
      );
    form.set("aceitar_imagem", aceitarImagem ? "true" : "false");
    try {
      const { data } = await api<{ data: { job_id: string } }>(
        "financas/importacoes/ia",
        {
          method: "POST",
          body: form,
        },
      );
      setSenha("");
      setPedeSenha(false);
      setJob({
        id: data.job_id,
        status: "lendo",
        estimativa: null,
        erro: null,
        criado_em: new Date().toISOString(),
        arquivos: arquivos.map((a, indice) => ({
          indice,
          nome: a.name,
          estado: "pendente",
          progresso: null,
          estrategia: null,
          erro: null,
          tem_resultado: false,
          tem_arquivo: true,
        })),
      });
    } catch (e) {
      const codigo = (e as { codigo?: string }).codigo;
      if (codigo === "precisa_senha" || codigo === "senha_incorreta") setPedeSenha(true);
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function acao(qual: "confirmar" | "cancelar") {
    if (!job) return;
    setErro(null);
    try {
      await api<null>(`financas/importacoes/ia/${job.id}/${qual}`, { method: "POST" });
      if (qual === "cancelar") setJob({ ...job, status: "cancelado" });
      else setJob({ ...job, status: "lendo" });
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  const configurado = estado?.configurado && estado.pode_importar;
  return (
    <Card title="Fatura em PDF ou foto">
      <div className="flex flex-col gap-4">
        <p className="m-0 text-xs text-text-3">
          Fatura do Nubank, Itaú, Inter e C6 em PDF é lida direto, sem IA. De outro banco,
          ou em foto, a leitura usa o modelo configurado no assistente, com os seus dados
          pessoais removidos antes do envio. Tudo cai na mesma revisão: nada é gravado sem
          a sua confirmação.
        </p>
        {estado && !configurado && (
          <p className="m-0 text-sm text-text-2">
            Para ler PDF e foto, configure um modelo em{" "}
            <a href="/configuracoes/assistente">Configurações do assistente</a>.
          </p>
        )}
        {estado && configurado && !estado.consentiu && (
          <div className="flex flex-col gap-2 text-sm text-text-2">
            <p className="m-0">
              O texto da fatura, sem CPF, conta, nome e endereço, vai ao provedor do
              modelo quando o layout do banco não é conhecido. A IA só propõe linhas.
            </p>
            <Button
              variant="secondary"
              onClick={() =>
                void api<{ data: EstadoDaImportacaoIA }>(
                  "assistente/importacao",
                  json("POST", { guardar_original: false }),
                )
                  .then(({ data }) => setEstado(data))
                  .catch((e: Error) => setErro(e.message))
              }
            >
              Concordo e quero ler com IA
            </Button>
          </div>
        )}
        {estado && configurado && estado.consentiu && (
          <>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className={ROTULO}>
                PDF ou foto da fatura
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,application/pdf,image/*"
                  multiple
                  className={cn(CAMPO, "py-1.5")}
                  onChange={(e) => {
                    setArquivos(Array.from(e.target.files ?? []));
                    setJob(null);
                    setErro(null);
                  }}
                />
              </label>
              <label className={ROTULO}>
                Senha do PDF (se tiver)
                <input
                  type="password"
                  autoComplete="off"
                  className={CAMPO}
                  value={senha}
                  aria-invalid={pedeSenha}
                  onChange={(e) => setSenha(e.target.value)}
                />
                <span className="text-xs text-text-3">
                  Muitos bancos usam os primeiros dígitos do CPF. Usada só para abrir o
                  arquivo: não é gravada.
                </span>
              </label>
            </div>
            {temImagem && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={aceitarImagem}
                  onChange={(e) => setAceitarImagem(e.target.checked)}
                />
                Aceito enviar a foto ao provedor como imagem (sem como tirar dados
                pessoais)
              </label>
            )}
            <Button
              variant="primary"
              disabled={ocupado || arquivos.length === 0 || (job !== null && !terminado)}
              onClick={() => void ler()}
            >
              <FileText aria-hidden="true" size={16} />
              Ler fatura
            </Button>
          </>
        )}
        {erro && (
          <p role="alert" className="m-0 text-sm text-down">
            {erro}
          </p>
        )}
        {job && (
          <section aria-label="Progresso da leitura" className="flex flex-col gap-2">
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
              {job.arquivos.map((a) => (
                <li key={a.indice} className="flex flex-wrap gap-2">
                  <span className="font-semibold">{a.nome}</span>
                  <span aria-label={`Etapa de ${a.nome}`} className="text-text-3">
                    {etapa(a)}
                  </span>
                  {a.erro && <span className="text-down">{a.erro}</span>}
                </li>
              ))}
            </ul>
            {job.status === "aguardando_confirmacao" && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span>
                  Custo estimado da leitura: US${" "}
                  {Number(job.estimativa?.custo_estimado ?? 0).toFixed(2)}.
                </span>
                <Button variant="secondary" onClick={() => void acao("confirmar")}>
                  Confirmar e ler
                </Button>
              </div>
            )}
            {!terminado && (
              <Button variant="ghost" onClick={() => void acao("cancelar")}>
                Cancelar leitura
              </Button>
            )}
            {job.erro && <p className="m-0 text-sm text-down">{job.erro}</p>}
            {job.status === "pronto" &&
              job.arquivos
                .filter((a) => a.tem_resultado && a.estado === "pronto")
                .map((a) => (
                  <Leitura
                    key={a.indice}
                    job={job.id}
                    indice={a.indice}
                    onRevisao={onRevisao}
                  />
                ))}
          </section>
        )}
      </div>
    </Card>
  );
}
