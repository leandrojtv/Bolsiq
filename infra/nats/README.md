# NATS

Barramento de eventos entre serviços, com JetStream.

## O que fica onde

|                                                                  | Onde                                                                         | Por quê                                                       |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Configuração do **servidor** (store, tetos, monitoração)         | [nats.conf](nats.conf)                                                       | É do ambiente, não da aplicação                               |
| Definição do **stream** (nome, subjects, retenção, deduplicação) | [`packages/messaging/src/stream.ts`](../../packages/messaging/src/stream.ts) | É contrato da aplicação: muda junto com o catálogo de eventos |
| **Catálogo de eventos**                                          | [`packages/contracts/src/events/`](../../packages/contracts/src/events/)     | Schemas Zod, versionados no nome                              |

Descrever o stream nos dois lugares criaria duas fontes de verdade que divergem
no primeiro deploy em que alguém esquecer de atualizar uma. Por isso ele vive em
código, e o serviço o aplica na subida com `garantirStream()` — que cria se não
existir e **atualiza** se existir, para o broker não ficar com configuração de
um deploy anterior.

## Como subir

```bash
make up
```

O compose monta o `nats.conf` e persiste o JetStream em volume. O
`market-data` cria o stream `MARKETDATA` ao conectar.

## Conferir o estado

```bash
docker compose -f infra/docker/compose.dev.yml exec nats nats stream ls
```

```bash
curl -s http://localhost:8222/jsz?streams=1 | jq '.account_details[0].stream_detail'
```

```bash
curl -s http://localhost:8222/healthz
```

## Garantias

Três camadas, porque nenhuma basta sozinha — ver
[ADR 0008](../../docs/adr/0008-outbox-e-jetstream.md):

1. **Outbox** no Postgres, gravado na mesma transação do dado: at-least-once.
2. **Deduplicação do JetStream** por `Nats-Msg-Id` (o id da linha do outbox),
   dentro da janela de 2h.
3. **`processed_events`** no consumidor, para o que passa da janela.

O `/v1/stream` do WebSocket é a exceção: usa assinatura core, at-most-once, sem
estado. Quem acabou de abrir o navegador quer o preço de agora, não o histórico.
