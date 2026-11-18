import { identificadoresDaUrl, type PeriodoDeComparacao } from "@bolsiq/analytics";
import { montarComparacao } from "@/lib/comparar";

const PERIODOS: PeriodoDeComparacao[] = ["6M", "1A", "2A", "5A", "Máx"];

export async function GET(req: Request) {
  const url = new URL(req.url);
  const ids = identificadoresDaUrl(url.searchParams.get("t"));
  const p = url.searchParams.get("p") as PeriodoDeComparacao | null;
  const periodo = p && PERIODOS.includes(p) ? p : "1A";
  return Response.json(await montarComparacao(ids, periodo));
}
