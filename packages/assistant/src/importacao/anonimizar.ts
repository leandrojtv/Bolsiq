/**
 * Tira do texto o que identifica o titular, antes de qualquer envio ao provedor.
 *
 * Fica: CNPJ (fundo e previdencia precisam dele), codigos de ativo, valores e
 * datas. Sai: CPF, conta, agencia, codigo de cliente, e-mail, telefone, CEP e as
 * linhas de nome e endereco. O nome achado numa linha rotulada sai tambem de onde
 * mais aparecer ("Ola, Fulano").
 */

export interface Remocoes {
  cpf: number;
  conta: number;
  email: number;
  telefone: number;
  linhas: number;
}

export interface TextoAnonimizado {
  texto: string;
  remocoes: Remocoes;
}

/** CPF formatado, mascarado ou nao. CNPJ (00.000.000/0000-00) nao casa: o desenho e outro. */
const CPF_FORMATADO = /(?<![\d*])[\d*]{3}\.[\d*]{3}\.[\d*]{3}-[\d*]{2}(?![\d*])/g;
/** 11 digitos soltos. Dentro de um CNPJ sem pontuacao (14) nao casa. */
const CPF_CRU = /(?<!\d)\d{11}(?!\d)/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const TELEFONE =
  /(?:\+?55\s?)?\(\d{2}\)\s?9?\d{4}-?\d{4}|(?<!\d)\+55\s?\d{2}\s?9?\d{4}-?\d{4}(?!\d)/g;
const CEP = /(?<!\d)\d{5}-\d{3}(?!\d)/g;

/** Rotulo seguido do numero: "Agência: 0001", "Conta 12345-6", "C/C 123", "Código do cliente 99". */
const CONTA =
  /\b(ag[eê]ncia|ag\.|conta(?:\s+corrente|\s+investimento|\s+n[ºo°.]?)?|c\/c|n[uú]mero\s+da\s+conta|c[oó]d(?:igo|\.)?\s*(?:do\s+)?cliente|cliente\s+n[ºo°.]?)\s*[:nº°#;\t|]*\s*\d[\d.\-/xX]{2,}/gi;

/**
 * Linha cujo rotulo e de dado pessoal. O rotulo precisa terminar em `:`, `;` ou
 * tabulacao: "Nome do ativo;Quantidade" e cabecalho de tabela, nao o titular.
 */
const ROTULO_PESSOAL =
  /^\s*(nome(?:\s+completo|\s+do\s+(?:titular|cliente|investidor))?|titular|cliente|investidor|endere[cç]o|logradouro|bairro|cidade|munic[ií]pio|uf|cep|e-?mail|telefone|celular|tel\.?|fone|data\s+de\s+nascimento|rg|cpf(?:\/cnpj)?)\s*[:;\t|]/i;

const vazio = (): Remocoes => ({ cpf: 0, conta: 0, email: 0, telefone: 0, linhas: 0 });

function nomeDaLinha(linha: string): string | null {
  const m =
    /^\s*(?:nome(?:\s+completo|\s+do\s+(?:titular|cliente|investidor))?|titular|cliente|investidor)\s*[:;\t|]\s*([A-Za-zÀ-ÿ'][A-Za-zÀ-ÿ' ]{4,80})/i.exec(
      linha,
    );
  const nome = m?.[1]?.replace(/[;\t|].*$/, "").trim();
  // Duas palavras ao menos: "Cliente: XP" nao e nome de pessoa a caçar no texto.
  return nome && nome.split(/\s+/).length >= 2 ? nome : null;
}

/** Saudacao do cabecalho da XP: "Maria da Silva, este é o seu patrimônio". */
const SAUDACAO =
  /^\s*([A-Za-zÀ-ÿ'][A-Za-zÀ-ÿ' ]{3,80}?)\s*,\s*este\s+[eé]\s+o\s+seu\s+patrim[oô]nio/gim;

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function anonimizar(texto: string): TextoAnonimizado {
  const r = vazio();
  const nomes = new Set<string>();
  for (const m of texto.matchAll(SAUDACAO)) {
    const nome = m[1]?.trim();
    if (nome && nome.split(/\s+/).length >= 2) nomes.add(nome);
  }

  const linhas = texto.split(/\r?\n/).map((linha) => {
    if (!ROTULO_PESSOAL.test(linha)) return linha;
    const nome = nomeDaLinha(linha);
    if (nome) nomes.add(nome);
    r.linhas++;
    return "[dado do titular removido]";
  });

  let limpo = linhas.join("\n");
  const trocar = (re: RegExp, marca: string, campo: keyof Remocoes) => {
    limpo = limpo.replace(re, () => {
      r[campo]++;
      return marca;
    });
  };
  trocar(EMAIL, "[e-mail]", "email");
  trocar(CPF_FORMATADO, "[cpf]", "cpf");
  trocar(CONTA, "[conta]", "conta");
  trocar(TELEFONE, "[telefone]", "telefone");
  trocar(CEP, "[cep]", "linhas");
  trocar(CPF_CRU, "[cpf]", "cpf");
  for (const nome of nomes)
    trocar(
      new RegExp(escapar(nome).replace(/\s+/g, "\\s+"), "gi"),
      "[titular]",
      "linhas",
    );
  return { texto: limpo, remocoes: r };
}

export function somarRemocoes(a: Remocoes, b: Remocoes): Remocoes {
  return {
    cpf: a.cpf + b.cpf,
    conta: a.conta + b.conta,
    email: a.email + b.email,
    telefone: a.telefone + b.telefone,
    linhas: a.linhas + b.linhas,
  };
}

export { vazio as semRemocoes };
