import { PainelGeral } from "@/componentes/painel/PainelGeral";
import { exigirUsuario } from "@/lib/sessao";

export const metadata = { title: "Painel geral" };

/** Investimentos e Finanças juntos (ADR 0037). */
export default async function Pagina() {
  await exigirUsuario("/painel");
  return <PainelGeral />;
}
