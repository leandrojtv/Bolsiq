import { executarScreener } from "@bolsiq/analytics";
import { Screener } from "@/componentes/screener/Screener";
import { banco } from "@/lib/analytics";
import { estadoDaUrl, filtroDoEstado } from "@/lib/screener-url";

export const metadata = { title: "Screener" };

export default async function Pagina({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const estado = estadoDaUrl(new URLSearchParams(await searchParams));
  const inicio = performance.now();
  const resultado = await executarScreener(banco(), filtroDoEstado(estado)).catch(
    () => null,
  );
  const inicial = resultado
    ? { ...resultado, ms: Math.round(performance.now() - inicio) }
    : null;
  return <Screener estado={estado} inicial={inicial} />;
}
