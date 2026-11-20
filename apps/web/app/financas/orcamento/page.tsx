import { redirect } from "next/navigation";

/** O orcamento por categoria e o planejamento do mes (ADR 0034). */
export default function Pagina() {
  redirect("/financas/planejamento");
}
