import { ConfiguracaoDoAssistente } from "@/componentes/assistente/ConfiguracaoDoAssistente";
import { exigirUsuario } from "@/lib/sessao";

export const metadata = { title: "Assistente" };
export const dynamic = "force-dynamic";

export default async function Pagina() {
  await exigirUsuario("/configuracoes/assistente");
  return <ConfiguracaoDoAssistente />;
}
