import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { comoUsuario } from "../db/sessao.js";
import {
  criarConta,
  criarLancamento,
  editarLancamento,
  listarCategorias,
  listarLancamentos,
  semearCategorias,
  type Tx,
} from "../db/operacoes.js";
import { criarCartao, listarFaturas } from "../db/cartoes.js";
import { listarPlanos } from "../db/parcelamentos.js";
import {
  analisarArquivos,
  confirmarImportacao,
  criarImportacao,
  desfazerImportacao,
  editarLinha,
  listarRegras,
  criarRegra,
  obterImportacao,
  cancelarImportacao,
  type ArquivoRecebido,
} from "../db/importacao.js";
import { FiltroDeLancamentos, NovaConta, NovoLancamento } from "../contratos.js";
import { NovaImportacao, NovaRegra, NovoCartao } from "../contratos-importacao.js";

const HOST = process.env.TEST_HOST ?? "127.0.0.1";
const HOJE = "2023-11-30";
const A = "user-aaa";
const B = "user-bbb";

let container: StartedTestContainer;
let dono: Pool;
let app: Pool;
let db: NodePgDatabase<Record<string, unknown>>;
let contaA = "";
let cartaoA = "";
let categoria: (nome: string) => string = () => "";

const comoA = <T>(f: (tx: Tx) => Promise<T>) => comoUsuario(db, A, f);
const fixture = (nome: string): ArquivoRecebido => ({
  nome,
  bytes: new Uint8Array(
    readFileSync(resolve(import.meta.dirname, "../importacao/fixtures", nome)),
  ),
});
const texto = (nome: string, conteudo: string): ArquivoRecebido => ({
  nome,
  bytes: new TextEncoder().encode(conteudo),
});
const lancamentosDa = (importacao: string) =>
  comoA((tx) =>
    listarLancamentos(tx, A, FiltroDeLancamentos.parse({ importacao, por_pagina: 200 })),
  );

async function cruComoB(sql: string, params: unknown[] = []) {
  const c = await app.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('bolsiq.user_id', $1, true)", [B]);
    try {
      return await c.query(sql, params);
    } finally {
      await c.query("ROLLBACK");
    }
  } finally {
    c.release();
  }
}

