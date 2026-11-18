import Link from "next/link";
import { Button, Card, EmptyState } from "@bolsiq/ui";

/** Rota do menu que ainda nao tem tela. Evita 404 no prefetch dos links. */
export function EmBreve({ titulo, descricao }: { titulo: string; descricao: string }) {
  return (
    <>
      <h1 className="m-0 text-[26px] font-bold tracking-tight">{titulo}</h1>
      <Card>
        <EmptyState
          title="Em construção"
          description={descricao}
          action={
            <Button asChild>
              <Link href="/ativo/PETR4">Ver um ativo</Link>
            </Button>
          }
        />
      </Card>
    </>
  );
}
