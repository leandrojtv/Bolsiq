import "server-only";
import { ErroDeImportacao } from "@bolsiq/assistant";
import { ErroDoAssistente } from "./assistente";
import { ErroDeCarteira } from "./carteira";
import type { EntradaDoUsuario } from "./importacao-ia";
import { tratarCarteira } from "./respostas-carteira";

export const MAX_ARQUIVOS = 10;

export function tratarImportacaoIA(erro: unknown) {
  if (erro instanceof ErroDeImportacao || erro instanceof ErroDoAssistente)
    return Response.json(
      { error: { code: erro.codigo, message: erro.message } },
      { status: erro.status },
    );
  if (erro instanceof ErroDeCarteira) return tratarCarteira(erro);
  throw erro;
}

/** `arquivos` (varios) e `texto` (colado) do multipart. */
export async function lerEntradas(form: FormData | null): Promise<EntradaDoUsuario[]> {
  const arquivos = (form?.getAll("arquivos") ?? []).filter(
    (a): a is File => a instanceof File,
  );
  const texto = form?.get("texto");
  if (arquivos.length > MAX_ARQUIVOS)
    throw new ErroDeImportacao(
      "arquivos_demais",
      `Envie até ${MAX_ARQUIVOS} arquivos por vez.`,
    );
  const entradas: EntradaDoUsuario[] = await Promise.all(
    arquivos.map(async (a) => ({
      nome: a.name,
      mime: a.type,
      bytes: new Uint8Array(await a.arrayBuffer()),
    })),
  );
  if (typeof texto === "string" && texto.trim()) entradas.push({ texto });
  if (entradas.length === 0)
    throw new ErroDeImportacao("vazio", "Envie um arquivo ou cole o texto do extrato.");
  return entradas;
}
