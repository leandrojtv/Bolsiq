"use client";

import { useState, type FormEvent } from "react";
import { Button, SegmentedControl } from "@bolsiq/ui";
import type { RelatorioNaTela } from "@/lib/carteira";
import { importarArquivo } from "./cliente";

/** Importacao de CSV do Bolsiq ou extrato da B3, com relatorio de rejeitadas. */
export function Importar({
  carteira,
  onImportado,
}: {
  carteira: string;
  onImportado: () => void;
}) {
  const [formato, setFormato] = useState<"bolsiq" | "b3">("bolsiq");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [relatorio, setRelatorio] = useState<RelatorioNaTela | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!arquivo) return setErro("Escolha o arquivo.");
    setErro(null);
    setEnviando(true);
    try {
      setRelatorio(await importarArquivo(carteira, arquivo, formato));
      onImportado();
    } catch (falha) {
      setErro((falha as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={(e) => void enviar(e)} className="flex flex-col gap-3">
        <SegmentedControl<"bolsiq" | "b3">
          label="Formato"
          value={formato}
          onChange={setFormato}
          options={[
            { value: "bolsiq", label: "CSV Bolsiq" },
            { value: "b3", label: "Extrato B3" },
          ]}
        />
        <p className="m-0 text-[13px] text-text-2">
          {formato === "bolsiq"
            ? "Colunas: data; ticker; tipo; quantidade; preco; taxas; corretora. Separador ; ou , e número em pt-BR."
            : "Arquivo de movimentação exportado da Área do Investidor da B3, em CSV."}
        </p>
        <label className="flex flex-col gap-1.5 text-xs text-text-3">
          Arquivo CSV
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
            className="text-sm text-text file:mr-3 file:h-touch file:rounded-control file:border file:border-border-strong file:bg-surface file:px-3 file:text-text"
          />
        </label>
        {erro && (
          <p role="alert" className="m-0 text-sm text-down">
            {erro}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={enviando || !arquivo}>
          {enviando ? "Importando…" : "Importar"}
        </Button>
      </form>

      {relatorio && (
        <section aria-label="Relatório da importação" className="flex flex-col gap-2">
          <p role="status" className="m-0 text-sm">
            {relatorio.linhas_aceitas} de {relatorio.linhas_lidas} linhas importadas em{" "}
            {(relatorio.duracao_ms / 1000).toLocaleString("pt-BR", {
              maximumFractionDigits: 2,
            })}{" "}
            s.
            {relatorio.linhas_rejeitadas > 0 &&
              ` ${relatorio.linhas_rejeitadas} rejeitadas:`}
          </p>
          {relatorio.rejeicoes.length > 0 && (
            <div className="max-h-64 overflow-auto rounded-control border border-border">
              <table className="w-full border-collapse text-[12px]">
                <thead className="sticky top-0 bg-surface text-text-3">
                  <tr>
                    <th scope="col" className="p-2 text-left font-medium">
                      Linha
                    </th>
                    <th scope="col" className="p-2 text-left font-medium">
                      Motivo
                    </th>
                    <th scope="col" className="p-2 text-left font-medium">
                      Conteúdo
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {relatorio.rejeicoes.map((r) => (
                    <tr key={r.linha} className="border-t border-border align-top">
                      <td className="p-2 font-mono">{r.linha}</td>
                      <td className="p-2">{r.motivo}</td>
                      <td className="p-2 font-mono break-all text-text-2">
                        {r.conteudo}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
