import {
  configDoStreamMarketData,
  STREAM_MARKETDATA,
  SUBJECT_MARKETDATA,
} from "@bolsiq/contracts";

export { MAX_ENTREGAS } from "@bolsiq/contracts";

/**
 * Configuração do stream como código.
 *
 * Os números vêm de `@bolsiq/contracts` (`configDoStreamMarketData`): é a
 * mesma fonte que o gerador de `docs/events.md` lê, então a documentação não
 * pode descrever um stream diferente do que o broker recebe.
 *
 * O servidor NATS em si é configurado em `infra/nats/nats.conf`; aqui fica só
 * o stream, que é contrato da aplicação e muda junto com o catálogo de eventos.
 */
export const streamMarketData = {
  name: STREAM_MARKETDATA,
  subjects: [SUBJECT_MARKETDATA],
  ...configDoStreamMarketData,
};
