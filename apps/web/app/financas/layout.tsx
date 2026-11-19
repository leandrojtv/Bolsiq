import type { ReactNode } from "react";
import { iniciarFinancas } from "@/lib/financas";
import { exigirUsuario } from "@/lib/sessao";

export const metadata = {
  title: { default: "Bolsiq Finanças", template: "%s · Bolsiq Finanças" },
};

/** Primeiro acesso ao modulo semeia as categorias padrao (idempotente). */
export default async function LayoutDeFinancas({ children }: { children: ReactNode }) {
  const u = await exigirUsuario("/financas");
  await iniciarFinancas(u.id);
  return children;
}
