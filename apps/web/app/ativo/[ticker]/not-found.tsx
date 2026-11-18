import Link from "next/link";
import { Button, Card, EmptyState } from "@bolsiq/ui";

export default function AtivoInexistente() {
  return (
    <Card>
      <EmptyState
        title="Ativo não encontrado"
        description="Esse ticker não está no universo da B3 que acompanhamos. Confira a grafia ou use a busca (Ctrl+K)."
        action={
          <Button asChild variant="primary">
            <Link href="/ativo/PETR4">Ver PETR4</Link>
          </Button>
        }
      />
    </Card>
  );
}
