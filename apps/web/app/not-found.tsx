import Link from "next/link";
import { Button, Card, EmptyState } from "@bolsiq/ui";

export default function NaoEncontrado() {
  return (
    <Card>
      <EmptyState
        title="Página não encontrada"
        description="Esta página ainda não existe ou o endereço está errado."
        action={
          <Button asChild variant="primary">
            <Link href="/">Ir para o início</Link>
          </Button>
        }
      />
    </Card>
  );
}
