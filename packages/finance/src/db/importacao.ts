import { createHash, randomUUID } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { faturaDaCompra } from "../cartao.js";
import type {
  AnaliseDeImportacao,
  EdicaoDeLinha,
  EdicaoDeRegra,
  Importacao,
  ImportacaoComLinhas,
  LinhaDeImportacao,
  NovaImportacao,
  NovaRegra,
  Regra,
  TotaisDeImportacao,
} from "../contratos-importacao.js";
import { d, moeda, valorDigitado } from "../decimal.js";
import { competenciaDe, montarTransferencia } from "../dominio.js";
import {
  categorizar,
  chaveDeDedupe,
  descricoesParecidas,
  ErroDeLeitura,
  lerExtrato,
  normalizarDeExtrato,
  ordenarRegras,
  pareceTransferencia,
  proporLinhas,
  regraCasa,
  type ExtratoLido,
  type ModoDeRegra,
  type OrigemDeRegra,
  type RegraParaAplicar,
} from "../importacao/index.js";
import {
  auditar,
  categoriaDoUsuario,
  ErroDeFinancas,
  exigirCartao,
  exigirConta,
  faturaDaData,
  obterFatura,
  saldoDaConta,
  unico,
  type Origem,
  type Tx,
} from "./operacoes.js";
import {
  accounts,
  cards,
  categories,
  categorization_rules,
  import_rows,
  imports,
  outbox,
  statements,
  transactions,
} from "./schema.js";

export interface ArquivoRecebido {
  nome: string;
  bytes: Uint8Array;
}

export interface LimitesDeImportacao {
  /** Bytes por arquivo. */
  bytes: number;
  /** Linhas somando todos os arquivos. */
  linhas: number;
  arquivos: number;
}

export const LIMITES_PADRAO: LimitesDeImportacao = {
  bytes: 5 * 1024 * 1024,
  linhas: 5000,
  arquivos: 10,
};

export const EVENTO_IMPORTACAO_CONFIRMADA = "finance.importacao.confirmada.v1";

/** Dias de folga para achar o outro lado de uma transferencia ja lancada. */
const FOLGA_DE_TRANSFERENCIA = 3;

function lerArquivos(arquivos: ArquivoRecebido[], limites: LimitesDeImportacao) {
  if (arquivos.length === 0)
    throw new ErroDeFinancas(422, "Envie pelo menos um arquivo.");
  if (arquivos.length > limites.arquivos)
    throw new ErroDeFinancas(
      422,
      `Envie no máximo ${limites.arquivos} arquivos por vez.`,
    );
  const lidos: { nome: string; extrato: ExtratoLido }[] = [];
  for (const a of arquivos) {
    if (a.bytes.byteLength > limites.bytes)
      throw new ErroDeFinancas(
        413,
        `${a.nome} passa de ${Math.round(limites.bytes / 1024 / 1024)} MB.`,
      );
    try {
      lidos.push({ nome: a.nome, extrato: lerExtrato(a.bytes, a.nome) });
    } catch (erro) {
      if (erro instanceof ErroDeLeitura)
        throw new ErroDeFinancas(422, `Não consegui ler ${a.nome}: ${erro.message}`);
      throw erro;
    }
  }
  const total = lidos.reduce((s, l) => s + l.extrato.linhas.length, 0);
  if (total > limites.linhas)
    throw new ErroDeFinancas(
      422,
      `Os arquivos têm ${total} linhas; o limite é ${limites.linhas}.`,
    );
  return lidos;
}

// Sugestao de destino

/** Codigo COMPE (sem zeros a esquerda) ou ORG do FI -> palavras do nome do banco. */
const BANCOS: [RegExp, string[]][] = [
  [/^260$|NU PAGAMENTOS|NUBANK/i, ["nubank", "nu "]],
  [/^341$|ITAU|ITAÚ/i, ["itaú", "itau"]],
  [/^77$|INTER/i, ["inter"]],
  [/^336$|C6/i, ["c6"]],
  [/^1$|BANCO DO BRASIL/i, ["banco do brasil", "bb"]],
  [/^237$|BRADESCO/i, ["bradesco"]],
  [/^33$|SANTANDER/i, ["santander"]],
  [/^104$|CAIXA/i, ["caixa"]],
  [/^380$|PICPAY/i, ["picpay"]],
  [/^323$|MERCADO ?PAGO/i, ["mercado pago"]],
];

function palavrasDoBanco(banco: string | null): string[] {
  if (!banco) return [];
  const codigo = banco.replace(/^0+/, "");
  return BANCOS.find(([re]) => re.test(codigo) || re.test(banco))?.[1] ?? [];
}

const daInstituicao = (instituicao: string | null, palavras: string[]) => {
  const i = ` ${(instituicao ?? "").toLowerCase()} `;
  return palavras.some((p) => i.includes(p.endsWith(" ") ? ` ${p}` : p));
};

