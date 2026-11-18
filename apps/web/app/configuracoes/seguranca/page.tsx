import { headers } from "next/headers";
import { Seguranca } from "@/componentes/conta/Seguranca";
import { auth } from "@/lib/auth";
import { exigirUsuario } from "@/lib/sessao";

export const metadata = { title: "Segurança" };

export default async function Pagina() {
  await exigirUsuario("/configuracoes/seguranca");
  const s = await auth.api.getSession({
    headers: await headers(),
    query: { disableCookieCache: true },
  });
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <h1 className="m-0 text-2xl font-bold">Segurança</h1>
      <Seguranca ativo={Boolean(s?.user.twoFactorEnabled)} />
    </div>
  );
}
