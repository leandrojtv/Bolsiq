import { NovaLeitura } from "@bolsiq/finance/puro";
import { usuarioLogado } from "@/lib/auth";
import { novaLeitura, ultimaLeitura } from "@/lib/financas-leitura";
import { naoAutenticado } from "@/lib/respostas";
import { tratarLeitura } from "@/lib/respostas-leitura";
import { erroDeEnvio } from "../arquivos";

const json = (v: FormDataEntryValue | null | undefined): unknown => {
  if (typeof v !== "string" || !v) return undefined;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
};

/**
 * multipart: `arquivos` (PDF ou imagem), `senhas` (JSON, por nome de arquivo),
 * `modelo` e `aceitar_imagem`. A senha abre o PDF em memoria e e descartada;
 * o job leva so o PDF aberto. 202 com o id: quem le e o portfolio-worker.
 */
export async function POST(req: Request) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const form = await req.formData().catch(() => null);
  const o = NovaLeitura.safeParse({
    modelo: form?.get("modelo") || undefined,
    aceitar_imagem: form?.get("aceitar_imagem") ?? undefined,
    senhas: json(form?.get("senhas")),
  });
  if (!o.success) return erroDeEnvio("Opções da leitura inválidas.");
  const arquivos = (form?.getAll("arquivos") ?? []).filter(
    (a): a is File => typeof a !== "string",
  );
  if (arquivos.length === 0) return erroDeEnvio("Envie o PDF ou a foto da fatura.");
  try {
    const job_id = await novaLeitura(
      u.id,
      await Promise.all(
        arquivos.map(async (a) => ({
          nome: a.name,
          mime: a.type,
          bytes: new Uint8Array(await a.arrayBuffer()),
          corretora: "",
          senha: o.data.senhas[a.name] ?? "",
        })),
      ),
      {
        aceitar_imagem: o.data.aceitar_imagem === "true",
        ...(o.data.modelo ? { modelo: o.data.modelo } : {}),
      },
    );
    return Response.json({ data: { job_id } }, { status: 202 });
  } catch (e) {
    return tratarLeitura(e);
  }
}

/** A ultima leitura das ultimas 24 horas: a tela volta a ela. */
export async function GET() {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  return Response.json({ data: await ultimaLeitura(u.id) });
}
