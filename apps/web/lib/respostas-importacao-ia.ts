import "server-only";
import { ErroDeImportacao } from "@bolsiq/assistant";
import { ErroDoAssistente } from "./assistente";
import { ErroDeCarteira } from "./carteira";
import type { ArquivoEnviado } from "./importacao-ia";
import { OpcoesDoEnvio } from "./importacao-ia-modelo";
import { tratarCarteira } from "./respostas-carteira";

/** Erro de importacao em portugues e com codigo; o resto sobe para o Next. */
export function tratarImportacaoIA(erro: unknown) {
  if (erro instanceof ErroDeImportacao || erro instanceof ErroDoAssistente)
    return Response.json(
      { error: { code: erro.codigo, message: erro.message } },
      { status: erro.status },
    );
  if (erro instanceof ErroDeCarteira) return tratarCarteira(erro);
  throw erro;
}

const json = (v: FormDataEntryValue | null | undefined, padrao: unknown): unknown => {
  if (typeof v !== "string" || !v) return padrao;
  try {
    return JSON.parse(v);
  } catch {
    return padrao;
  }
};

/**
 * multipart: `arquivos` (varios), `texto` (colado, vira um arquivo .txt),
 * `corretoras` e `senhas` (JSON), `modelo` e `aceitar_imagem`.
 */
export async function lerEnvio(form: FormData | null) {
  const opcoes = OpcoesDoEnvio.safeParse({
    modelo: form?.get("modelo") || undefined,
    aceitar_imagem: form?.get("aceitar_imagem") ?? undefined,
    corretoras: json(form?.get("corretoras"), []),
    senhas: json(form?.get("senhas"), {}),
  });
  if (!opcoes.success)
    throw new ErroDeImportacao("validation_error", "Opções do envio inválidas.");
  const o = opcoes.data;
  const arquivos = (form?.getAll("arquivos") ?? []).filter(
    (a): a is File => a instanceof File,
  );
  const enviados: ArquivoEnviado[] = await Promise.all(
    arquivos.map(async (a, i) => ({
      nome: a.name,
      mime: a.type,
      bytes: new Uint8Array(await a.arrayBuffer()),
      corretora: o.corretoras[i] ?? "",
      senha: o.senhas[a.name] ?? "",
    })),
  );
  const texto = form?.get("texto");
  if (typeof texto === "string" && texto.trim())
    enviados.push({
      nome: "texto-colado.txt",
      mime: "text/plain",
      bytes: new TextEncoder().encode(texto),
      corretora: o.corretoras[arquivos.length] ?? "",
      senha: "",
    });
  if (enviados.length === 0)
    throw new ErroDeImportacao("vazio", "Envie um arquivo ou cole o texto do extrato.");
  return {
    arquivos: enviados,
    modelo: o.modelo,
    aceitar_imagem: o.aceitar_imagem === "true",
  };
}
