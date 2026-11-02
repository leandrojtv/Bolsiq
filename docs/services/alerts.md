# alerts

Alertas e notificacoes. Pacote `packages/alerts`, schema `alerts`, processo
proprio `alerts-worker` ([ADR 0012](../adr/0012-alerts-worker.md)).

Nao le `market_data`, `analytics` nem `portfolio`. Tudo chega por evento
([events.md](../events.md)).

## Estado atual

| Parte                                                       | Estado                                                              |
| ----------------------------------------------------------- | ------------------------------------------------------------------- |
| Motor: indice, avaliacao, histerese, cooldown, silencio     | pronto                                                              |
| Worker com consumidores duraveis e outbox de entrega        | pronto, verificado com Postgres e NATS reais                        |
| Canais in-app, e-mail, Web Push, Telegram (flag)            | prontos; e-mail verificado no Mailpit                               |
| Imagem dedicada e compose                                   | pronto, healthy de ponta a ponta                                    |
| Resumo diario ou semanal da carteira                        | **nao implementado**: depende de o portfolio publicar evento ou API |
| Templates React Email                                       | **trocados por funcao de template**; React entra com o `apps/web`   |
| Telas: gerenciamento, criacao rapida, central, preferencias | **nao implementadas**, dependem de `apps/web`                       |

## Tipos de alerta

| Tipo                      | Evento                              | Dispara quando                          |
| ------------------------- | ----------------------------------- | --------------------------------------- |
| `preco_acima`             | `marketdata.quote.updated.v1`       | preco cruza acima do valor (histerese)  |
| `preco_abaixo`            | `marketdata.quote.updated.v1`       | preco cruza abaixo do valor (histerese) |
| `variacao_diaria`         | `marketdata.quote.updated.v1`       | variacao absoluta do dia >= X%          |
| `abaixo_graham`           | `analytics.indicators.updated.v1`   | ultimo preco < preco justo de Graham    |
| `abaixo_bazin`            | `analytics.indicators.updated.v1`   | ultimo preco < teto de Bazin            |
| `dy_acima`                | `analytics.indicators.updated.v1`   | DY 12m > X%                             |
| `provento_anunciado`      | `marketdata.dividend.announced.v1`  | qualquer anuncio do ticker              |
| `data_com_proxima`        | `marketdata.dividend.announced.v1`  | data com a ate N dias                   |
| `demonstrativo_publicado` | `marketdata.statement.published.v1` | DFP ou ITR nova ou reapresentada        |

Graham e Bazin comparam com o **ultimo preco que o worker viu**. Sem preco
conhecido, nao dispara: comparar preco justo com preco desconhecido nao tem
resposta. Na pratica o preco chega primeiro, porque cotacao e diaria e
indicador e trimestral.

## Avaliacao

**Indice por (evento, ticker).** Chegou cotacao de PETR4: o custo e o numero de
regras de PETR4 para aquele evento, nao o total de regras. Medido:

|                                     | p95 cotacao -> notificacao |
| ----------------------------------- | -------------------------- |
| 1 regra ativa                       | 61-65 ms                   |
| 10 mil regras ativas, 2 mil tickers | 56 ms                      |

A latencia nao muda com o tamanho da base, que e o que o indice existe para
garantir. A meta do criterio de aceite era 5 s.

**Histerese.** `preco_acima` e `preco_abaixo` disparam e **desarmam**, e so
rearmam quando a condicao deixa de valer. Sem isso, uma cotacao oscilando em
volta do limite dispararia a cada tick, limitada so pelo cooldown.

**Cooldown.** Por regra, em segundos. Bloqueia repeticao mesmo com a regra
armada.

**Janela de silencio.** Por usuario, no fuso dele, pode cruzar a meia-noite
(22:00 a 07:00). O in-app entrega na hora -- a central nao acorda ninguem. E-mail,
push e Telegram ficam agendados para o fim da janela.