export async function analisarArquivos(
  tx: Tx,
  uid: string,
  arquivos: ArquivoRecebido[],
  limites: LimitesDeImportacao = LIMITES_PADRAO,
): Promise<AnaliseDeImportacao> {
  const lidos = lerArquivos(arquivos, limites);
  const primeiro = lidos[0]!.extrato;
  const tipo = primeiro.tipo;
  let account_id: string | null = null;
  let card_id: string | null = null;
  let vencimento: string | null = null;

  const [anterior] =
    primeiro.conta && tipo
      ? await tx
          .select({ account_id: imports.account_id, card_id: imports.card_id })
          .from(imports)
          .where(
            and(
              eq(imports.user_id, uid),
              eq(imports.alvo, tipo),
              eq(imports.conta_externa, primeiro.conta),
            ),
          )
          .orderBy(desc(imports.criada_em))
          .limit(1)
      : [];
  const palavras = palavrasDoBanco(primeiro.banco);

  if (tipo === "conta") {
    const contas = await tx
      .select({ id: accounts.id, instituicao: accounts.instituicao })
      .from(accounts)
      .where(and(eq(accounts.user_id, uid), eq(accounts.arquivada, false)));
    const doBanco = contas.filter((c) => daInstituicao(c.instituicao, palavras));
    account_id =
      anterior?.account_id ??
      (doBanco.length === 1
        ? doBanco[0]!.id
        : contas.length === 1
          ? contas[0]!.id
          : null);
  } else if (tipo === "cartao") {
    const cartoes = await tx
      .select({
        id: cards.id,
        instituicao: cards.instituicao,
        final: cards.final,
        dia_fechamento: cards.dia_fechamento,
        dia_vencimento: cards.dia_vencimento,
      })
      .from(cards)
      .where(and(eq(cards.user_id, uid), eq(cards.arquivado, false)));
    const final = primeiro.conta?.replace(/\D/g, "").slice(-4) ?? "";
    const peloFinal = cartoes.filter((c) => c.final && c.final === final);
    const doBanco = cartoes.filter((c) => daInstituicao(c.instituicao, palavras));
    const escolhido =
      cartoes.find((c) => c.id === anterior?.card_id) ??
      (peloFinal.length === 1
        ? peloFinal[0]
        : doBanco.length === 1
          ? doBanco[0]
          : cartoes.length === 1
            ? cartoes[0]
            : undefined);
    card_id = escolhido?.id ?? null;
    // A fatura que fecha depois da ultima compra do arquivo.
    const ultima = lidos
      .flatMap((l) => l.extrato.linhas.map((x) => x.data))
      .sort()
      .at(-1);
    if (escolhido && ultima) vencimento = faturaDaCompra(escolhido, ultima).vencimento;
  }

  return {
    arquivos: lidos.map(({ nome, extrato: e }) => ({
      nome,
      formato: e.formato,
      tipo: e.tipo,
      banco: e.banco,
      conta: e.conta,
      inicio: e.inicio,
      fim: e.fim,
      linhas: e.linhas.length,
      avisos: e.avisos,
    })),
    sugestao: { alvo: tipo, account_id, card_id, vencimento },
  };
}

// Criacao da revisao

const hashDe = (uid: string, chave: string) =>
  createHash("sha256").update(`${uid}|${chave}`).digest("hex");

