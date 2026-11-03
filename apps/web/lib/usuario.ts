import "server-only";
import { cookies } from "next/headers";

const COOKIE_DO_USUARIO = "bolsiq_uid";

/** Id do usuario da requisicao. O proxy garante o cookie (ADR 0021). */
export async function usuarioAtual(): Promise<string> {
  const id = (await cookies()).get(COOKIE_DO_USUARIO)?.value;
  if (!id || !/^dev_[0-9a-f-]{36}$/.test(id))
    throw new Error("requisicao sem identidade");
  return id;
}
