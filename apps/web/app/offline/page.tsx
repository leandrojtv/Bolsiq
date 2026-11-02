import { Card, EmptyState } from "@bolsiq/ui";

export const metadata = { title: "Sem conexão" };

export default function Offline() {
  return (
    <Card>
      <EmptyState
        title="Sem conexão"
        description="Mostrando o que ficou salvo neste aparelho. As cotações voltam a atualizar quando a conexão voltar."
      />
    </Card>
  );
}
