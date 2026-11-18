import { notFound } from "next/navigation";
import { PaginaDaCarteira } from "@/componentes/carteira/PaginaDaCarteira";
import { ErroDeCarteira, painel } from "@/lib/carteira";
import { exigirUsuario } from "@/lib/sessao";

export const metadata = { title: "Carteira" };

export default async function Pagina({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await exigirUsuario(`/carteiras/${id}`);
  // Carteira de outro usuario e 404, igual a inexistente: nao confirma que existe.
  const dados = await painel(u.id, id).catch((e: unknown) => {
    if (e instanceof ErroDeCarteira && e.status === 404) notFound();
    throw e;
  });
  return <PaginaDaCarteira inicial={dados} />;
}
