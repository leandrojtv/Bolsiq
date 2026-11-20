/**
 * Nome de pessoa em descricao de PIX e transferencia nao vai ao provedor.
 *
 * So mexe na descricao que tem marca de transferencia (PIX, TED, DOC, TEF,
 * TRANSF...). Ali, o que nao e palavra do banco, numero ou empresa (LTDA, S/A,
 * ME, EIRELI) vira "[pessoa]". Erra para o lado da privacidade: PIX para uma loja
 * sem sufixo de empresa tambem perde o nome.
 */

const MARCA = /\b(PIX|TED|DOC|TEF|TRANSF\w*|TRANSFER\w*)\b/i;

/** Palavras de extrato que ficam. Comparadas sem acento e em maiusculas. */
const DO_BANCO = new Set([
  "PIX",
  "TED",
  "DOC",
  "TEF",
  "TRANSF",
  "TRANSFERENCIA",
  "TRANSFERENCIAS",
  "ENVIADO",
  "ENVIADA",
  "ENV",
  "RECEBIDO",
  "RECEBIDA",
  "REC",
  "EMITIDO",
  "EMITIDA",
  "QR",
  "QRCODE",
  "CODE",
  "CHAVE",
  "AGENDADO",
  "AGENDADA",
  "DEVOLUCAO",
  "DEVOLVIDO",
  "ESTORNO",
  "CONTA",
  "CORRENTE",
  "POUPANCA",
  "MESMA",
  "TITULARIDADE",
  "INTERNA",
  "ENTRE",
  "CONTAS",
  "DE",
  "DA",
  "DO",
  "PARA",
  "P",
  "A",
  "E",
  "EM",
  "SAQUE",
  "DEPOSITO",
  "CREDITO",
  "DEBITO",
  "PAGAMENTO",
  "PGTO",
  "PAG",
  "BANCO",
  "AGENCIA",
  "AG",
  "CC",
  "OUTRA",
  "INSTITUICAO",
]);

const EMPRESA = /\b(LTDA|S\/?A|ME|EPP|EIRELI|MEI|CIA|COMERCIO|SERVICOS|BANCO)\b/i;
const CPF = /(?<![\d*])[\d*]{3}\.?[\d*]{3}\.?[\d*]{3}-?[\d*]{2}(?![\d*])/g;

const semAcento = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();

export function anonimizarDescricao(descricao: string): string {
  if (!MARCA.test(descricao)) return descricao;
  const semCpf = descricao.replace(CPF, "[documento]");
  if (EMPRESA.test(semAcento(semCpf))) return semCpf;
  const palavras = semCpf
    .split(/\s+/)
    .filter(Boolean)
    .map((parte) => {
      const p = semAcento(parte).replace(/[^A-Z0-9[\]]/g, "");
      const fica = p === "" || /\d/.test(p) || p.startsWith("[") || DO_BANCO.has(p);
      return fica ? parte : "[pessoa]";
    });
  // "JOAO DA SILVA" vira um marcador so.
  return palavras
    .join(" ")
    .replace(/\[pessoa\](\s+((d[aeo]s?|e)\s+)?\[pessoa\])+/gi, "[pessoa]");
}
