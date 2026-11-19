import { EmptyState } from "@bolsiq/ui";
import { LayoutGrid } from "lucide-react";
import { exigirUsuario } from "@/lib/sessao";

export const metadata = { title: "Painel geral" };

/** Visao consolidada de investimentos e financas: chega numa etapa seguinte. */
export default async function Pagina() {
  await exigirUsuario("/painel");
  return (
    <>
      <h1 className="m-0 text-[26px] font-bold tracking-tight">Painel geral</h1>
      <EmptyState
        icon={<LayoutGrid aria-hidden="true" size={28} />}
        title="O painel consolidado está a caminho"
        description="Aqui vão aparecer juntos o patrimônio dos investimentos e o mês das suas finanças. Enquanto isso, use Investimentos e Finanças pelo seletor acima."
      />
    </>
  );
}
