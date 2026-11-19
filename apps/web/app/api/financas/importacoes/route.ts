import { NovaImportacao } from "@bolsiq/finance/puro";
import { usuarioLogado } from "@/lib/auth";
import { invalido, naoAutenticado } from "@/lib/respostas";
import { tratarFinancas } from "@/lib/respostas-financas";
import { importacoes, novaImportacao } from "@/lib/financas";
import { arquivosDoForm, erroDeEnvio } from "./arquivos";

export async function GET() {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  return Response.json({ data: await importacoes(u.id) });
}

/** multipart: `arquivos` e os campos de NovaImportacao. Cria a revisao, sem gravar lancamento. */
export async function POST(req: Request) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const form = await req.formData().catch(() => null);
  const campo = (k: string) => {
    const v = form?.get(k);
    return typeof v === "string" && v !== "" ? v : undefined;
  };
  const r = NovaImportacao.safeParse({
    alvo: campo("alvo"),
    account_id: campo("account_id"),
    card_id: campo("card_id"),
    vencimento: campo("vencimento"),
  });
  if (!r.success) return invalido(r.error);
  const arquivos = await arquivosDoForm(form);
  if (typeof arquivos === "string") return erroDeEnvio(arquivos);
  try {
    return Response.json(
      { data: await novaImportacao(u.id, r.data, arquivos) },
      { status: 201 },
    );
  } catch (erro) {
    return tratarFinancas(erro);
  }
}