beforeAll(async () => {
  container = await new GenericContainer("timescale/timescaledb-ha:pg17")
    .withEnvironment({
      POSTGRES_USER: "dono",
      POSTGRES_PASSWORD: "dono",
      POSTGRES_DB: "ci",
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forSuccessfulCommand("pg_isready -h 127.0.0.1 -p 5432"))
    .withStartupTimeout(120_000)
    .start();
  const porta = container.getMappedPort(5432);
  dono = new Pool({
    connectionString: `postgres://dono:dono@${HOST}:${porta}/ci`,
    max: 3,
  });
  const pasta = resolve(import.meta.dirname, "../../migrations");
  for (const arquivo of readdirSync(pasta)
    .filter((f) => f.endsWith(".sql"))
    .sort())
    for (const bloco of readFileSync(resolve(pasta, arquivo), "utf8").split(
      "--> statement-breakpoint",
    ))
      if (bloco.trim() !== "") await dono.query(bloco);
  await dono.query("ALTER ROLE bolsiq_app LOGIN PASSWORD 'app'");
  app = new Pool({
    connectionString: `postgres://bolsiq_app:app@${HOST}:${porta}/ci`,
    max: 2,
  });
  db = drizzle(dono);

  for (const u of [A, B]) await comoUsuario(db, u, (tx) => semearCategorias(tx, u));
  const cats = await comoA((tx) => listarCategorias(tx, A));
  categoria = (nome) => cats.find((c) => c.nome === nome)?.id ?? "";
  contaA = (
    await comoA((tx) =>
      criarConta(
        tx,
        A,
        NovaConta.parse({
          nome: "Itaú corrente",
          tipo: "corrente",
          instituicao: "Itaú",
          saldo_inicial: "0",
          data_saldo_inicial: "2023-11-01",
        }),
        HOJE,
      ),
    )
  ).id;
  await comoA((tx) =>
    criarConta(
      tx,
      A,
      NovaConta.parse({
        nome: "Nubank",
        tipo: "corrente",
        instituicao: "Nubank",
        data_saldo_inicial: "2023-11-01",
      }),
      HOJE,
    ),
  );
  cartaoA = (
    await comoA((tx) =>
      criarCartao(
        tx,
        A,
        NovoCartao.parse({
          nome: "Itaú Black",
          instituicao: "Itaú",
          final: "1234",
          dia_fechamento: 10,
          dia_vencimento: 17,
          account_id: contaA,
        }),
        HOJE,
      ),
    )
  ).id;
  await comoUsuario(db, B, (tx) =>
    criarConta(
      tx,
      B,
      NovaConta.parse({
        nome: "Do B",
        tipo: "corrente",
        data_saldo_inicial: "2023-11-01",
      }),
      HOJE,
    ),
  );
}, 180_000);

afterAll(async () => {
  await app?.end().catch(() => undefined);
  await dono?.end().catch(() => undefined);
  await container?.stop().catch(() => undefined);
});

describe("importacao de extrato de conta", () => {
  it("analisa e sugere a conta pelo banco e o cartao pelo final", async () => {
    const conta = await comoA((tx) =>
      analisarArquivos(tx, A, [fixture("itau-conta.ofx")]),
    );
    expect(conta.sugestao).toEqual({
      alvo: "conta",
      account_id: contaA,
      card_id: null,
      vencimento: null,
    });
    expect(conta.arquivos[0]).toMatchObject({ banco: "0341", linhas: 6 });
    const cartao = await comoA((tx) =>
      analisarArquivos(tx, A, [fixture("itau-cartao.ofx")]),
    );
    // Ultima compra 19/11, fechamento dia 10: fatura que vence em 17/12.
    expect(cartao.sugestao).toEqual({
      alvo: "cartao",
      account_id: null,
      card_id: cartaoA,
      vencimento: "2023-12-17",
    });
  });

  it("recusa cartao num destino de conta, e os limites", async () => {
    const pedido = NovaImportacao.parse({ alvo: "conta", account_id: contaA });
    await expect(
      comoA((tx) => criarImportacao(tx, A, pedido, [fixture("itau-cartao.ofx")])),
    ).rejects.toThrow(/de cartão/);
    await expect(
      comoA((tx) =>
        criarImportacao(tx, A, pedido, [fixture("itau-conta.ofx")], {
          bytes: 100,
          linhas: 10,
          arquivos: 5,
        }),
      ),
    ).rejects.toMatchObject({ status: 413 });
    await expect(
      comoA((tx) =>
        criarImportacao(tx, A, pedido, [fixture("itau-conta.ofx")], {
          bytes: 1e6,
          linhas: 3,
          arquivos: 5,
        }),
      ),
    ).rejects.toThrow(/limite é 3/);
    await expect(
      comoA((tx) => criarImportacao(tx, A, pedido, [texto("x.csv", "a;b")])),
    ).rejects.toThrow(/Formato não suportado/);
  });

  it("revisa, marca o pagamento de fatura como transferencia e confirma", async () => {
    const pedido = NovaImportacao.parse({ alvo: "conta", account_id: contaA });
    const rev = await comoA((tx) =>
      criarImportacao(tx, A, pedido, [fixture("itau-conta.ofx")]),
    );
    expect(rev.status).toBe("revisao");
    expect(rev.linhas.map((l) => l.situacao)).toEqual(Array(6).fill("nova"));
    expect(rev.totais).toMatchObject({
      linhas: 6,
      selecionadas: 6,
      total: "4099.89",
      duplicadas: 0,
    });
    // O saldo do extrato confere com o da conta depois de importar.
    expect(rev.conferencia).toEqual({
      data: "2023-11-30",
      saldo_informado: "4099.89",
      saldo_calculado: "4099.89",
      confere: true,
    });
    const fatura = rev.linhas.find((l) => l.sugere_transferencia);
    expect(fatura?.descricao_original).toMatch(/PAGTO FATURA/);
    const salario = rev.linhas[0]!;
    await comoA((tx) =>
      editarLinha(tx, A, rev.id, salario.id, { category_id: categoria("Salário") }),
    );
    const marcada = await comoA((tx) =>
      editarLinha(tx, A, rev.id, fatura!.id, { transferencia_cartao_id: cartaoA }),
    );
    expect(marcada.linhas.find((l) => l.id === fatura!.id)?.transferencia_cartao_id).toBe(
      cartaoA,
    );
    // Credito do extrato nao paga fatura.
    await expect(
      comoA((tx) =>
        editarLinha(tx, A, rev.id, salario.id, { transferencia_cartao_id: cartaoA }),
      ),
    ).rejects.toThrow(/débito/);

    const ok = await comoA((tx) => confirmarImportacao(tx, A, rev.id));
    expect(ok).toMatchObject({ status: "confirmada", pode_desfazer: true });
    expect(ok.totais.gravadas).toBe(7);
    const gravados = await lancamentosDa(rev.id);
    expect(gravados.meta.total).toBe(7);
    const ladoCartao = gravados.data.find((l) => l.card_id === cartaoA);
    expect(ladoCartao).toMatchObject({
      tipo: "transferencia",
      transferencia_sentido: "entrada",
    });
    expect(ladoCartao?.statement_id).not.toBeNull();

    // Evento no outbox, na mesma transacao.
    const ev = await dono.query(
      "select event_name, payload from finance.outbox where payload->>'import_id' = $1",
      [rev.id],
    );
    expect(ev.rows).toEqual([
      expect.objectContaining({
        event_name: "finance.importacao.confirmada.v1",
        payload: expect.objectContaining({ lancamentos: 7, alvo: "conta" }),
      }),
    ]);
    // Confirmar de novo nao grava em dobro.
    await expect(comoA((tx) => confirmarImportacao(tx, A, rev.id))).rejects.toThrow(
      /revisão/,
    );
  });

  it("o mesmo arquivo de novo grava zero linhas", async () => {
    const pedido = NovaImportacao.parse({ alvo: "conta", account_id: contaA });
    const rev = await comoA((tx) =>
      criarImportacao(tx, A, pedido, [fixture("itau-conta.ofx")]),
    );
    expect(rev.linhas.every((l) => l.situacao === "ja_importada" && !l.selecionada)).toBe(
      true,
    );
    expect(rev.totais).toMatchObject({ duplicadas: 6, selecionadas: 0, total: "0.00" });
    // A correcao do Salario na primeira importacao virou regra aprendida.
    expect(rev.linhas[0]).toMatchObject({
      category_id: categoria("Salário"),
      origem_categoria: "regra",
    });
    const ok = await comoA((tx) => confirmarImportacao(tx, A, rev.id));
    expect(ok.totais.gravadas).toBe(0);
  });

  it("periodo sobreposto, com FITID trocado pelo banco, so grava o novo", async () => {
    const original = new TextDecoder("windows-1252").decode(
      fixture("itau-conta.ofx").bytes,
    );
    const sobreposto = original
      .replace(/<FITID>2023/g, "<FITID>X2023")
      .replace(
        "</BANKTRANLIST>",
        "<STMTTRN>\n<TRNTYPE>DEBIT\n<DTPOSTED>20231202\n<TRNAMT>-8.50\n<FITID>N1\n<MEMO>CAFÉ DA ESQUINA\n</STMTTRN>\n<STMTTRN>\n<TRNTYPE>DEBIT\n<DTPOSTED>20231203\n<TRNAMT>-100.00\n<FITID>N2\n<MEMO>FEIRA E PADARIA\n</STMTTRN>\n</BANKTRANLIST>",
      );
    const rev = await comoA((tx) =>
      criarImportacao(
        tx,
        A,
        NovaImportacao.parse({ alvo: "conta", account_id: contaA }),
        [texto("dezembro.ofx", sobreposto)],
      ),
    );
    expect(rev.linhas.filter((l) => l.situacao === "nova").map((l) => l.fitid)).toEqual([
      "N1",
      "N2",
    ]);
    // Dividir a feira em duas categorias.
    const feira = rev.linhas.find((l) => l.fitid === "N2")!;
    await expect(
      comoA((tx) =>
        editarLinha(tx, A, rev.id, feira.id, {
          divisoes: [
            { category_id: categoria("Mercado"), valor: "60" },
            { category_id: categoria("Pets"), valor: "30" },
          ],
        }),
      ),
    ).rejects.toThrow(/somar/);
    await comoA((tx) =>
      editarLinha(tx, A, rev.id, feira.id, {
        divisoes: [
          { category_id: categoria("Mercado"), valor: "60,00" },
          { category_id: categoria("Pets"), valor: "40" },
        ],
      }),
    );
    const ok = await comoA((tx) => confirmarImportacao(tx, A, rev.id));
    expect(ok.totais.gravadas).toBe(3);
    const gravados = (await lancamentosDa(rev.id)).data;
    expect(gravados.map((l) => l.valor).sort()).toEqual(["40.00", "60.00", "8.50"]);
  });
});

describe("importacao de fatura de cartao", () => {
  let importacao = "";

  it("concilia o pagamento ja lancado, categoriza por regra e por historico", async () => {
    await comoA((tx) =>
      criarRegra(
        tx,
        A,
        NovaRegra.parse({ padrao: "padaria", category_id: categoria("Mercado") }),
      ),
    );
    await comoA((tx) =>
      criarRegra(
        tx,
        A,
        NovaRegra.parse({ padrao: "IOF", category_id: categoria("IOF") }),
      ),
    );
    // Lancamento manual antigo no cartao: alimenta o historico.
    await comoA((tx) =>
      criarLancamento(
        tx,
        A,
        NovoLancamento.parse({
          tipo: "despesa",
          valor: "10",
          data: "2023-10-01",
          descricao: "Restaurante Bom Prato",
          card_id: cartaoA,
          category_id: categoria("Restaurantes e delivery"),
        }),
      ),
    );
    const rev = await comoA((tx) =>
      criarImportacao(
        tx,
        A,
        NovaImportacao.parse({
          alvo: "cartao",
          card_id: cartaoA,
          vencimento: "2023-12-17",
        }),
        [fixture("itau-cartao.ofx")],
      ),
    );
    importacao = rev.id;
    const por = (trecho: string) =>
      rev.linhas.find((l) => l.descricao_original.includes(trecho))!;
    expect(por("PADARIA")).toMatchObject({
      category_id: categoria("Mercado"),
      origem_categoria: "regra",
    });
    expect(por("BOM PRATO")).toMatchObject({
      category_id: categoria("Restaurantes e delivery"),
      origem_categoria: "historico",
    });
    expect(por("PARC 03/10")).toMatchObject({ parcela_atual: 3, parcela_total: 10 });
    // O pagamento da fatura ja entrou pela conta (transferencia): conciliar.
    expect(por("PAGAMENTO EFETUADO")).toMatchObject({
      situacao: "possivel_duplicata",
      acao: "conciliar",
    });
    expect(rev.vencimento).toBe("2023-12-17");

    await comoA((tx) =>
      editarLinha(tx, A, rev.id, por("POSTO").id, {
        category_id: categoria("Transporte"),
      }),
    );
    await comoA((tx) =>
      editarLinha(tx, A, rev.id, por("IOF").id, { category_id: categoria("Viagem") }),
    );
    const comRegra = await comoA((tx) =>
      editarLinha(tx, A, rev.id, por("MAGAZINE").id, {
        category_id: categoria("Compras"),
        criar_regra: true,
        aplicar_a_iguais: true,
      }),
    );
    expect(comRegra.totais.sem_categoria).toBe(0);
    const ok = await comoA((tx) => confirmarImportacao(tx, A, rev.id));
    expect(ok.totais.gravadas).toBe(5);

    const faturas = await comoA((tx) => listarFaturas(tx, A, cartaoA, HOJE));
    expect(faturas.find((f) => f.vencimento === "2023-12-17")).toMatchObject({
      total: "700.93",
      pagamentos: "1543.21",
    });
  });

  it("regra aprendida nao passa por cima da regra do usuario", async () => {
    const regras = await comoA((tx) => listarRegras(tx, A));
    expect(regras.map((r) => [r.padrao, r.origem, r.vezes_aplicada])).toEqual([
      ["IOF", "usuario", 0],
      ["LOJA MAGAZINE EXEMPLO", "usuario", 0],
      ["PADARIA", "usuario", 1],
      ["POSTO COMBUSTIVEL CENTRO", "aprendida", 0],
      ["SALARIO EMPRESA EXEMPLO", "aprendida", 0],
    ]);
  });

  it("reimportar a fatura reconhece tudo, inclusive o pagamento conciliado", async () => {
    const rev = await comoA((tx) =>
      criarImportacao(
        tx,
        A,
        NovaImportacao.parse({
          alvo: "cartao",
          card_id: cartaoA,
          vencimento: "2023-12-17",
        }),
        [fixture("itau-cartao.ofx")],
      ),
    );
    expect(rev.linhas.every((l) => l.situacao === "ja_importada")).toBe(true);
  });

  it("desfaz e, com lancamento conciliado, recusa", async () => {
    const desfeita = await comoA((tx) => desfazerImportacao(tx, A, importacao));
    expect(desfeita.status).toBe("desfeita");
    expect((await lancamentosDa(importacao)).meta.total).toBe(0);
    const detalhe = await comoA((tx) => obterImportacao(tx, A, importacao));
    expect(detalhe.totais.gravadas).toBe(0);
    // A conciliacao foi solta: a fatura volta a reconhecer o pagamento como parecido.
    const rev = await comoA((tx) =>
      criarImportacao(
        tx,
        A,
        NovaImportacao.parse({
          alvo: "cartao",
          card_id: cartaoA,
          vencimento: "2023-12-17",
        }),
        [fixture("itau-cartao.ofx")],
      ),
    );
    expect(rev.linhas.filter((l) => l.situacao === "nova")).toHaveLength(5);
    expect(rev.linhas.filter((l) => l.situacao === "possivel_duplicata")).toHaveLength(1);
    await comoA((tx) => confirmarImportacao(tx, A, rev.id));
    const [um] = (await lancamentosDa(rev.id)).data;
    await comoA((tx) => editarLancamento(tx, A, um!.id, { status: "conciliado" }));
    await expect(comoA((tx) => desfazerImportacao(tx, A, rev.id))).rejects.toThrow(
      /conciliados/,
    );
  });
});

describe("fatura do C6 em CSV", () => {
  const C6 = "c6-Fatura_2026-11-10.csv";
  const HOJE_C6 = "2026-11-20";
  // Usuario proprio: as suites de RLS contam que B nao tem nada.
  const C = "user-ccc";
  const comoC = <T>(f: (tx: Tx) => Promise<T>) => comoUsuario(db, C, f);
  let cartaoC6 = "";
  let contaC6 = "";
  let categoriaC: (nome: string) => string = () => "";
  const pedido = () =>
    NovaImportacao.parse({ alvo: "cartao", card_id: cartaoC6, vencimento: "2026-11-10" });
  const importar = (arquivo: ArquivoRecebido = fixture(C6)) =>
    comoC((tx) => criarImportacao(tx, C, pedido(), [arquivo]));

  beforeAll(async () => {
    await comoC((tx) => semearCategorias(tx, C));
    const cats = await comoC((tx) => listarCategorias(tx, C));
    categoriaC = (nome) => cats.find((c) => c.nome === nome)?.id ?? "";
    cartaoC6 = (
      await comoC((tx) =>
        criarCartao(
          tx,
          C,
          NovoCartao.parse({
            nome: "C6 Carbon",
            instituicao: "C6 Bank",
            final: "2222",
            dia_fechamento: 3,
            dia_vencimento: 10,
          }),
          HOJE_C6,
        ),
      )
    ).id;
  });

  it("sugere o cartao por um dos finais e a fatura pelo nome do arquivo", async () => {
    const a = await comoC((tx) => analisarArquivos(tx, C, [fixture(C6)]));
    expect(a.sugestao).toEqual({
      alvo: "cartao",
      account_id: null,
      card_id: cartaoC6,
      vencimento: "2026-11-10",
    });
    expect(a.arquivos[0]).toMatchObject({ formato: "csv-c6", banco: "C6", linhas: 42 });
  });

  it("sem saber a conta, o pagamento fica desmarcado e nao vira receita", async () => {
    const rev = await importar();
    const pagamento = rev.linhas.find((l) => l.tipo === "receita")!;
    expect(pagamento).toMatchObject({
      situacao: "nova",
      acao: "ignorar",
      category_id: null,
      sugere_transferencia: true,
    });
    // Compras: o total do arquivo.
    expect(rev.totais.total).toBe("-5038.20");
    await comoC((tx) => editarLinha(tx, C, rev.id, pagamento.id, { selecionada: true }));
    await expect(comoC((tx) => confirmarImportacao(tx, C, rev.id))).rejects.toThrow(
      /paga a fatura/,
    );
    await comoC((tx) => cancelarImportacao(tx, C, rev.id));
  });

  it("com a conta do C6, o pagamento vira transferencia dela", async () => {
    contaC6 = (
      await comoC((tx) =>
        criarConta(
          tx,
          C,
          NovaConta.parse({
            nome: "C6 conta",
            tipo: "corrente",
            instituicao: "C6",
            data_saldo_inicial: "2026-01-01",
          }),
          HOJE_C6,
        ),
      )
    ).id;
    const rev = await importar();
    expect(rev.linhas.find((l) => l.tipo === "receita")).toMatchObject({
      acao: "importar",
      transferencia_conta_id: contaC6,
      category_id: null,
    });
    // Pagamento entra, compras saem: o mesmo saldo do arquivo, com sinal do cartao.
    expect(rev.totais.total).toBe("1623.41");
    await comoC((tx) => cancelarImportacao(tx, C, rev.id));
  });

  it("concilia o pagamento ja lancado, cria os planos e bate com a fatura", async () => {
    await comoC((tx) =>
      criarLancamento(
        tx,
        C,
        NovoLancamento.parse({
          tipo: "transferencia",
          valor: "6661.61",
          data: "2026-10-10",
          descricao: "Pagamento fatura C6",
          account_id: contaC6,
          cartao_destino_id: cartaoC6,
        }),
      ),
    );
    const rev = await importar();
    expect(rev.vencimento).toBe("2026-11-10");
    expect(rev.totais).toMatchObject({
      linhas: 42,
      selecionadas: 42,
      total: "-5038.20",
      possiveis_duplicatas: 1,
    });
    const por = (descricao: string) =>
      rev.linhas.find((l) => l.descricao_original === descricao)!;
    expect(por("Inclusao de Pagamento")).toMatchObject({
      situacao: "possivel_duplicata",
      acao: "conciliar",
      duplicata_descricao: "Pagamento fatura C6",
    });
    expect(por("CLINICA SORRISO")).toMatchObject({
      parcela_atual: 6,
      parcela_total: 7,
      data: "2026-10-30",
      category_id: categoriaC("Saúde"),
      origem_categoria: "banco",
    });
    expect(por("IOF ANTHROPIC SA")).toMatchObject({
      category_id: categoriaC("IOF"),
      origem_categoria: "banco",
    });
    expect(por("Anuidade Diferenciada")).toMatchObject({
      category_id: categoriaC("Tarifas bancárias"),
    });
    expect(por("DELL")).toMatchObject({ category_id: null, origem_categoria: "nenhuma" });

    const ok = await comoC((tx) =>
      confirmarImportacao(tx, C, rev.id, undefined, HOJE_C6),
    );
    expect(ok.totais.gravadas).toBe(41);
    const faturas = await comoC((tx) => listarFaturas(tx, C, cartaoC6, HOJE_C6));
    expect(faturas.find((f) => f.vencimento === "2026-11-10")).toMatchObject({
      total: "5038.20",
      pagamentos: "6661.61",
    });
    // Parcelas n/N com N > n: 20 planos (as duas 2/2 terminam nesta fatura).
    const planos = (await comoC((tx) => listarPlanos(tx, C))).filter(
      (p) => p.card_id === cartaoC6,
    );
    expect(planos).toHaveLength(20);
    expect(planos.find((p) => p.descricao === "CLINICA SORRISO")).toMatchObject({
      n_parcelas: 7,
      primeira_data: "2026-05-30",
      parcelas_pagas: 6,
      parcelas_restantes: 1,
    });
    expect(planos.find((p) => p.descricao === "ANUIDADE DIFERENCIADA")).toMatchObject({
      n_parcelas: 12,
      parcelas_pagas: 5,
      parcelas_restantes: 7,
    });
  });

  it("reimportar a mesma fatura reconhece tudo", async () => {
    const rev = await importar();
    expect(rev.linhas.every((l) => l.situacao === "ja_importada")).toBe(true);
    await comoC((tx) => cancelarImportacao(tx, C, rev.id));
  });

  it("a parcela seguinte, na fatura seguinte, concilia com o plano", async () => {
    const rev = await comoC((tx) =>
      criarImportacao(
        tx,
        C,
        NovaImportacao.parse({
          alvo: "cartao",
          card_id: cartaoC6,
          vencimento: "2026-12-10",
        }),
        [
          texto(
            "Fatura_2026-12-10.csv",
            "Data de Compra;Nome no Cartão;Final do Cartão;Categoria;Descrição;Parcela;Valor (em US$);Cotação (em R$);Valor (em R$)\r\n" +
              "30/05/2026;TITULAR EXEMPLO;1111;Assistência médica e odontológica;CLINICA SORRISO;7/7;0;0;155.71\r\n",
          ),
        ],
      ),
    );
    expect(rev.linhas[0]).toMatchObject({
      data: "2026-11-30",
      situacao: "possivel_duplicata",
      acao: "conciliar",
    });
    await comoC((tx) => confirmarImportacao(tx, C, rev.id, undefined, HOJE_C6));
    const plano = (await comoC((tx) => listarPlanos(tx, C))).find(
      (p) => p.descricao === "CLINICA SORRISO",
    );
    expect(plano).toMatchObject({ parcelas_pagas: 7, parcelas_restantes: 0 });
  });
});

describe("RLS das tabelas novas", () => {
  it("B nao ve importacao, linha, regra, cartao nem fatura de A", async () => {
    for (const t of [
      "imports",
      "import_rows",
      "categorization_rules",
      "cards",
      "statements",
    ]) {
      const r = await cruComoB(`select count(*)::int as n from finance.${t}`);
      expect(r.rows[0], t).toEqual({ n: 0 });
      const total = await dono.query(`select count(*)::int as n from finance.${t}`);
      expect((total.rows[0] as { n: number }).n, t).toBeGreaterThan(0);
    }
  });

  it("B nao grava importacao apontando para a conta de A (FK composta)", async () => {
    await expect(
      cruComoB(
        "insert into finance.imports (id, user_id, origem, alvo, account_id, arquivo_nome) values ('x', $1, 'ofx', 'conta', $2, 'a.ofx')",
        [B, contaA],
      ),
    ).rejects.toThrow(/foreign key|violates/);
    await expect(
      cruComoB(
        "insert into finance.transactions (id, user_id, card_id, statement_id, tipo, valor, data, competencia, descricao, descricao_normalizada) select 'y', $1, card_id, id, 'despesa', 1, '2023-11-01', '2023-11-01', 'x', 'X' from finance.statements",
        [B],
      ).then((r) => r.rowCount),
    ).resolves.toBe(0);
  });
});
