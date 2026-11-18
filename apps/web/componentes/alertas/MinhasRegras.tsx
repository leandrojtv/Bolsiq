"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, EmptyState, Switch } from "@bolsiq/ui";
import { ROTULO_DO_CANAL, type RegraNaTela } from "@/lib/alertas-modelo";
import { CHAVES, alterarRegra, listarRegras, quando } from "./cliente";

export function MinhasRegras() {
  const cliente = useQueryClient();
  const { data, isPending } = useQuery({
    queryKey: CHAVES.regras,
    queryFn: listarRegras,
  });
  const alternar = useMutation({
    mutationFn: ({ id, ativo }: { id: string; ativo: boolean }) =>
      alterarRegra(id, ativo),
    onMutate: ({ id, ativo }) => {
      cliente.setQueryData<{ data: RegraNaTela[] }>(
        CHAVES.regras,
        (atual) =>
          atual && { data: atual.data.map((r) => (r.id === id ? { ...r, ativo } : r)) },
      );
    },
    onSettled: () => cliente.invalidateQueries({ queryKey: CHAVES.regras }),
  });

  const regras = data?.data ?? [];
  const ativas = regras.filter((r) => r.ativo).length;
  return (
    <Card
      aria-label="Minhas regras"
      title={
        <>
          Minhas regras <span className="font-normal text-text-3">{ativas} ativas</span>
        </>
      }
    >
      {!isPending && regras.length === 0 ? (
        <EmptyState
          title="Nenhuma regra"
          description="Crie a primeira no formulário acima."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-[13px]">
            <thead>
              <tr className="text-text-3">
                {["Ativo", "Condição", "Canais", "Último disparo"].map((c) => (
                  <th key={c} scope="col" className="p-2 text-left font-medium">
                    {c}
                  </th>
                ))}
                <th scope="col" className="p-2 text-right font-medium">
                  Ativa
                </th>
              </tr>
            </thead>
            <tbody>
              {regras.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-2 py-2.5 font-mono font-semibold">{r.ticker}</td>
                  <td className="px-2 py-2.5">{r.condicao}</td>
                  <td className="px-2 py-2.5 text-text-2">
                    {r.canais.map((c) => ROTULO_DO_CANAL[c]).join(", ")}
                  </td>
                  <td className="px-2 py-2.5 text-text-3">
                    {r.ultimo_disparo_em ? quando(r.ultimo_disparo_em) : "nunca"}
                  </td>
                  <td className="px-2 py-1 text-right">
                    <Switch
                      checked={r.ativo}
                      onCheckedChange={(ativo) => alternar.mutate({ id: r.id, ativo })}
                      label={
                        <span className="sr-only">
                          Ativar regra {r.ticker}: {r.condicao}
                        </span>
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
