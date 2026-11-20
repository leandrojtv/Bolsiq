import { DetalheDaFatura } from "@/componentes/financas/Fatura";

export const metadata = { title: "Fatura" };

export default async function Pagina({
  params,
}: {
  params: Promise<{ id: string; fatura: string }>;
}) {
  const { id, fatura } = await params;
  return <DetalheDaFatura cartao={id} fatura={fatura} />;
}
