import { describe, expect, it } from "vitest";
import {
  armazemEmMemoria,
  CAPACIDADES_COMPLETAS,
  ferramentasDaFixture,
  modeloDeRoteiro,
  verificadorDasFixtures,
} from "../../eval/importacao/executar.js";
import { FIXTURES, HOJE } from "../../eval/importacao/fixtures.js";
import type { Entrada } from "./pipeline.js";
import {
  executarJob,
  type ArquivoDoJob,
  type CamposDoArquivo,
  type DependenciasDoJob,
  type JobDeImportacao,
  type RepositorioDeJobs,
} from "./job.js";

const porId = (id: string) => FIXTURES.find((f) => f.id === id)!;
const bytesDe = (e: Entrada) =>
  "bytes" in e
    ? e
    : { nome: "x.txt", mime: "text/plain", bytes: new TextEncoder().encode(e.texto) };

/** O job em memoria, com o historico de cada arquivo para conferir o progresso. */
function repoEmMemoria(ids: string[], job: Partial<JobDeImportacao> = {}) {
  const estado: JobDeImportacao = {
    id: "job-1",
    status: "lendo",
    aceitou_imagem: true,
    confirmado: false,
    cancelado: false,
    ...job,
  };
  const arquivos: (ArquivoDoJob & CamposDoArquivo)[] = ids.map((id, indice) => {
    const f = porId(id);
    const e = bytesDe(f.arquivo());
    return {
      indice,
      nome: e.nome,
      mime: e.mime,
      corretora: f.corretora ?? null,
      dados: e.bytes,
      estado: "pendente",
    };
  });
  const historico: { indice: number; estado?: string; etapa?: string }[] = [];
  const statusDoJob: string[] = [];
  const repo: RepositorioDeJobs = {
    job: () => Promise.resolve({ ...estado }),
    arquivos: () => Promise.resolve(arquivos.map((a) => ({ ...a }))),
    atualizarJob: (c) => {
      Object.assign(estado, c);
      if (c.status) statusDoJob.push(c.status);
      return Promise.resolve();
    },
    atualizarArquivo: (indice, c) => {
      const a = arquivos[indice];
      if (a) Object.assign(a, c);
      historico.push({
        indice,
        ...(c.estado ? { estado: c.estado } : {}),
        ...(c.progresso?.etapa ? { etapa: c.progresso.etapa } : {}),
      });
      return Promise.resolve();
    },
  };
  return { repo, estado, arquivos, historico, statusDoJob };
}

function dependencias(
  repo: RepositorioDeJobs,
  resposta = porId("santander-coe").resposta,
  extra: Partial<DependenciasDoJob> = {},
): DependenciasDoJob {
  return {
    repo,
    acesso: {
      modelo: modeloDeRoteiro(resposta),
      provedor: "roteiro",
      nome_do_modelo: "roteiro",
      preco: { entrada: 1, saida: 2 },
      capacidades: CAPACIDADES_COMPLETAS,
      segredos: [],
      guardar_original: false,
    },
    armazem: armazemEmMemoria().armazem,
    verificador: verificadorDasFixtures(),
    ferramentas: ferramentasDaFixture(porId("santander-coe")),
    hoje: HOJE,
    limite_diario: 100,
    confirmar_acima_usd: 10,
    espera_base_ms: 1,
    conferir_cancelamento_ms: 5,
    ...extra,
  };
}

