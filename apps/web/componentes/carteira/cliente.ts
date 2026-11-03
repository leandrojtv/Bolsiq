import { api } from "@/lib/api";
import type { NovaTransacao } from "@/lib/carteira-modelo";
import type { PainelDaCarteira, RelatorioNaTela } from "@/lib/carteira";

const json = (method: string, corpo: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(corpo),
});

export const chaveDoPainel = (id: string) => ["carteira", id] as const;

export const lerPainel = (id: string) =>
  api<{ data: PainelDaCarteira }>(`carteiras/${id}`).then((r) => r.data);

export const criarCarteira = (nome: string) =>
  api<{ data: { id: string; nome: string } }>("carteiras", json("POST", { nome })).then(
    (r) => r.data,
  );

export const adicionarTransacao = (id: string, t: NovaTransacao) =>
  api<{ data: { id: string } }>(`carteiras/${id}/transacoes`, json("POST", t));

export function importarArquivo(id: string, arquivo: File, formato: "bolsiq" | "b3") {
  const form = new FormData();
  form.set("arquivo", arquivo);
  form.set("formato", formato);
  return api<{ data: RelatorioNaTela }>(`carteiras/${id}/importacoes`, {
    method: "POST",
    body: form,
  }).then((r) => r.data);
}
