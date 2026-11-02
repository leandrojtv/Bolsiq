import { STREAM_MARKETDATA, SUBJECT_MARKETDATA } from "@bolsiq/contracts";

/**
 * Configuração do stream como código.
 *
 * O compose aplica isto na subida (infra/nats). Deixar a configuração aqui, e
 * não num comando `nats` solto num runbook, é o que torna a infraestrutura
 * reproduzível: subir um ambiente novo não depende de alguém lembrar os
 * parâmetros.
 */
export const streamMarketData = {
  name: STREAM_MARKETDATA,
  subjects: [SUBJECT_MARKETDATA],

  /**
   * Retenção por limite: o stream guarda até o teto e descarta o mais antigo.
   *
   * Não usamos retenção por interesse (`WorkQueue`) de propósito: os eventos
   * têm vários consumidores independentes — o WebSocket do front, o analytics,
   * o recálculo de proventos — e cada um lê no seu ritmo. Em `WorkQueue` o
   * primeiro a consumir removeria a mensagem dos outros.
   */
  retention: "limits" as const,
  max_msgs: 5_000_000,
  max_bytes: 8 * 1024 * 1024 * 1024,
  max_age_ns: 30 * 24 * 60 * 60 * 1_000_000_000,

  /**
   * Janela de deduplicação por `Nats-Msg-Id`.
   *
   * Duas horas cobre com folga a reentrega do publisher do outbox, que roda a
   * cada poucos segundos. **Não substitui** a tabela `processed_events`: fora
   * da janela, uma reentrega volta a parecer mensagem nova.
   */
  duplicate_window_ns: 2 * 60 * 60 * 1_000_000_000,

  storage: "file" as const,
  num_replicas: 1,
  discard: "old" as const,
};

/** Tentativas de entrega antes da dead-letter. */
export const MAX_ENTREGAS = 5;