describe("job de importacao em segundo plano", () => {
  it("le, estima, extrai e deixa o resultado de cada arquivo, com o progresso gravado", async () => {
    const m = repoEmMemoria(["santander-coe", "csv-baguncado"]);
    await executarJob(dependencias(m.repo));
    expect(m.statusDoJob).toEqual(["extraindo", "pronto"]);
    expect(m.arquivos.map((a) => a.estado)).toEqual(["pronto", "pronto"]);
    expect(m.arquivos[0]?.resultado?.validacao.linhas).toHaveLength(2);
    expect(m.arquivos[0]?.estimativa?.chamadas).toBeGreaterThan(0);
    const etapas = m.historico
      .filter((h) => h.indice === 0)
      .map((h) => h.estado ?? h.etapa);
    expect(etapas).toEqual(
      expect.arrayContaining(["lendo", "pendente", "analisando", "validando", "pronto"]),
    );
  });

  it("progresso que grava devagar nao sobrescreve o pronto", async () => {
    const m = repoEmMemoria(["santander-coe"]);
    const gravar = m.repo.atualizarArquivo.bind(m.repo);
    m.repo.atualizarArquivo = (indice, c) =>
      c.progresso
        ? new Promise((ok) => setTimeout(() => void gravar(indice, c).then(ok), 30))
        : gravar(indice, c);
    await executarJob(dependencias(m.repo));
    await new Promise((ok) => setTimeout(ok, 100));
    expect(m.arquivos[0]?.estado).toBe("pronto");
    expect(m.arquivos[0]?.progresso).toBeNull();
  });

  it("acima do limite de custo, para e espera a confirmacao; confirmado, segue", async () => {
    const m = repoEmMemoria(["santander-coe"]);
    await executarJob(dependencias(m.repo, undefined, { confirmar_acima_usd: 0 }));
    expect(m.estado.status).toBe("aguardando_confirmacao");
    expect(m.arquivos[0]?.resultado).toBeUndefined();
    m.estado.confirmado = true;
    await executarJob(dependencias(m.repo, undefined, { confirmar_acima_usd: 0 }));
    expect(m.estado.status).toBe("pronto");
    expect(m.arquivos[0]?.estado).toBe("pronto");
  });

  it("cancelado no meio, para e marca", async () => {
    const m = repoEmMemoria(["extrato-110-paginas"]);
    const f = porId("extrato-110-paginas");
    const d = dependencias(m.repo, f.resposta, {
      acesso: {
        ...dependencias(m.repo).acesso,
        modelo: modeloDeRoteiro(f.resposta, { falhar: { vezes: 3, status: 503 } }),
        capacidades: { ...CAPACIDADES_COMPLETAS, max_saida: 2_000 },
      },
      espera_base_ms: 50,
    });
    const rodando = executarJob(d);
    setTimeout(() => {
      m.estado.cancelado = true;
    }, 20);
    await rodando;
    expect(m.estado.status).toBe("cancelado");
    expect(m.arquivos[0]?.estado).toBe("cancelado");
  });

  it("arquivo ilegivel falha sozinho, com mensagem em portugues; o resto segue", async () => {
    const m = repoEmMemoria(["santander-coe", "santander-coe"]);
    m.arquivos[1]!.nome = "estranho.exe";
    await executarJob(dependencias(m.repo));
    expect(m.arquivos.map((a) => a.estado)).toEqual(["pronto", "falhou"]);
    expect(m.arquivos[1]?.erro).toMatch(/^Tipo de arquivo não aceito/);
    expect(m.estado.status).toBe("pronto");
  });

  it("todos falham na leitura: o job falha", async () => {
    const m = repoEmMemoria(["santander-coe"]);
    m.arquivos[0]!.nome = "x.exe";
    await executarJob(dependencias(m.repo));
    expect(m.estado.status).toBe("falhou");
  });

  it("job cancelado antes de comecar nao faz nada", async () => {
    const m = repoEmMemoria(["santander-coe"], { cancelado: true });
    await executarJob(dependencias(m.repo));
    expect(m.historico).toEqual([]);
  });

  it("reprocessar refaz so o arquivo pedido, sem cache", async () => {
    const m = repoEmMemoria(["santander-coe", "csv-baguncado"], { confirmado: true });
    const d = dependencias(m.repo);
    await executarJob(d);
    m.historico.length = 0;
    await executarJob(d, { reprocessar: { indice: 1 } });
    expect(new Set(m.historico.map((h) => h.indice))).toEqual(new Set([1]));
    expect(m.arquivos[1]?.estado).toBe("pronto");
  });
});