**Regra nova entra sem reiniciar.** O worker recarrega, a cada 2 s, as regras
alteradas desde a ultima carga.

## Garantias de entrega

| Ponto                 | Garantia                 | Como                                                                                                                                       |
| --------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Evento -> notificacao | sem perda, sem duplicata | consumidor duravel; notificacao, entregas, estado da regra e `processed_events` na **mesma transacao**; indice unico `(rule_id, event_id)` |
| Notificacao -> canal  | sem perda                | `deliveries` e outbox: criada junto com a notificacao, enviada depois, com retry e backoff                                                 |
| Canal externo         | **at-least-once**        | se o processo cair entre enviar e marcar, o e-mail sai de novo. Exactly-once com SMTP nao existe                                           |

Verificado em teste de integracao:

- evento publicado com o worker **parado** e processado ao reiniciar, uma vez;
- a mesma cotacao entregue duas vezes (dois `Nats-Msg-Id`) gera uma notificacao;
- cotacoes seguidas acima do limite disparam uma vez; cair e subir de novo
  dispara a segunda.

Avaliar e entregar sao dois passos de proposito. Avaliar e rapido e roda dentro
da transacao do consumidor; entregar fala com SMTP e push e e lento e falivel.
Juntar os dois faria um e-mail lento segurar o ack da cotacao e atrasar todos os
alertas de preco atras dele.

O consumidor comeca em `desde: "novas"`: na primeira subida, alerta disparado
por cotacao de ontem seria ruido.

## Como adicionar um canal

1. Implemente `CanalDeEnvio` em `packages/alerts/src/canais/`:

   ```ts
   export function canalX(cfg: Config): CanalDeEnvio {
     return {
       nome: "x",
       externo: true, // respeita a janela de silencio
       enviar: async (n, destino) => {
         // ok, ou { ok: false, erro, definitivo }
       },
     };
   }
   ```

2. Acrescente `"x"` ao enum `Canal` em `regras.ts`.
3. Registre no `services/alerts-worker/src/main.ts`, atras de configuracao ou
   flag se depender de credencial.
4. Se precisar de destino novo (id de chat, token), acrescente em `Destino` e em
   `user_prefs`.

`definitivo: true` para erro que nao melhora repetindo (destino invalido,
inscricao expirada): a entrega para de tentar. `false` para erro transitorio: ela
volta com backoff ate 5 tentativas.

O motor nao muda. E esse o ponto do contrato.

## Canais

| Canal      | Detalhe                                                                                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inapp`    | a notificacao no banco e a central; o canal empurra o aviso para o sino em `alerts.inapp.<user_id>` no NATS core. Perder o empurrao nao perde a notificacao |
| `email`    | SMTP; Mailpit em dev (http://localhost:8025). Titulo e corpo passam por escape de HTML, porque carregam dado de evento                                      |
| `push`     | Web Push com VAPID. Inscricao que responde 404 ou 410 e apagada                                                                                             |
| `telegram` | so com `FEATURE_TELEGRAM=true` e `TELEGRAM_BOT_TOKEN`. 4xx e definitivo, 5xx repete                                                                         |

## Pendencias

1. **Resumo da carteira**: depende de o portfolio expor evento ou API; o alerts
   nao le o schema `portfolio`.
2. **Watchlist**: `provento_anunciado` hoje e por ticker escolhido; "ativo da
   carteira ou watchlist" depende de um evento do portfolio com as posicoes.
3. **React Email**, quando o React entrar com o `apps/web`. A troca e local a
   `templates.ts`.
4. **Data com reavaliada diariamente**: hoje `data_com_proxima` avalia no
   anuncio; um anuncio com data com a 30 dias e regra de 5 dias nao avisa depois.
   Precisa de um job diario.
5. **Telas e endpoints de CRUD**, no `apps/web`.
6. **k6**: o criterio pedia k6, e o teste de carga foi feito de outro jeito -- ver
   o ADR 0012.
