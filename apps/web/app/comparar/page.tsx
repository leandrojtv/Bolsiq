import { identificadoresDaUrl, type PeriodoDeComparacao } from "@bolsiq/analytics/puro";
import { Comparador } from "@/componentes/comparar/Comparador";
import { montarComparacao } from "@/lib/comparar";

export const metadata = { title: "Comparador" };

const PERIODOS: PeriodoDeComparacao[] = ["6M", "1A", "2A", "5A", "Máx"];

export default async function Pagina({
  searchParams,
}: {
  searchParams: Promise<{ t?: string; p?: string }>;
}) {
  const sp = await searchParams;
  const ids = identificadoresDaUrl(sp.t ?? null);
  const periodo = PERIODOS.find((p) => p === sp.p) ?? "1A";
  const inicial = await montarComparacao(ids, periodo);
  return <Comparador ids={ids} periodo={periodo} inicial={inicial} />;
}
