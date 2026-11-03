import "server-only";
import { cookies } from "next/headers";
import { usuarioLogado } from "./auth";

export const COOKIE_DO_USUARIO = "bolsiq_uid";
const ID_PROVISORIO = /^dev_[0-9a-f-]{36}$/;

/** Id provisorio do aparelho (ADR 0021), ou null. */
export async function idProvisorio(): Promise<string | null> {
  const id = (await cookies()).get(COOKIE_DO_USUARIO)?.value;
  return id && ID_PROVISORIO.test(id) ? id : null;
}

/**
 * Dono dos dados da requisicao: o usuario logado; sem login, o id provisorio
 * do aparelho, que o proxy garante (ADR 0021). Alertas funcionam nos dois;
 * carteira exige login (`exigirUsuario`).
 */
export async function usuarioAtual(): Promise<string> {
  const u = await usuarioLogado();
  if (u) return u.id;
  const id = await idProvisorio();
  if (!id) throw new Error("requisicao sem identidade");
  return id;
}
