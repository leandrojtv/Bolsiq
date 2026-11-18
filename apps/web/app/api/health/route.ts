export const dynamic = "force-dynamic";

/** Health do app, para o HEALTHCHECK da imagem e o compose. Nao depende do market-data. */
export function GET() {
  return Response.json({ status: "ok" });
}
