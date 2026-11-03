import { Redefinir } from "@/componentes/conta/Recuperar";

export const metadata = { title: "Nova senha" };

export default async function Pagina({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  return (
    <Redefinir {...(token ? { token } : {})} {...(error ? { erroDoLink: error } : {})} />
  );
}
