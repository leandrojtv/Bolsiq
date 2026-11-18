import { PaginaDeAlertas } from "@/componentes/alertas/PaginaDeAlertas";

export const metadata = { title: "Alertas" };

export default async function Pagina({
  searchParams,
}: {
  searchParams: Promise<{ t?: string; n?: string }>;
}) {
  const { t, n } = await searchParams;
  const ticker = /^[A-Za-z0-9]{4,12}$/.test(t ?? "") ? t?.toUpperCase() : undefined;
  const destacar = /^[0-9a-f-]{36}$/.test(n ?? "") ? n : undefined;
  return (
    <PaginaDeAlertas
      {...(ticker ? { ticker } : {})}
      {...(destacar ? { destacar } : {})}
    />
  );
}
