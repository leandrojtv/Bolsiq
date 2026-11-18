/**
 * Parâmetros do stream `MARKETDATA`.
 *
 * Moram em `contracts`, e não em `messaging`, para haver **uma** fonte: o
 * cliente NATS os aplica no broker e o gerador de `docs/events.md` os publica
 * na documentação. Se cada um tivesse a sua cópia, a documentação passaria a
 * descrever um stream que não existe mais no primeiro ajuste de retenção.
 *
 * Os valores de tempo estão em nanossegundos, como o JetStream espera. Em
 * milissegundos, a janela de deduplicação viraria microssegundos e a
 * deduplicação simplesmente não funcionaria — sem erro, sem aviso.
 */
export const configDoStreamMarketData = {
  /**
   * Retenção por limite: guarda até o teto e descarta o mais antigo.
   *
   * Não é `workqueue` de propósito: os eventos têm vários consumidores
   * independentes — o WebSocket do front, o analytics, o recálculo de
   * proventos — e cada um lê no seu ritmo. Em `workqueue` o primeiro a
   * consumir removeria a mensagem dos outros.
   */
  retention: "limits",
  discard: "old",
  max_msgs: 5_000_000,
  max_bytes: 8 * 1024 * 1024 * 1024,
  max_age_ns: 30 * 24 * 60 * 60 * 1_000_000_000,
  /**
   * Janela de deduplicação por `Nats-Msg-Id`.
   *
   * Duas horas cobre com folga o ciclo do publisher do outbox, que roda a cada
   * segundo. **Não substitui** `processed_events`: fora da janela, uma
   * reentrega volta a parecer mensagem nova.
   */
  duplicate_window_ns: 2 * 60 * 60 * 1_000_000_000,
  storage: "file",
  num_replicas: 1,
} as const;

/** Tentativas de entrega antes da dead-letter. */
export const MAX_ENTREGAS = 5;
