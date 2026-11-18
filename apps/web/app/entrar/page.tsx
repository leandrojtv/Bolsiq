import { Entrar } from "@/componentes/conta/Entrar";
import { googleHabilitado } from "@/lib/auth";

export const metadata = { title: "Entrar" };

const AVISOS: Record<string, string> = {
  senha: "Senha alterada. Entre com a nova senha.",
  excluida: "Conta excluída. Seus dados foram apagados.",
};

export default async function Pagina({
  searchParams,
}: {
  searchParams: Promise<{ volta?: string; aviso?: string }>;
}) {
  const { volta, aviso } = await searchParams;
  const texto = aviso ? AVISOS[aviso] : undefined;
  return (
    <Entrar
      google={googleHabilitado}
      {...(volta ? { volta } : {})}
      {...(texto ? { aviso: texto } : {})}
    />
  );
}
