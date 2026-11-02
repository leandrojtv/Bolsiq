import { buscarV1, validadeDe } from "@/lib/market-data";

/**
 * BFF do /v1: o navegador chama /api/v1/..., o servidor repassa ao market-data
 * com a chave interna. So caminhos de leitura da lista entram; /admin e
 * qualquer outro respondem 404 sem tocar o upstream.
 */
export async function GET(req: Request, ctx: { params: Promise<{ caminho: string[] }> }) {
  const { caminho } = await ctx.params;
  const alvo = caminho.join("/");
  const validade = validadeDe(alvo);
  if (validade === null) {
    return Response.json(
      { error: { code: "not_found", message: "Rota inexistente." } },
      { status: 404 },
    );
  }
  const consulta = new URL(req.url).search;
  try {
    const { status, corpo } = await buscarV1(`${alvo}${consulta}`, validade);
    return Response.json(corpo, {
      status,
      headers:
        status === 200
          ? { "cache-control": `private, max-age=${Math.min(validade, 60)}` }
          : {},
    });
  } catch {
    return Response.json(
      { error: { code: "source_unavailable", message: "market-data indisponível." } },
      { status: 503 },
    );
  }
}
