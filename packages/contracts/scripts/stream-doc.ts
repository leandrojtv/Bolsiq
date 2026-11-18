import { configDoStreamMarketData } from "../src/events/stream-config.js";

/** Cabeçalho do docs/events.md. */
export function streamDoc(stream: string, subject: string): string {
  const s = configDoStreamMarketData;
  return `# Eventos

> **Documento gerado.** Não edite à mão: ele sai dos schemas Zod em
> \`packages/contracts/src/events/\`. Para atualizar, rode \`make docs-events\`.
> O CI confere com \`--check\` e reprova se o documento divergir do código.

Comunicação assíncrona entre serviços, por NATS JetStream com outbox no
Postgres. A decisão está no [ADR 0008](adr/0008-outbox-e-jetstream.md).

## Stream

| | |
| --- | --- |
| Nome | \`${stream}\` |
| Subjects | \`${subject}\` |
| Retenção | \`${s.retention}\` (descarta \`${s.discard}\` ao bater o teto) |
| Teto de mensagens | ${s.max_msgs.toLocaleString("pt-BR")} |
| Teto de bytes | ${(s.max_bytes / 1024 ** 3).toFixed(0)} GiB |
| Idade máxima | ${(s.max_age_ns / 1e9 / 86400).toFixed(0)} dias |
| Janela de deduplicação | ${(s.duplicate_window_ns / 1e9 / 3600).toFixed(0)} h |
| Armazenamento | \`${s.storage}\` |

## Nome dos eventos

\`<domínio>.<entidade>.<ação>.v<N>\`. A versão está **no nome**, não num campo:
quebrar o payload exige um nome novo, e os dois convivem enquanto houver
consumidor do antigo. É o mesmo princípio do \`/v1\` da API pública, aplicado ao
barramento.

## Garantias

| Camada | O que cobre |
| --- | --- |
| **Outbox** no Postgres, na mesma transação do dado | Entrega ao menos uma vez. Se o NATS está fora, o evento espera; nunca se perde nem aparece sem o dado |
| **Deduplicação do JetStream** por \`Nats-Msg-Id\` (id da linha do outbox) | Republicação dentro da janela não vira mensagem nova |
| **\`processed_events\`** no consumidor | O que passa da janela. A marca comita na mesma transação das escritas do handler |
| **Dead-letter** após N entregas | Payload inválido ou bug de handler não bloqueiam a fila atrás deles |

O \`/v1/stream\` do WebSocket é a exceção deliberada: assinatura core,
**at-most-once**, sem estado. Quem abriu o navegador quer o preço de agora, não
o histórico do stream — e a próxima cotação do mesmo ticker torna a anterior
irrelevante.

`;
}
