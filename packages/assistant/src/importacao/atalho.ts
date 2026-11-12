/** Layouts que o importador atual ja le sem IA. */
export type Atalho = "bolsiq" | "b3" | "posicao_bolsiq";

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** O mesmo reconhecimento por cabecalho da tela de importacao. */
export function detectarAtalho(conteudo: string): Atalho | null {
  const cabecalho = semAcento(conteudo.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] ?? "");
  const colunas = cabecalho.split(/[;,]/).map((c) => c.trim().replace(/^"|"$/g, ""));
  if (colunas.includes("data_posicao") && colunas.includes("classe"))
    return "posicao_bolsiq";
  if (["data", "ticker", "tipo", "quantidade", "preco"].every((c) => colunas.includes(c)))
    return "bolsiq";
  const tem = (n: string) => colunas.some((c) => c.includes(n));
  if (tem("movimentacao") && tem("codigo") && tem("quantidade") && tem("preco"))
    return "b3";
  if (tem("data do negocio") && tem("codigo de negociacao")) return "b3";
  return null;
}
