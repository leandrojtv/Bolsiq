import { describe, expect, it } from "vitest";
import {
  armazemEmMemoria,
  CAPACIDADES_COMPLETAS,
  modeloDeRoteiro,
  verificadorDasFixtures,
} from "../../eval/importacao/executar.js";
import { ferramentasDeFinancas } from "../../eval/importacao/executar-financas.js";
import { HOJE } from "../../eval/importacao/fixtures.js";
import {
  FATURA_INTER,
  FATURA_NUBANK,
  FATURA_SANTANDER,
  type FixtureDeFinancas,
} from "../../eval/importacao/fixtures-financas.js";
import { abrirArquivosDoEnvio, type ArquivoAberto } from "./envio.js";
import { SenhaIncorreta, type FerramentasDoSistema } from "./ferramentas.js";
import {
  executarJob,
  type ArquivoDoJob,
  type CamposDoArquivo,
  type JobDeImportacao,
  type RepositorioDeJobs,
} from "./job.js";
import { extratoDaLeitura, type ResultadoDaLeituraFinancas } from "./servico-financas.js";

/**
 * O job do Bolsiq Financas (ADR 0040) com o provedor falso do eval: o mesmo
 * executarJob da carteira, com `documento = financas`. Tudo o que o job grava
 * fica em `escrito`, para conferir que a senha do PDF nao chega a ele.
 */
function repo(abertos: ArquivoAberto[]) {
  const estado: JobDeImportacao = {
    id: "job-f",
    documento: "financas",
    status: "lendo",
    aceitou_imagem: false,
    confirmado: false,
    cancelado: false,
  };
  const arquivos: (ArquivoDoJob & CamposDoArquivo)[] = abertos.map((a, indice) => ({
    indice,
    nome: a.nome,
    mime: a.mime,
    corretora: null,
    dados: a.bytes,
    estado: "pendente",
  }));
  const escrito: string[] = [];
  const r: RepositorioDeJobs = {
    job: () => Promise.resolve({ ...estado }),
    arquivos: () => Promise.resolve(arquivos.map((a) => ({ ...a }))),
    atualizarJob: (c) => {
      escrito.push(JSON.stringify(c));
      Object.assign(estado, c);
      return Promise.resolve();
    },
    atualizarArquivo: (i, c) => {
      escrito.push(JSON.stringify(c));
      Object.assign(arquivos[i] ?? {}, c);
      return Promise.resolve();
    },
  };
  return { repo: r, estado, arquivos, escrito };
}

const enviado = (f: FixtureDeFinancas, senha = "") => {
  const e = f.arquivo();
  if (!("bytes" in e)) throw new Error("fixture sem arquivo");
  return { ...e, corretora: "", senha };
};

function dependencias(
  r: RepositorioDeJobs,
  resposta = FATURA_SANTANDER.resposta,
  log: string[] = [],
  ferramentas: FerramentasDoSistema = {},
) {
  return {
    repo: r,
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
    ferramentas,
    hoje: HOJE,
    limite_diario: 100,
    confirmar_acima_usd: 10,
    espera_base_ms: 1,
    conferir_cancelamento_ms: 5,
    aoErrar: (d: string) => log.push(d),
  };
}

describe("job de faturas e extratos (Financas)", () => {
  it("fatura sem layout vai pela IA; a de layout conhecido, pelo atalho", async () => {
    const { abertos } = await abrirArquivosDoEnvio(
      [enviado(FATURA_SANTANDER), enviado(FATURA_NUBANK)],
      {},
      { limite_mb: 50, documento: "financas" },
    );
    const m = repo(abertos);
    await executarJob(dependencias(m.repo));
    expect(m.estado.status).toBe("pronto");
    const [santander, nubank] = m.arquivos.map(
      (a) => a.resultado as ResultadoDaLeituraFinancas,
    );
    expect(santander).toMatchObject({ documento: "financas", atalho: false });
    expect(nubank).toMatchObject({ documento: "financas", atalho: true });
    expect(santander?.validacao.conferencia?.confere).toBe(true);

    // O que vai para a revisao do Financas: o mesmo ExtratoLido do OFX e do CSV.
    const e = extratoDaLeitura(nubank!);
    expect(e).toMatchObject({
      formato: "pdf-layout",
      tipo: "cartao",
      banco: "Nubank",
      vencimento: "2026-11-15",
      total_informado: "746.50",
    });
    expect(e.linhas.find((l) => l.marcacao === "pagamento")?.sentido).toBe("credito");
    expect(e.linhas.find((l) => l.moeda_original)).toMatchObject({
      moeda_original: "USD",
      valor_moeda_original: "10.00",
    });
  });

  it("CSV no job do Financas e recusado: vai pela importacao sem IA", async () => {
    await expect(
      abrirArquivosDoEnvio(
        [
          {
            nome: "fatura.csv",
            mime: "text/csv",
            bytes: new TextEncoder().encode("date,title,amount\n2026-10-01,X,1.00"),
            corretora: "",
            senha: "",
          },
        ],
        {},
        { limite_mb: 50, documento: "financas" },
      ),
    ).rejects.toMatchObject({ codigo: "use_sem_ia" });
  });
});

describe("PDF com senha", () => {
  const SENHA = FATURA_INTER.senha as string;

  it("sem senha, pede; senha errada, recusa sem repetir a senha", async () => {
    const f = ferramentasDeFinancas(FATURA_INTER);
    await expect(
      abrirArquivosDoEnvio([enviado(FATURA_INTER)], f, {
        limite_mb: 50,
        documento: "financas",
      }),
    ).rejects.toMatchObject({ codigo: "precisa_senha" });
    const errada = "99999";
    const erro = await abrirArquivosDoEnvio([enviado(FATURA_INTER, errada)], f, {
      limite_mb: 50,
      documento: "financas",
    }).catch((e: Error) => e);
    expect(erro).toMatchObject({ codigo: "senha_incorreta" });
    expect(`${JSON.stringify(erro)} ${(erro as Error).message}`).not.toContain(errada);
  });

  it("a senha abre o PDF em memoria e nunca chega ao job, ao banco nem ao log", async () => {
    const recebidas: string[] = [];
    const base = ferramentasDeFinancas(FATURA_INTER);
    const ferramentas: FerramentasDoSistema = {
      decifrarPdf: (pdf, senha) => {
        recebidas.push(senha);
        return base.decifrarPdf!(pdf, senha);
      },
    };
    const { abertos } = await abrirArquivosDoEnvio(
      [enviado(FATURA_INTER, SENHA)],
      ferramentas,
      { limite_mb: 50, documento: "financas" },
    );
    expect(recebidas).toEqual([SENHA]);
    // O que vai para o job nao tem o campo da senha.
    expect(abertos.every((a) => !("senha" in a))).toBe(true);

    const log: string[] = [];
    const m = repo(abertos);
    // O worker nao recebe a senha: nem nas ferramentas, nem nos dados do job.
    await executarJob(
      dependencias(m.repo, FATURA_INTER.resposta, log, {
        decifrarPdf: () => Promise.reject(new SenhaIncorreta()),
      }),
    );
    expect(m.estado.status).toBe("pronto");
    const r = m.arquivos[0]?.resultado as ResultadoDaLeituraFinancas;
    expect(r.atalho).toBe(true);
    expect(r.validacao.linhas).toHaveLength(4);
    const tudo = [
      ...m.escrito,
      ...log,
      JSON.stringify(m.arquivos.map((a) => ({ ...a, dados: null }))),
    ].join("\n");
    expect(tudo).not.toContain(SENHA);
  });
});
