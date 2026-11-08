import { ErroDeImportacao, mensagemSegura } from "@bolsiq/assistant";
import { ErroDoAssistente, registrarErro } from "@/lib/assistente";
import { usuarioLogado } from "@/lib/auth";
import { processarImportacaoIA } from "@/lib/importacao-ia";
import { OpcoesDoEnvio, type EventoDaImportacao } from "@/lib/importacao-ia-modelo";
import { invalido, naoAutenticado } from "@/lib/respostas";
import { lerEntradas, tratarImportacaoIA } from "@/lib/respostas-importacao-ia";

export const maxDuration = 300;

/**
 * multipart: `arquivos` (varios, um por instituicao), `texto`, `modelo`,
 * `reprocessar` e `aceitar_imagem`. Devolve NDJSON: uma linha por etapa de cada
 * arquivo e, no fim de cada um, o resultado para a revisao ou o erro. Nada grava
 * na carteira: so cache e consumo.
 */
export async function POST(req: Request) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const form = await req.formData().catch(() => null);
  const opcoes = OpcoesDoEnvio.safeParse({
    modelo: form?.get("modelo") || undefined,
    reprocessar: form?.get("reprocessar") ?? undefined,
    aceitar_imagem: form?.get("aceitar_imagem") ?? undefined,
  });
  if (!opcoes.success) return invalido(opcoes.error);
  let entradas;
  try {
    entradas = await lerEntradas(form);
  } catch (e) {
    return tratarImportacaoIA(e);
  }

  const codificar = new TextEncoder();
  const corpo = new ReadableStream<Uint8Array>({
    async start(controle) {
      const enviar = (e: EventoDaImportacao) =>
        controle.enqueue(codificar.encode(`${JSON.stringify(e)}\n`));
      for (const entrada of entradas) {
        const arquivo = "texto" in entrada ? "texto colado" : entrada.nome;
        try {
          const r = await processarImportacaoIA(u.id, entrada, {
            ...(opcoes.data.modelo ? { outroModelo: opcoes.data.modelo } : {}),
            reprocessar: opcoes.data.reprocessar === "true",
            aceitarImagem: opcoes.data.aceitar_imagem === "true",
            aoAvancar: (a, etapa, detalhe) =>
              enviar({
                tipo: "etapa",
                arquivo: a,
                etapa,
                ...(detalhe ? { detalhe } : {}),
              }),
            abortar: req.signal,
          });
          if (r.atalho) enviar({ tipo: "atalho", arquivo, atalho: r.atalho });
          else if (r.resultado)
            enviar({ tipo: "resultado", arquivo, resultado: r.resultado });
        } catch (e) {
          if (e instanceof ErroDeImportacao || e instanceof ErroDoAssistente) {
            enviar({ tipo: "erro", arquivo, codigo: e.codigo, mensagem: e.message });
          } else {
            // Erro inesperado: so texto limpo vai para o log e para a tela.
            registrarErro(mensagemSegura(e));
            enviar({
              tipo: "erro",
              arquivo,
              codigo: "erro_interno",
              mensagem: "Não foi possível processar este arquivo.",
            });
          }
        }
      }
      controle.close();
    },
  });
  return new Response(corpo, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
