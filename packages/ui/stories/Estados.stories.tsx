import type { Meta, StoryObj } from "@storybook/react-vite";
import { Inbox } from "lucide-react";
import { Button, Card, EmptyState, ErrorState, Skeleton } from "../src/index.js";

const meta: Meta = { id: "estados", title: "Estados/Vazio, erro e carregando" };
export default meta;

export const Vazio: StoryObj = {
  render: () => (
    <Card className="max-w-md">
      <EmptyState
        icon={<Inbox aria-hidden="true" size={28} />}
        title="Nenhum alerta criado"
        description="Crie um alerta de preço, de indicador ou de provento para ser avisado."
        action={<Button variant="primary">Criar alerta</Button>}
      />
    </Card>
  ),
};

export const Erro: StoryObj = {
  render: () => (
    <Card className="max-w-md">
      <ErrorState
        description="A fonte de cotações não respondeu."
        correlationId="0c1ef418-5960-4f0a"
        onRetry={() => undefined}
      />
    </Card>
  ),
};

export const Carregando: StoryObj = {
  render: () => (
    <Card className="max-w-md" aria-busy="true" aria-label="Carregando indicadores">
      <Skeleton className="h-6 w-32" />
      <div className="grid grid-cols-2 gap-2.5">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    </Card>
  ),
};
