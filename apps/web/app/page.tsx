import { redirect } from "next/navigation";

/** Sem painel inicial ainda: a entrada e a pagina do ativo mais negociado. */
export default function Inicio() {
  redirect("/ativo/PETR4");
}
