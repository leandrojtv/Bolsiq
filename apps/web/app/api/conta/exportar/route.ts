import { usuarioLogado } from "@/lib/auth";
import { exportarDados } from "@/lib/conta";
import { naoAutenticado } from "@/lib/respostas";

export const dynamic = "force-dynamic";

export async function GET() {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const dados = await exportarDados(u.id);
  return new Response(JSON.stringify(dados, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="bolsiq-meus-dados-${dados.gerado_em.slice(0, 10)}.json"`,
      "cache-control": "no-store",
    },
  });
}
