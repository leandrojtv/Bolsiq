import { MinhaConta } from "@/componentes/conta/MinhaConta";
import { exigirUsuario } from "@/lib/sessao";

export const metadata = { title: "Minha conta" };

export default async function Pagina() {
  return <MinhaConta usuario={await exigirUsuario("/configuracoes/conta")} />;
}
