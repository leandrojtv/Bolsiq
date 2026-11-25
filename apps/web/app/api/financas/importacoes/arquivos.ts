import { Mapeamentos, type ArquivoRecebido, type MapeamentoDeCsv } from "@bolsiq/finance";
import { limitesDeImportacao } from "@/lib/financas";

/** Os arquivos do campo `arquivos` do multipart, ou a mensagem do erro. */
export async function arquivosDoForm(
  form: FormData | null,
): Promise<ArquivoRecebido[] | string> {
  // FormDataEntryValue e string ou File; `typeof` nao depende de qual File global.
  const lista =
    form?.getAll("arquivos").filter((a): a is File => typeof a !== "string") ?? [];
  if (lista.length === 0) return "Envie pelo menos um arquivo .ofx ou .csv.";
  const limites = limitesDeImportacao();
  if (lista.length > limites.arquivos)
    return `Envie no máximo ${limites.arquivos} arquivos por vez.`;
  // O tamanho e conferido antes de ler os bytes do arquivo para a memoria.
  const grande = lista.find((a) => a.size > limites.bytes);
  if (grande) return `${grande.name} passa do limite de tamanho.`;
  return Promise.all(
    lista.map(async (a) => ({
      nome: a.name,
      bytes: new Uint8Array(await a.arrayBuffer()),
    })),
  );
}

/** O campo `mapeamentos` (JSON) do multipart: colunas de CSV desconhecido. */
export function mapeamentosDoForm(form: FormData | null): MapeamentoDeCsv[] | string {
  const v = form?.get("mapeamentos");
  if (typeof v !== "string" || !v) return [];
  let bruto: unknown;
  try {
    bruto = JSON.parse(v);
  } catch {
    return "Mapeamento de colunas inválido.";
  }
  const r = Mapeamentos.safeParse(bruto);
  return r.success
    ? r.data
    : `Mapeamento de colunas inválido: ${r.error.issues[0]?.message ?? ""}`;
}

export const erroDeEnvio = (message: string) =>
  Response.json({ error: { code: "validation_error", message } }, { status: 422 });
