import { Cadastro } from "@/componentes/conta/Cadastro";
import { googleHabilitado } from "@/lib/auth";

export const metadata = { title: "Criar conta" };

export default function Pagina() {
  return <Cadastro google={googleHabilitado} />;
}
