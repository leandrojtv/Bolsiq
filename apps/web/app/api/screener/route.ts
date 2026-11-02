import { executarScreener, FiltroDeScreener } from "@bolsiq/analytics";
import { banco } from "@/lib/analytics";

/**
 * Screener: o filtro e validado pelo mesmo schema Zod do analytics. Faixa
 * invalida (min maior que max, indicador inexistente) responde 422 com o
 * motivo, em vez de uma consulta que nunca casa.
 */
export async function POST(req: Request) {
  const corpo: unknown = await req.json().catch(() => null);
  const filtro = FiltroDeScreener.safeParse(corpo ?? {});
  if (!filtro.success) {
    return Response.json(
      {
        error: {
          code: "validation_error",
          message: "Filtro inválido.",
          details: filtro.error.issues,
        },
      },
      { status: 422 },
    );
  }
  const inicio = performance.now();
  const resultado = await executarScreener(banco(), filtro.data);
  const ms = Math.round(performance.now() - inicio);
  return Response.json(
    { ...resultado, filtro: filtro.data, ms },
    { headers: { "server-timing": `db;dur=${ms}` } },
  );
}
