import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Duas coisas antes de qualquer rota:
 *
 * 1. Rotas que exigem login redirecionam para /entrar quando nao ha cookie
 *    de sessao. E so o atalho: a pagina e o BFF validam a sessao de verdade.
 * 2. Identidade provisoria por aparelho (ADR 0021): sem login, alertas e
 *    preferencias precisam de dono. O primeiro acesso recebe um id aleatorio
 *    num cookie httpOnly; no login, o que estiver nele migra para a conta.
 */
export const COOKIE_DO_USUARIO = "bolsiq_uid";
const EXIGEM_LOGIN = ["/carteiras", "/configuracoes/conta", "/configuracoes/seguranca"];

export function proxy(req: NextRequest) {
  const caminho = req.nextUrl.pathname;
  if (EXIGEM_LOGIN.some((p) => caminho === p || caminho.startsWith(`${p}/`))) {
    if (!getSessionCookie(req)) {
      const entrar = new URL("/entrar", req.url);
      entrar.searchParams.set("volta", caminho + req.nextUrl.search);
      return NextResponse.redirect(entrar);
    }
  }

  if (req.cookies.get(COOKIE_DO_USUARIO)?.value) return NextResponse.next();
  const id = `dev_${crypto.randomUUID()}`;
  // O handler desta mesma requisicao ja precisa do id: vai no header e no cookie.
  const cabecalhos = new Headers(req.headers);
  cabecalhos.set(
    "cookie",
    `${req.headers.get("cookie") ?? ""}; ${COOKIE_DO_USUARIO}=${id}`.replace(/^; /, ""),
  );
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
  matcher: [
    "/((?!_next/static|_next/image|icones|sw.js|manifest.webmanifest|favicon.ico).*)",
  ],
};
