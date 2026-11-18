import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Sem `globals` no Vitest, a Testing Library nao registra a limpeza sozinha.
afterEach(() => {
  cleanup();
});