const somaDias = (data: string, dias: number) => {
  const t = new Date(`${data}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + dias);
  return t.toISOString().slice(0, 10);
};

async function regrasDoUsuario(tx: Tx, uid: string): Promise<RegraParaAplicar[]> {
  const linhas = await tx
    .select({
      id: categorization_rules.id,
      padrao: categorization_rules.padrao,
      modo: categorization_rules.modo,
      category_id: categorization_rules.category_id,
      prioridade: categorization_rules.prioridade,
      origem: categorization_rules.origem,
    })
    .from(categorization_rules)
    .where(eq(categorization_rules.user_id, uid));
  return ordenarRegras(linhas as RegraParaAplicar[]);
}

async function naturezas(tx: Tx, uid: string) {
  const linhas = await tx
    .select({ id: categories.id, natureza: categories.natureza })
    .from(categories)
    .where(eq(categories.user_id, uid));
  const mapa = new Map(linhas.map((c) => [c.id, c.natureza]));
  return (id: string) => mapa.get(id);
}

/**
 * Categoria mais recente que o usuario deu a cada descricao, pela normalizacao
 * de extrato: "Padaria Pao Quente" lancada a mao casa com "PAG*PADARIA PAO
 * QUENTE" do OFX.
 */
async function historico(tx: Tx, uid: string): Promise<Map<string, string>> {
  const linhas = await tx
    .select({
      tipo: transactions.tipo,
      descricao: transactions.descricao,
      category_id: transactions.category_id,
    })
    .from(transactions)
    .where(and(eq(transactions.user_id, uid), isNotNull(transactions.category_id)))
    .orderBy(desc(transactions.data), desc(transactions.criada_em))
    .limit(5000);
  const mapa = new Map<string, string>();
  for (const l of linhas) {
    const chave = `${l.tipo}|${normalizarDeExtrato(l.descricao)}`;
    if (!mapa.has(chave)) mapa.set(chave, l.category_id as string);
  }
  return mapa;
}

interface Destino {
  alvo: "conta" | "cartao";
  account_id: string | null;
  card_id: string | null;
  statement_id: string | null;
}

const doDestino = (dest: Destino) =>
  dest.account_id
    ? eq(transactions.account_id, dest.account_id)
    : eq(transactions.card_id, dest.card_id ?? "");

export async function criarImportacao(
  tx: Tx,
  uid: string,
  pedido: NovaImportacao,
  arquivos: ArquivoRecebido[],
  limites: LimitesDeImportacao = LIMITES_PADRAO,
  origem?: Origem,
): Promise<ImportacaoComLinhas> {
  const lidos = lerArquivos(arquivos, limites);
  for (const { nome, extrato } of lidos)
    if (extrato.tipo && extrato.tipo !== pedido.alvo)
      throw new ErroDeFinancas(
        422,
        `${nome} é ${extrato.tipo === "cartao" ? "de cartão" : "de conta"}, mas o destino escolhido é ${pedido.alvo === "cartao" ? "um cartão" : "uma conta"}.`,
      );

  const dest: Destino = {
    alvo: pedido.alvo,
    account_id: null,
    card_id: null,
    statement_id: null,
  };
  if (pedido.alvo === "conta") {
    await exigirConta(tx, uid, pedido.account_id ?? "");
    dest.account_id = pedido.account_id ?? null;
  } else {
    dest.card_id = pedido.card_id ?? null;
    dest.statement_id = await obterFatura(
      tx,
      uid,
      pedido.card_id ?? "",
      pedido.vencimento ?? "",
    );
  }
  const chaveDestino = `${pedido.alvo}:${dest.account_id ?? dest.card_id}`;

  const propostas = lidos.flatMap(({ extrato }, arquivo) =>
    proporLinhas(extrato).map((l) => ({
      ...l,
      arquivo,
      hash: hashDe(uid, chaveDeDedupe(chaveDestino, l)),
    })),
  );

  // Ja gravadas: FITID (principal) ou hash (reserva) no mesmo destino.
  const fitids = [
    ...new Set(propostas.map((p) => p.fitid).filter((f): f is string => !!f)),
  ];
  const hashes = [...new Set(propostas.map((p) => p.hash))];
  const existentes = await tx
    .select({ fitid: transactions.fitid, hash: transactions.hash_dedupe })
    .from(transactions)
    .where(
      and(
        eq(transactions.user_id, uid),
        doDestino(dest),
        or(
          fitids.length ? inArray(transactions.fitid, fitids) : undefined,
          inArray(transactions.hash_dedupe, hashes),
        ),
      ),
    );
  const fitidGravado = new Set(existentes.map((e) => e.fitid).filter(Boolean));
  const hashGravado = new Set(existentes.map((e) => e.hash).filter(Boolean));

  // Candidatos a possivel duplicata: lancados a mao (sem FITID nem importacao).
  const datas = propostas.map((p) => p.data).sort();
  const manuais = datas.length
    ? await tx
        .select({
          id: transactions.id,
          tipo: transactions.tipo,
          valor: transactions.valor,
          data: transactions.data,
          descricao: transactions.descricao,
          sentido: transactions.transferencia_sentido,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.user_id, uid),
            doDestino(dest),
            isNull(transactions.fitid),
            isNull(transactions.hash_dedupe),
            gte(transactions.data, somaDias(datas[0]!, -FOLGA_DE_TRANSFERENCIA)),
            lte(transactions.data, somaDias(datas.at(-1)!, FOLGA_DE_TRANSFERENCIA)),
          ),
        )
    : [];
  const usados = new Set<string>();
  const parecido = (p: (typeof propostas)[number]) =>
    manuais.find((m) => {
      if (usados.has(m.id) || !d(m.valor).eq(p.valor)) return false;
      if (m.tipo === "transferencia") {
        const dias = Math.abs((Date.parse(m.data) - Date.parse(p.data)) / 86_400_000);
        return (
          dias <= FOLGA_DE_TRANSFERENCIA &&
          (m.sentido === "entrada") === (p.sentido === "credito")
        );
      }
      return (
        m.tipo === p.tipo &&
        m.data === p.data &&
        descricoesParecidas(m.descricao, p.descricao)
      );
    });

  const regras = await regrasDoUsuario(tx, uid);
  const natureza = await naturezas(tx, uid);
  const hist = await historico(tx, uid);

  const id = randomUUID();
  const primeiro = lidos[0]!.extrato;
  await tx.insert(imports).values({
    id,
    user_id: uid,
    origem: primeiro.formato,
    alvo: pedido.alvo,
    account_id: dest.account_id,
    card_id: dest.card_id,
    statement_id: dest.statement_id,
    arquivo_nome: lidos
      .map((l) => l.nome)
      .join(", ")
      .slice(0, 500),
    banco: primeiro.banco,
    conta_externa: primeiro.conta,
    inicio:
      lidos
        .map((l) => l.extrato.inicio)
        .filter(Boolean)
        .sort()[0] ??
      datas[0] ??
      null,
    fim:
      lidos
        .map((l) => l.extrato.fim)
        .filter(Boolean)
        .sort()
        .at(-1) ??
      datas.at(-1) ??
      null,
    // Conferencia de saldo so com um arquivo: com varios, o LEDGERBAL e de qual?
    saldo_informado: lidos.length === 1 ? (primeiro.saldo?.valor ?? null) : null,
    saldo_data: lidos.length === 1 ? (primeiro.saldo?.data ?? null) : null,
  });
  // Fatura: o LEDGERBAL do cartao (negativo) e o total que o banco cobra.
  if (dest.statement_id && lidos.length === 1 && primeiro.saldo)
    await tx
      .update(statements)
      .set({ total_informado: moeda(d(primeiro.saldo.valor).abs()) })
      .where(and(eq(statements.user_id, uid), eq(statements.id, dest.statement_id)));

  const noLote = new Set<string>();
  const linhas = propostas.map((p, ordem) => {
    const repetida =
      (p.fitid && (fitidGravado.has(p.fitid) || noLote.has(`f:${p.fitid}`))) ||
      hashGravado.has(p.hash) ||
      noLote.has(`h:${p.hash}`);
    if (p.fitid) noLote.add(`f:${p.fitid}`);
    noLote.add(`h:${p.hash}`);
    const manual = repetida ? undefined : parecido(p);
    if (manual) usados.add(manual.id);
    const situacao = repetida ? "ja_importada" : manual ? "possivel_duplicata" : "nova";
    const cat = categorizar(p.descricao_normalizada, p.tipo, regras, hist, natureza);
    const acao = repetida ? "ignorar" : manual ? "conciliar" : "importar";
    return {
      id: randomUUID(),
      user_id: uid,
      import_id: id,
      ordem,
      arquivo: p.arquivo,
      fitid: p.fitid,
      trntype: p.trntype,
      data: p.data,
      valor: p.valor,
      tipo: p.tipo,
      descricao_original: p.descricao,
      descricao_normalizada: p.descricao_normalizada,
      parcela_atual: p.parcela_atual,
      parcela_total: p.parcela_total,
      hash_dedupe: p.hash,
      situacao,
      duplicata_de: manual?.id ?? null,
      categoria_detectada: cat.category_id,
      origem_categoria: cat.origem,
      regra_id: cat.regra_id,
      selecionada: acao !== "ignorar",
      acao,
      category_id: cat.category_id,
    };
  });
  for (let i = 0; i < linhas.length; i += 500)
    await tx.insert(import_rows).values(linhas.slice(i, i + 500));
  await recalcularTotais(tx, uid, id);
  await auditar(
    tx,
    uid,
    "importacao.criada",
    "import",
    id,
    origem,
    `${linhas.length} linhas`,
  );
  return obterImportacao(tx, uid, id);
}

// Leitura

const colunasDeImportacao = {
  id: imports.id,
  origem: imports.origem,
  alvo: imports.alvo,
  account_id: imports.account_id,
  card_id: imports.card_id,
  statement_id: imports.statement_id,
  vencimento: statements.vencimento,
  arquivo_nome: imports.arquivo_nome,
  status: imports.status,
  inicio: imports.inicio,
  fim: imports.fim,
  totais: imports.totais,
  saldo_informado: imports.saldo_informado,
  saldo_data: imports.saldo_data,
  criada_em: imports.criada_em,
  confirmada_em: imports.confirmada_em,
};

async function linhaDaImportacao(tx: Tx, uid: string, id: string) {
  const [i] = await tx
    .select(colunasDeImportacao)
    .from(imports)
    .leftJoin(statements, eq(statements.id, imports.statement_id))
    .where(and(eq(imports.user_id, uid), eq(imports.id, id)));
  if (!i) throw new ErroDeFinancas(404, "Importação não encontrada.");
  return i;
}

async function linhasDaImportacao(tx: Tx, uid: string, id: string) {
  return tx
    .select()
    .from(import_rows)
    .where(and(eq(import_rows.user_id, uid), eq(import_rows.import_id, id)))
    .orderBy(asc(import_rows.ordem));
}
type LinhaDb = Awaited<ReturnType<typeof linhasDaImportacao>>[number];

const ehTransferencia = (l: LinhaDb) =>
  !!(l.transferencia_conta_id || l.transferencia_cartao_id);

function totaisDe(linhas: LinhaDb[], gravadas = 0): TotaisDeImportacao {
  let total = d(0);
  for (const l of linhas)
    if (l.acao === "importar")
      total = l.tipo === "receita" ? total.plus(l.valor) : total.minus(l.valor);
  return {
    linhas: linhas.length,
    selecionadas: linhas.filter((l) => l.acao !== "ignorar").length,
    total: moeda(total),
    duplicadas: linhas.filter((l) => l.situacao === "ja_importada").length,
    possiveis_duplicatas: linhas.filter((l) => l.situacao === "possivel_duplicata")
      .length,
    sem_categoria: linhas.filter(
      (l) =>
        l.acao === "importar" && !l.category_id && !l.divisoes && !ehTransferencia(l),
    ).length,
    gravadas,
  };
}

async function recalcularTotais(tx: Tx, uid: string, id: string, gravadas = 0) {
  const totais = totaisDe(await linhasDaImportacao(tx, uid, id), gravadas);
  await tx
    .update(imports)
    .set({ totais })
    .where(and(eq(imports.user_id, uid), eq(imports.id, id)));
  return totais;
}

async function podeDesfazer(tx: Tx, uid: string, id: string, status: string) {
  if (status !== "confirmada") return false;
  const [conciliado] = await tx
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        eq(transactions.user_id, uid),
        eq(transactions.importacao_id, id),
        eq(transactions.status, "conciliado"),
      ),
    )
    .limit(1);
  return !conciliado;
}

async function montarImportacao(
  tx: Tx,
  uid: string,
  i: Awaited<ReturnType<typeof linhaDaImportacao>>,
  linhas?: LinhaDb[],
): Promise<Importacao> {
  const totais = linhas
    ? totaisDe(linhas, (i.totais as Partial<TotaisDeImportacao>).gravadas ?? 0)
    : (i.totais as TotaisDeImportacao);
  let conferencia: Importacao["conferencia"] = null;
  if (i.alvo === "conta" && i.account_id && i.saldo_informado && i.saldo_data) {
    let calculado = d(await saldoDaConta(tx, uid, i.account_id, i.saldo_data));
    // Na revisao, o saldo depois de importar o que esta marcado.
    if (i.status === "revisao" && linhas)
      for (const l of linhas)
        if (l.acao === "importar" && l.data <= i.saldo_data)
          calculado =
            l.tipo === "receita" ? calculado.plus(l.valor) : calculado.minus(l.valor);
    conferencia = {
      data: i.saldo_data,
      saldo_informado: i.saldo_informado,
      saldo_calculado: moeda(calculado),
      confere: calculado.eq(i.saldo_informado),
    };
  }
  const { saldo_informado: _s, saldo_data: _d, ...resto } = i;
  return {
    ...resto,
    alvo: i.alvo as Importacao["alvo"],
    status: i.status as Importacao["status"],
    totais,
    conferencia,
    pode_desfazer: await podeDesfazer(tx, uid, i.id, i.status),
  };
}

export async function obterImportacao(
  tx: Tx,
  uid: string,
  id: string,
): Promise<ImportacaoComLinhas> {
  const i = await linhaDaImportacao(tx, uid, id);
  const linhas = await linhasDaImportacao(tx, uid, id);
  const ids = linhas.map((l) => l.duplicata_de).filter((x): x is string => !!x);
  const duplicatas = ids.length
    ? await tx
        .select({ id: transactions.id, descricao: transactions.descricao })
        .from(transactions)
        .where(and(eq(transactions.user_id, uid), inArray(transactions.id, ids)))
    : [];
  const descricaoDe = new Map(duplicatas.map((x) => [x.id, x.descricao]));
  return {
    ...(await montarImportacao(tx, uid, i, linhas)),
    linhas: linhas.map((l): LinhaDeImportacao => ({
      id: l.id,
      ordem: l.ordem,
      arquivo: l.arquivo,
      fitid: l.fitid,
      data: l.data,
      valor: l.valor,
      tipo: l.tipo as LinhaDeImportacao["tipo"],
      descricao_original: l.descricao_original,
      descricao_normalizada: l.descricao_normalizada,
      parcela_atual: l.parcela_atual,
      parcela_total: l.parcela_total,
      situacao: l.situacao as LinhaDeImportacao["situacao"],
      duplicata_de: l.duplicata_de,
      duplicata_descricao: l.duplicata_de
        ? (descricaoDe.get(l.duplicata_de) ?? null)
        : null,
      categoria_detectada: l.categoria_detectada,
      origem_categoria: l.origem_categoria as LinhaDeImportacao["origem_categoria"],
      selecionada: l.selecionada,
      acao: l.acao as LinhaDeImportacao["acao"],
      category_id: l.category_id,
      categoria_editada: l.categoria_editada,
      transferencia_conta_id: l.transferencia_conta_id,
      transferencia_cartao_id: l.transferencia_cartao_id,
      sugere_transferencia: pareceTransferencia(l.descricao_normalizada),
      divisoes: (l.divisoes as LinhaDeImportacao["divisoes"]) ?? null,
    })),
  };
}

export async function listarImportacoes(tx: Tx, uid: string): Promise<Importacao[]> {
  const lista = await tx
    .select(colunasDeImportacao)
    .from(imports)
    .leftJoin(statements, eq(statements.id, imports.statement_id))
    .where(eq(imports.user_id, uid))
    .orderBy(desc(imports.criada_em))
    .limit(50);
  return Promise.all(lista.map((i) => montarImportacao(tx, uid, i)));
}

// Revisao

async function emRevisao(tx: Tx, uid: string, id: string) {
  const i = await linhaDaImportacao(tx, uid, id);
  if (i.status !== "revisao")
    throw new ErroDeFinancas(409, "Esta importação não está mais em revisão.");
  return i;
}

async function exigirNatureza(tx: Tx, uid: string, categoryId: string, tipo: string) {
  const c = await categoriaDoUsuario(tx, uid, categoryId);
  if (c.natureza !== tipo)
    throw new ErroDeFinancas(
      422,
      tipo === "receita"
        ? "Escolha uma categoria de receita."
        : "Escolha uma categoria de despesa.",
    );
}

/** Cria (ou assume) a regra do usuario para a descricao. Regra aprendida igual vira do usuario. */
async function regraDoUsuarioPara(
  tx: Tx,
  uid: string,
  padrao: string,
  categoryId: string,
) {
  await tx
    .insert(categorization_rules)
    .values({
      id: randomUUID(),
      user_id: uid,
      padrao,
      modo: "contem",
      category_id: categoryId,
      origem: "usuario",
    })
    .onConflictDoUpdate({
      target: [
        categorization_rules.user_id,
        categorization_rules.modo,
        categorization_rules.padrao,
      ],
      set: { category_id: categoryId, origem: "usuario" },
    });
}

export async function editarLinha(
  tx: Tx,
  uid: string,
  importId: string,
  linhaId: string,
  e: EdicaoDeLinha,
  origem?: Origem,
): Promise<ImportacaoComLinhas> {
  const imp = await emRevisao(tx, uid, importId);
  const [linha] = await tx
    .select()
    .from(import_rows)
    .where(
      and(
        eq(import_rows.user_id, uid),
        eq(import_rows.import_id, importId),
        eq(import_rows.id, linhaId),
      ),
    );
  if (!linha) throw new ErroDeFinancas(404, "Linha não encontrada.");
  const mudar: Partial<typeof import_rows.$inferInsert> = {};

  if (e.acao !== undefined) {
    if (e.acao === "conciliar" && !linha.duplicata_de)
      throw new ErroDeFinancas(422, "Não há lançamento parecido para conciliar.");
    mudar.acao = e.acao;
  } else if (e.selecionada !== undefined) {
    mudar.acao = e.selecionada ? "importar" : "ignorar";
  }
  if (mudar.acao) mudar.selecionada = mudar.acao !== "ignorar";

  if (e.transferencia_conta_id !== undefined || e.transferencia_cartao_id !== undefined) {
    const conta = e.transferencia_conta_id ?? null;
    const cartao = e.transferencia_cartao_id ?? null;
    if (conta) {
      if (conta === imp.account_id)
        throw new ErroDeFinancas(422, "A outra ponta não pode ser a própria conta.");
      await exigirConta(tx, uid, conta);
    }
    if (cartao) {
      // Pagamento de fatura: sai da conta e entra no cartao.
      if (imp.alvo !== "conta" || linha.tipo !== "despesa")
        throw new ErroDeFinancas(
          422,
          "Só um débito da conta pode pagar a fatura de um cartão.",
        );
      await exigirCartao(tx, uid, cartao);
    }
    if (conta && imp.alvo === "cartao" && linha.tipo !== "receita")
      throw new ErroDeFinancas(
        422,
        "Só um crédito do cartão (pagamento) vem de uma conta.",
      );
    Object.assign(mudar, {
      transferencia_conta_id: conta,
      transferencia_cartao_id: cartao,
      ...(conta || cartao ? { category_id: null, divisoes: null } : {}),
    });
  }

  if (e.divisoes !== undefined) {
    if (e.divisoes === null) mudar.divisoes = null;
    else {
      const partes = e.divisoes.map((p) => ({
        category_id: p.category_id,
        valor: valorDigitado(p.valor),
      }));
      if (partes.some((p) => p.valor === null || d(p.valor).lte(0)))
        throw new ErroDeFinancas(422, "Valor da divisão inválido.");
      const soma = partes.reduce((s, p) => s.plus(p.valor as string), d(0));
      if (!soma.eq(linha.valor))
        throw new ErroDeFinancas(422, "As duas partes têm de somar o valor da linha.");
      for (const p of partes) await exigirNatureza(tx, uid, p.category_id, linha.tipo);
      mudar.divisoes = partes.map((p) => ({
        category_id: p.category_id,
        valor: moeda(d(p.valor as string)),
      }));
      mudar.category_id = partes[0]!.category_id;
      mudar.transferencia_conta_id = null;
      mudar.transferencia_cartao_id = null;
    }
  }

  if (e.category_id !== undefined) {
    if (e.category_id) await exigirNatureza(tx, uid, e.category_id, linha.tipo);
    Object.assign(mudar, {
      category_id: e.category_id,
      categoria_editada: true,
      divisoes: null,
      transferencia_conta_id: null,
      transferencia_cartao_id: null,
    });
    const iguais = and(
      eq(import_rows.user_id, uid),
      eq(import_rows.import_id, importId),
      eq(import_rows.tipo, linha.tipo),
      eq(import_rows.descricao_normalizada, linha.descricao_normalizada),
      isNull(import_rows.divisoes),
      isNull(import_rows.transferencia_conta_id),
      isNull(import_rows.transferencia_cartao_id),
    );
    if (e.aplicar_a_iguais)
      await tx
        .update(import_rows)
        .set({ category_id: e.category_id, categoria_editada: true })
        .where(iguais);
    if (e.criar_regra && e.category_id) {
      await regraDoUsuarioPara(tx, uid, linha.descricao_normalizada, e.category_id);
      // A regra nova vale para as linhas iguais ainda nao corrigidas a mao.
      await tx
        .update(import_rows)
        .set({ category_id: e.category_id, origem_categoria: "regra" })
        .where(and(iguais, eq(import_rows.categoria_editada, false)));
      await auditar(
        tx,
        uid,
        "regra.criada",
        "categorization_rule",
        linhaId,
        origem,
        linha.descricao_normalizada,
      );
    }
  }

  if (Object.keys(mudar).length > 0)
    await tx
      .update(import_rows)
      .set(mudar)
      .where(and(eq(import_rows.user_id, uid), eq(import_rows.id, linhaId)));
  await recalcularTotais(tx, uid, importId);
  return obterImportacao(tx, uid, importId);
}

export async function cancelarImportacao(
  tx: Tx,
  uid: string,
  id: string,
  origem?: Origem,
): Promise<Importacao> {
  await emRevisao(tx, uid, id);
  await tx
    .update(imports)
    .set({ status: "cancelada" })
    .where(and(eq(imports.user_id, uid), eq(imports.id, id)));
  await auditar(tx, uid, "importacao.cancelada", "import", id, origem);
  return montarImportacao(tx, uid, await linhaDaImportacao(tx, uid, id));
}

// Confirmacao

type NovoLancamentoDb = typeof transactions.$inferInsert;

/**
 * Grava tudo numa transacao so (a do chamador): lancamentos, ligacao das
 * conciliadas, uso das regras, regras aprendidas, evento no outbox e status.
 */
export async function confirmarImportacao(
  tx: Tx,
  uid: string,
  id: string,
  origem?: Origem,
): Promise<Importacao> {
  // Trava a importacao: duas confirmacoes simultaneas nao gravam em dobro.
  const [travada] = await tx
    .update(imports)
    .set({ status: "confirmada", confirmada_em: sql`now()` })
    .where(
      and(eq(imports.user_id, uid), eq(imports.id, id), eq(imports.status, "revisao")),
    )
    .returning({ id: imports.id });
  if (!travada) {
    await linhaDaImportacao(tx, uid, id);
    throw new ErroDeFinancas(409, "Esta importação não está mais em revisão.");
  }
  const imp = await linhaDaImportacao(tx, uid, id);
  const linhas = await linhasDaImportacao(tx, uid, id);
  const destino = {
    account_id: imp.account_id,
    card_id: imp.card_id,
    statement_id: imp.statement_id,
  };

  const novos: NovoLancamentoDb[] = [];
  const ligacao = new Map<string, string>();
  for (const l of linhas.filter((x) => x.acao === "importar")) {
    const comum = {
      user_id: uid,
      data: l.data,
      competencia: competenciaDe(l.data),
      descricao: l.descricao_original.slice(0, 200),
      descricao_normalizada: l.descricao_normalizada,
      status: "realizado" as const,
      importacao_id: id,
    };
    if (ehTransferencia(l)) {
      const saida = randomUUID();
      const entrada = randomUUID();
      const pedido = {
        valor: l.valor,
        data: l.data,
        descricao: comum.descricao,
        status: "realizado" as const,
      };
      const [s, e] = l.transferencia_cartao_id
        ? montarTransferencia(
            {
              ...pedido,
              de: imp.account_id as string,
              para: {
                card_id: l.transferencia_cartao_id,
                statement_id: await faturaDaData(
                  tx,
                  uid,
                  l.transferencia_cartao_id,
                  l.data,
                ),
              },
            },
            { saida, entrada },
          )
        : l.tipo === "despesa"
          ? montarTransferencia(
              {
                ...pedido,
                de: imp.account_id as string,
                para: l.transferencia_conta_id as string,
              },
              { saida, entrada },
            )
          : montarTransferencia(
              {
                ...pedido,
                de: l.transferencia_conta_id as string,
                para: imp.account_id
                  ? imp.account_id
                  : {
                      card_id: imp.card_id as string,
                      statement_id: imp.statement_id as string,
                    },
              },
              { saida, entrada },
            );
      // O lado que esta no destino carrega FITID e hash.
      const ladoNoDestino = l.tipo === "despesa" ? s : e;
      for (const lado of [s, e])
        novos.push({
          ...lado,
          ...comum,
          ...(lado === ladoNoDestino
            ? { fitid: l.fitid, hash_dedupe: l.hash_dedupe }
            : {}),
        });
      ligacao.set(l.id, ladoNoDestino.id);
      continue;
    }
    const partes = (l.divisoes as { category_id: string; valor: string }[] | null) ?? [
      { category_id: l.category_id, valor: l.valor },
    ];
    partes.forEach((p, i) => {
      const tid = randomUUID();
      if (i === 0) ligacao.set(l.id, tid);
      novos.push({
        ...comum,
        ...destino,
        id: tid,
        tipo: l.tipo,
        valor: p.valor,
        category_id: p.category_id ?? null,
        // A segunda parte da divisao nao repete o FITID (indice unico).
        fitid: i === 0 ? l.fitid : null,
        hash_dedupe: i === 0 ? l.hash_dedupe : `${l.hash_dedupe}:${i + 1}`,
      });
    });
  }

  try {
    for (let i = 0; i < novos.length; i += 500)
      await tx.insert(transactions).values(novos.slice(i, i + 500));
    // Conciliar: o lancamento manual ganha o FITID e o hash, e a proxima
    // importacao do mesmo arquivo o reconhece.
    for (const l of linhas.filter((x) => x.acao === "conciliar" && x.duplicata_de)) {
      await tx
        .update(transactions)
        .set({
          fitid: sql`coalesce(${transactions.fitid}, ${l.fitid})`,
          hash_dedupe: sql`coalesce(${transactions.hash_dedupe}, ${l.hash_dedupe})`,
          atualizada_em: sql`now()`,
        })
        .where(
          and(
            eq(transactions.user_id, uid),
            eq(transactions.id, l.duplicata_de as string),
          ),
        );
      ligacao.set(l.id, l.duplicata_de as string);
    }
  } catch (erro) {
    if (unico(erro))
      throw new ErroDeFinancas(
        409,
        "Parte destas linhas já foi importada em outra importação. Desfaça esta revisão e importe de novo.",
      );
    throw erro;
  }
  for (const [linhaId, tid] of ligacao)
    await tx
      .update(import_rows)
      .set({ transaction_id: tid })
      .where(and(eq(import_rows.user_id, uid), eq(import_rows.id, linhaId)));

  await contarUsoDasRegras(tx, uid, linhas);
  await aprenderRegras(tx, uid, linhas);

  const totais = await recalcularTotais(tx, uid, id, novos.length);
  await tx.insert(outbox).values({
    id: randomUUID(),
    event_name: EVENTO_IMPORTACAO_CONFIRMADA,
    payload: {
      import_id: id,
      user_id: uid,
      alvo: imp.alvo,
      account_id: imp.account_id,
      card_id: imp.card_id,
      statement_id: imp.statement_id,
      inicio: imp.inicio,
      fim: imp.fim,
      lancamentos: novos.length,
      conciliados: linhas.filter((l) => l.acao === "conciliar").length,
    },
    occurred_at: new Date().toISOString(),
    producer: "web",
  });
  await auditar(
    tx,
    uid,
    "importacao.confirmada",
    "import",
    id,
    origem,
    `${totais.gravadas} lançamentos`,
  );
  return montarImportacao(tx, uid, await linhaDaImportacao(tx, uid, id));
}

async function contarUsoDasRegras(tx: Tx, uid: string, linhas: LinhaDb[]) {
  const uso = new Map<string, number>();
  for (const l of linhas)
    if (
      l.acao === "importar" &&
      l.regra_id &&
      !l.categoria_editada &&
      !l.divisoes &&
      !ehTransferencia(l) &&
      l.category_id === l.categoria_detectada
    )
      uso.set(l.regra_id, (uso.get(l.regra_id) ?? 0) + 1);
  for (const [regra, n] of uso)
    await tx
      .update(categorization_rules)
      .set({ vezes_aplicada: sql`${categorization_rules.vezes_aplicada} + ${n}` })
      .where(
        and(eq(categorization_rules.user_id, uid), eq(categorization_rules.id, regra)),
      );
}

/**
 * Categoria corrigida a mao vira regra aprendida para a descricao. Nunca
 * sobrescreve nem passa na frente de uma regra do usuario: se alguma do
 * usuario ja casa com a descricao, nao aprende.
 */
async function aprenderRegras(tx: Tx, uid: string, linhas: LinhaDb[]) {
  const doUsuario = (await regrasDoUsuario(tx, uid)).filter(
    (r) => r.origem === "usuario",
  );
  const aprendidas = new Map<string, string>();
  for (const l of linhas) {
    if (l.acao !== "importar" || !l.categoria_editada || !l.category_id || l.divisoes)
      continue;
    if (doUsuario.some((r) => regraCasa(r, l.descricao_normalizada))) continue;
    aprendidas.set(l.descricao_normalizada, l.category_id);
  }
  for (const [padrao, categoria] of aprendidas)
    await tx
      .insert(categorization_rules)
      .values({
        id: randomUUID(),
        user_id: uid,
        padrao,
        modo: "contem",
        category_id: categoria,
        origem: "aprendida",
        prioridade: 1000,
      })
      .onConflictDoUpdate({
        target: [
          categorization_rules.user_id,
          categorization_rules.modo,
          categorization_rules.padrao,
        ],
        set: { category_id: categoria },
        setWhere: eq(categorization_rules.origem, "aprendida"),
      });
}

/** Apaga os lancamentos da importacao, se nenhum foi conciliado. */
export async function desfazerImportacao(
  tx: Tx,
  uid: string,
  id: string,
  origem?: Origem,
): Promise<Importacao> {
  const imp = await linhaDaImportacao(tx, uid, id);
  if (imp.status !== "confirmada")
    throw new ErroDeFinancas(409, "Só uma importação confirmada pode ser desfeita.");
  if (!(await podeDesfazer(tx, uid, id, imp.status)))
    throw new ErroDeFinancas(
      409,
      "Há lançamentos conciliados nesta importação; não dá para desfazer.",
    );
  await tx
    .delete(transactions)
    .where(and(eq(transactions.user_id, uid), eq(transactions.importacao_id, id)));
  // Solta o FITID e o hash que a conciliacao pos nos lancamentos manuais.
  for (const l of await linhasDaImportacao(tx, uid, id))
    if (l.acao === "conciliar" && l.duplicata_de)
      await tx
        .update(transactions)
        .set({
          fitid: sql`case when ${transactions.fitid} = ${l.fitid} then null else ${transactions.fitid} end`,
          hash_dedupe: sql`case when ${transactions.hash_dedupe} = ${l.hash_dedupe} then null else ${transactions.hash_dedupe} end`,
        })
        .where(and(eq(transactions.user_id, uid), eq(transactions.id, l.duplicata_de)));
  await tx
    .update(import_rows)
    .set({ transaction_id: null })
    .where(and(eq(import_rows.user_id, uid), eq(import_rows.import_id, id)));
  await tx
    .update(imports)
    .set({ status: "desfeita" })
    .where(and(eq(imports.user_id, uid), eq(imports.id, id)));
  await recalcularTotais(tx, uid, id, 0);
  await auditar(tx, uid, "importacao.desfeita", "import", id, origem);
  return montarImportacao(tx, uid, await linhaDaImportacao(tx, uid, id));
}

// Regras

const colunasDeRegra = {
  id: categorization_rules.id,
  padrao: categorization_rules.padrao,
  modo: categorization_rules.modo,
  category_id: categorization_rules.category_id,
  prioridade: categorization_rules.prioridade,
  origem: categorization_rules.origem,
  vezes_aplicada: categorization_rules.vezes_aplicada,
  criada_em: categorization_rules.criada_em,
};

export async function listarRegras(tx: Tx, uid: string): Promise<Regra[]> {
  const linhas = await tx
    .select(colunasDeRegra)
    .from(categorization_rules)
    .where(eq(categorization_rules.user_id, uid));
  return ordenarRegras(linhas as Regra[]);
}

async function regraDoUsuario(tx: Tx, uid: string, id: string): Promise<Regra> {
  const [r] = await tx
    .select(colunasDeRegra)
    .from(categorization_rules)
    .where(and(eq(categorization_rules.user_id, uid), eq(categorization_rules.id, id)));
  if (!r) throw new ErroDeFinancas(404, "Regra não encontrada.");
  return r as Regra;
}

const regraRepetida = (erro: unknown) => {
  if (unico(erro)) throw new ErroDeFinancas(409, "Já existe uma regra com esse padrão.");
  throw erro;
};

/** contem e comeca_com guardam o padrao normalizado: e assim que ele e comparado. */
const padraoGuardado = (padrao: string, modo: ModoDeRegra) =>
  modo === "regex" ? padrao : normalizarDeExtrato(padrao);

export async function criarRegra(
  tx: Tx,
  uid: string,
  r: NovaRegra,
  origem?: Origem,
): Promise<Regra> {
  await categoriaDoUsuario(tx, uid, r.category_id);
  const id = randomUUID();
  await tx
    .insert(categorization_rules)
    .values({
      id,
      user_id: uid,
      padrao: padraoGuardado(r.padrao, r.modo),
      modo: r.modo,
      category_id: r.category_id,
      prioridade: r.prioridade,
      origem: "usuario" satisfies OrigemDeRegra,
    })
    .catch(regraRepetida);
  await auditar(tx, uid, "regra.criada", "categorization_rule", id, origem);
  return regraDoUsuario(tx, uid, id);
}

export async function editarRegra(
  tx: Tx,
  uid: string,
  id: string,
  e: EdicaoDeRegra,
  origem?: Origem,
): Promise<Regra> {
  const atual = await regraDoUsuario(tx, uid, id);
  if (e.category_id) await categoriaDoUsuario(tx, uid, e.category_id);
  const modo = e.modo ?? atual.modo;
  const mudar: Partial<typeof categorization_rules.$inferInsert> = {
    // Editar uma regra aprendida a torna do usuario.
    origem: "usuario",
  };
  if (e.padrao !== undefined || e.modo !== undefined)
    mudar.padrao = padraoGuardado(e.padrao ?? atual.padrao, modo);
  if (e.modo !== undefined) mudar.modo = e.modo;
  if (e.category_id !== undefined) mudar.category_id = e.category_id;
  if (e.prioridade !== undefined) mudar.prioridade = e.prioridade;
  await tx
    .update(categorization_rules)
    .set(mudar)
    .where(and(eq(categorization_rules.user_id, uid), eq(categorization_rules.id, id)))
    .catch(regraRepetida);
  await auditar(tx, uid, "regra.editada", "categorization_rule", id, origem);
  return regraDoUsuario(tx, uid, id);
}

export async function apagarRegra(
  tx: Tx,
  uid: string,
  id: string,
  origem?: Origem,
): Promise<void> {
  await regraDoUsuario(tx, uid, id);
  await tx
    .delete(categorization_rules)
    .where(and(eq(categorization_rules.user_id, uid), eq(categorization_rules.id, id)));
  await auditar(tx, uid, "regra.apagada", "categorization_rule", id, origem);
}
