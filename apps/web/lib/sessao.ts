import "server-only";
import { redirect } from "next/navigation";
import { usuarioLogado, type Usuario } from "./auth";

/** Pagina que exige login. O proxy ja redireciona; isto valida a sessao de fato. */
export async function exigirUsuario(volta: string): Promise<Usuario> {
  const u = await usuarioLogado();
  if (!u) redirect(`/entrar?volta=${encodeURIComponent(volta)}`);
  return u;
}
