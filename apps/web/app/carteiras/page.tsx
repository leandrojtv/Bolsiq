import { redirect } from "next/navigation";
import { carteirasOuPadrao } from "@/lib/carteira";
import { exigirUsuario } from "@/lib/sessao";

export const metadata = { title: "Carteiras" };

/** Abre a primeira carteira; na primeira visita cria a "Principal". */
export default async function Pagina() {
  const u = await exigirUsuario("/carteiras");
  const [primeira] = await carteirasOuPadrao(u.id);
  redirect(`/carteiras/${primeira?.id}`);
}
