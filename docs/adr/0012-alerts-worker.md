# ADR 0012 - Processo e imagem dedicados para o alerts

- **Status:** aceito
- **Data:** 2026-11-02
- **Decisores:** @leandrojtv

## Contexto

O alerts consome eventos continuamente, avalia regras e entrega por canais
externos. O prompt deixou a escolha aberta: mesma imagem do app com
`ROLE=alerts`, ou imagem dedicada.

"Mesma imagem do app" nao esta disponivel como opcao real: o `apps/web` nao
existe. A comparacao honesta e entre embutir no `market-data` (unica imagem de
servico que existe) e uma imagem propria.

## Decisao

**Processo `alerts-worker` com imagem dedicada**, construida de
`services/alerts-worker` sobre `packages/alerts`.

### Por que nao na imagem do market-data

O `market-data` e o produto vendido como API, e e dono do schema `market_data`.
Hospedar o alerts nele:

- poria no mesmo processo, ou na mesma imagem, codigo de dois donos de dados
  diferentes, contra a regra do CLAUDE.md;
- faria deploy de correcao de formula de alerta republicar a API publica;
- misturaria falhas: SMTP lento ou push com timeout competindo com o worker de
  ingestao de dados.

### Por que nao na imagem do app

Quando o `apps/web` existir, ele sera Next.js: servidor de requisicao, com
ciclo de vida de request. Consumidor duravel de longa duracao, com loop de
entrega e recarga periodica, nao combina com esse modelo, e escalar o app por
carga de pagina escalaria junto, sem necessidade, o consumidor -- que precisa de
exatamente uma replica ativa por particao de trabalho.

### Por que imagem e nao so processo

O `ROLE` funciona no market-data porque api e worker sao o **mesmo dominio**
(ADR 0006). Aqui sao dominios diferentes. Imagem propria mantem o
`turbo prune` minimo: a imagem do alerts nao carrega Fastify nem os adapters de
fonte, e a do market-data nao carrega nodemailer nem web-push.

## Consequencias

### Positivas

- Falha isolada: SMTP fora do ar nao afeta a ingestao nem a API.
- Deploy isolado: mudar regra ou canal nao republica a API publica.
- Escala propria: mais de uma replica divide o trabalho pelo consumidor duravel
  e pelo `FOR UPDATE SKIP LOCKED` das entregas, sem coordenacao extra.
- Migrations proprias, com journal `drizzle_alerts`, aplicadas por um passo
  `alerts-migrate` antes do worker subir.

### Negativas

- Mais uma imagem no CI, no GHCR e no deploy.
- Mais um processo para monitorar.
- O indice de regras e por processo: com N replicas, cada uma carrega todas as
  regras. Aceitavel ate centenas de milhares; alem disso, particionar por
  ticker.

## Sobre o teste de carga com k6

O criterio de aceite pedia "teste de carga simples com k6 no perfil tools". Nao
foi feito com k6, e a razao e tecnica: o `alerts-worker` nao tem entrada HTTP.
Ele le NATS, e o k6 nao fala NATS sem build customizado (`xk6-nats`). Um k6
contra um endpoint HTTP criado so para isso mediria o endpoint, nao o motor.

O que foi feito mede a coisa certa: teste de integracao com **o worker real,
Postgres e NATS reais, 10 mil regras ativas** em 2 mil tickers, publicando
cotacoes pelo NATS e medindo o tempo ate a notificacao no banco. Resultado: p95
de 56 ms, contra 61-65 ms com uma regra so. Mais um benchmark do avaliador em
processo: 10 mil regras, 5 mil cotacoes, p99 abaixo de 5 ms.

Se o k6 for requisito por padronizacao de ferramenta, o caminho e `xk6-nats` no
perfil `tools`. A decisao de nao fazer agora esta registrada aqui para ser
revista.

## Pendencias

1. Particionar o indice por ticker se o numero de regras passar de centenas de
   milhares.
2. Metricas: latencia de avaliacao e fila de entregas pendentes, para alertar
   sobre o proprio alerts.
3. k6 com `xk6-nats`, se exigido.
