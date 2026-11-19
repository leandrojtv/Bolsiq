import { d, moeda } from "../decimal.js";
import {
  ErroDeLeitura,
  type ExtratoLido,
  type LeitorDeExtrato,
  type LinhaLida,
} from "./tipos.js";

/**
 * OFX 1.x (SGML: folhas sem tag de fechamento) e 2.x (XML). O mesmo leitor de
 * tags serve aos dois: folha e a tag que tem texto logo depois; agregado e a
 * que nao tem. Fechamento de folha, quando existe, e consumido.
 */
interface No {
  tag: string;
  texto?: string;
  filhos: No[];
}

const ENTIDADES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodificarEntidades(t: string): string {
  return t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (todo, e: string) => {
    if (e[0] === "#")
      return String.fromCodePoint(
        e[1] === "x" || e[1] === "X"
          ? parseInt(e.slice(2), 16)
          : parseInt(e.slice(1), 10),
      );
    return ENTIDADES[e.toLowerCase()] ?? todo;
  });
}

function arvore(corpo: string): No {
  const raiz: No = { tag: "#", filhos: [] };
  const pilha: No[] = [raiz];
  const tag = /<(\/?)([A-Za-z0-9._]+)[^>]*>([^<]*)/g;
  let m: RegExpExecArray | null;
  let folhaAberta: No | null = null;
  while ((m = tag.exec(corpo))) {
    const fecha = m[1] === "/";
    const nome = (m[2] ?? "").toUpperCase();
    const texto = (m[3] ?? "").trim();
    if (fecha) {
      if (folhaAberta?.tag === nome) {
        folhaAberta = null;
        continue;
      }
      folhaAberta = null;
      const i = pilha.map((n) => n.tag).lastIndexOf(nome);
      if (i > 0) pilha.length = i;
      continue;
    }
    const topo = pilha[pilha.length - 1] as No;
    if (texto !== "") {
      const folha = { tag: nome, texto: decodificarEntidades(texto), filhos: [] };
      topo.filhos.push(folha);
      folhaAberta = folha;
    } else {
      const agregado: No = { tag: nome, filhos: [] };
      topo.filhos.push(agregado);
      pilha.push(agregado);
      folhaAberta = null;
    }
  }
  return raiz;
}

function todos(no: No, tag: string, acc: No[] = []): No[] {
  for (const f of no.filhos) {
    if (f.tag === tag) acc.push(f);
    else todos(f, tag, acc);
  }
  return acc;
}

const primeiro = (no: No | undefined, tag: string): No | undefined =>
  no ? todos(no, tag)[0] : undefined;
const texto = (no: No | undefined, tag: string): string | null =>
  primeiro(no, tag)?.texto ?? null;

/** YYYYMMDD[HHMMSS[.XXX]][[-3:BRT]] -> YYYY-MM-DD, a data local do banco. */
export function dataOfx(bruto: string | null): string | null {
  if (!bruto) return null;
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(bruto.trim());
  if (!m) return null;
  const [, a, mes, dia] = m;
  const data = `${a}-${mes}-${dia}`;
  const t = new Date(`${data}T00:00:00Z`);
  return Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== data ? null : data;
}

/** "-1.234,56", "-1234.56", "+12,5" -> { valor: "1234.56", negativo }. */
export function valorOfx(
  bruto: string | null,
): { valor: string; negativo: boolean } | null {
  if (!bruto) return null;
  let t = bruto.trim().replace(/\s/g, "");
  const negativo = t.startsWith("-");
  t = t.replace(/^[+-]/, "");
  const virgula = t.lastIndexOf(",");
  const ponto = t.lastIndexOf(".");
  const decimal = virgula > ponto ? "," : ".";
  const milhar = decimal === "," ? "." : ",";
  t = t.split(milhar).join("").replace(decimal, ".");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return { valor: moeda(d(t)), negativo };
}

function corpoOfx(texto: string): string {
  const i = texto.search(/<OFX>/i);
  if (i < 0) throw new ErroDeLeitura("arquivo sem o bloco <OFX>");
  return texto.slice(i);
}

export const leitorOfx: LeitorDeExtrato = {
  formato: "ofx",
  reconhece(texto, nome) {
    return /\.(ofx|qfx)$/i.test(nome) || /OFXHEADER|<OFX>/i.test(texto.slice(0, 2000));
  },
  ler(textoOriginal) {
    const raiz = arvore(corpoOfx(textoOriginal));
    const cartao = primeiro(raiz, "CCSTMTRS");
    const conta = primeiro(raiz, "STMTRS");
    const extrato = cartao ?? conta;
    if (!extrato) throw new ErroDeLeitura("OFX sem extrato de conta nem de cartão");
    const avisos: string[] = [];
    const de = cartao
      ? primeiro(extrato, "CCACCTFROM")
      : primeiro(extrato, "BANKACCTFROM");
    const lista = primeiro(extrato, "BANKTRANLIST");
    const linhas: LinhaLida[] = [];
    for (const [i, t] of todos(lista ?? extrato, "STMTTRN").entries()) {
      const data = dataOfx(texto(t, "DTPOSTED"));
      const valor = valorOfx(texto(t, "TRNAMT"));
      if (!data || !valor || d(valor.valor).isZero()) {
        avisos.push(`transação ${i + 1} ignorada: data ou valor ilegível`);
        continue;
      }
      const nome = texto(t, "NAME")?.trim() ?? "";
      const memo = texto(t, "MEMO")?.trim() ?? "";
      // Banco que repete o NAME dentro do MEMO nao duplica a descricao.
      const descricao =
        nome && memo && !memo.includes(nome) && !nome.includes(memo)
          ? `${nome} ${memo}`
          : memo.length > nome.length
            ? memo
            : nome;
      linhas.push({
        indice: linhas.length,
        fitid: texto(t, "FITID")?.trim() || null,
        trntype: texto(t, "TRNTYPE")?.trim().toUpperCase() || null,
        data,
        valor: valor.valor,
        sentido: valor.negativo ? "debito" : "credito",
        descricao: descricao.replace(/\s+/g, " ").trim() || "(sem descrição)",
      });
    }
    const ledger = primeiro(extrato, "LEDGERBAL");
    const saldoValor = valorOfx(texto(ledger, "BALAMT"));
    const saldoData = dataOfx(texto(ledger, "DTASOF"));
    return {
      formato: "ofx",
      tipo: cartao ? "cartao" : "conta",
      banco:
        texto(de, "BANKID")?.trim() || texto(primeiro(raiz, "FI"), "ORG")?.trim() || null,
      conta: texto(de, "ACCTID")?.trim() || null,
      inicio: dataOfx(texto(lista, "DTSTART")),
      fim: dataOfx(texto(lista, "DTEND")),
      saldo:
        saldoValor && saldoData
          ? {
              valor: saldoValor.negativo ? `-${saldoValor.valor}` : saldoValor.valor,
              data: saldoData,
            }
          : null,
      linhas,
      avisos,
    } satisfies ExtratoLido;
  },
};
