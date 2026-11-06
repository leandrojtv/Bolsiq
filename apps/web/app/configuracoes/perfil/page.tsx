import { PerfilDeInvestidor } from "@/componentes/assistente/PerfilDeInvestidor";
import { exigirUsuario } from "@/lib/sessao";

export const metadata = { title: "Perfil do investidor" };
export const dynamic = "force-dynamic";

export default async function Pagina() {
  await exigirUsuario("/configuracoes/perfil");
  return <PerfilDeInvestidor />;
}
