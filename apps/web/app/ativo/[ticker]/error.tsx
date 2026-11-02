"use client";

import { Card, ErrorState } from "@bolsiq/ui";

export default function Erro({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Card>
      <ErrorState
        title="Não foi possível carregar o ativo"
        description="O serviço de dados não respondeu. Tente de novo em instantes."
        {...(error.digest ? { correlationId: error.digest } : {})}
        onRetry={reset}
      />
    </Card>
  );
}
