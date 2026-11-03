import { NextResponse, type NextRequest } from "next/server";

/**
 * Identidade provisoria por aparelho (ADR 0021).
 *
 * Sem login ainda (Prompt E), alertas, notificacoes e preferencias precisam de
 * um dono. O primeiro acesso recebe um id aleatorio num cookie httpOnly; e
 * esse id que vira `user_id`. Com o Better Auth, o id do usuario logado passa
 * a valer e os registros deste cookie migram para a conta.
 */
export const COOKIE_DO_USUARIO = "bolsiq_uid";

export function proxy(req: NextRequest) {
  if (req.cookies.get(COOKIE_DO_USUARIO)?.value) return NextResponse.next();
  const id = `dev_${crypto.randomUUID()}`;
  // O handler desta mesma requisicao ja precisa do id: vai no header e no cookie.
  const cabecalhos = new Headers(req.headers);
  cabecalhos.set("cookie", `${req.headers.get("cookie") ?? ""}; ${COOKIE_DO_USUARIO}=${id}`.replace(/^; /, ""));
  const res = NextResponse.next({ request: { headers: cabecalhos } });
  res.cookies.set(COOKIE_DO_USUARIO, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && req.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icones|sw.js|manifest.webmanifest|favicon.ico).*)"],
};
