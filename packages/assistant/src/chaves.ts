import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Chave do provedor em repouso: AES-256-GCM, chave-mestra em variavel de
 * ambiente, descriptografada so no BFF e so na hora da chamada.
 *
 * O id do usuario entra como dado autenticado: copiar o texto cifrado para a
 * linha de outro usuario faz a decifragem falhar, em vez de entregar a chave.
 */
const PREFIXO = "v1";

export class ErroDeChaveMestra extends Error {}

/** ASSISTANT_MASTER_KEY: 32 bytes em base64 (`openssl rand -base64 32`). */
export function lerChaveMestra(valor: string | undefined): Buffer {
  const bytes = Buffer.from(valor ?? "", "base64");
  if (bytes.length !== 32)
    throw new ErroDeChaveMestra("ASSISTANT_MASTER_KEY precisa ter 32 bytes em base64");
  return bytes;
}

export function cifrarChave(chave: string, mestra: Buffer, userId: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", mestra, iv);
  c.setAAD(Buffer.from(userId));
  const corpo = Buffer.concat([c.update(chave, "utf8"), c.final()]);
  return [PREFIXO, iv, c.getAuthTag(), corpo]
    .map((p) => (typeof p === "string" ? p : p.toString("base64")))
    .join(".");
}

export function decifrarChave(cifrada: string, mestra: Buffer, userId: string): string {
  const [versao, iv, tag, corpo] = cifrada.split(".");
  if (versao !== PREFIXO || !iv || !tag || corpo === undefined)
    throw new Error("chave cifrada em formato desconhecido");
  const d = createDecipheriv("aes-256-gcm", mestra, Buffer.from(iv, "base64"));
  d.setAAD(Buffer.from(userId));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(corpo, "base64")), d.final()]).toString(
    "utf8",
  );
}

/** O unico pedaco da chave que sai do servidor. */
export const finalDaChave = (chave: string): string => chave.slice(-4);

/** Formatos conhecidos de chave, para o caso de o texto trazer uma que nao e a do usuario. */
const PADROES = [
  /sk-[A-Za-z0-9_-]{8,}/g,
  /AIza[A-Za-z0-9_-]{16,}/g,
  /Bearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi,
  /(x-api-key|x-goog-api-key|authorization)["':=\s]+[^\s"',}]{8,}/gi,
];

/** Tira as chaves informadas e os formatos conhecidos de um texto. */
export function removerSegredos(texto: string, segredos: readonly string[] = []): string {
  let limpo = texto;
  for (const s of segredos) if (s) limpo = limpo.split(s).join("[removido]");
  for (const p of PADROES) limpo = limpo.replace(p, "[removido]");
  return limpo;
}

/**
 * Erro de provedor em texto seguro para log e para a tela.
 *
 * So le `message` e `statusCode`. O APICallError do AI SDK tambem carrega
 * `requestBodyValues`, `responseHeaders` e `url`; logar o objeto inteiro levaria
 * carteira e cabecalhos junto.
 */
export function mensagemSegura(erro: unknown, segredos: readonly string[] = []): string {
  const e = erro as { message?: unknown; statusCode?: unknown } | null | undefined;
  const status = typeof e?.statusCode === "number" ? ` (HTTP ${e.statusCode})` : "";
  const texto = typeof e?.message === "string" ? e.message : "erro desconhecido";
  return removerSegredos(`${texto.slice(0, 300)}${status}`, segredos);
}
