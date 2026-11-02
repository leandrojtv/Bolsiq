# ADR 0007 — Gateway, chaves de API e planos

- **Status:** proposto
- **Data:** 2026-11-01
- **Decisores:** @leandrojtv

> **Status é `proposto`, não `aceito`.** A decisão depende de uma escolha que
> ainda não foi feita: onde a autenticação acontece. As duas opções têm
> consequências diferentes para um critério de aceite do próprio pedido. Ver
> [a decisão](#decisão).

## Contexto e definição do problema

O `market-data` será vendido como API pública, em planos (`free`, `startup`,
`pro`) com limite de requisições, limite de tickers por chamada e endpoints
liberados por plano. Isso exige quatro coisas: autenticar a chave, aplicar o
limite, restringir endpoint por plano e medir o consumo para cobrar.

O CLAUDE.md define Kong OSS como gateway, responsável por "chaves de API, rate
limit por plano, medição de uso". O pedido detalha Kong em modo **DB-less**, com
`kong.yml` versionado, e um `make kong-sync` que gera esse arquivo a partir das
chaves do banco.

É aí que aparece o problema.

## O conflito entre DB-less e revogação

Em modo DB-less, a configuração do Kong vive num arquivo declarativo. Consumers
e credenciais `key-auth` fazem parte dessa configuração. Não há Admin API de
escrita: mudança em chave significa **regerar o arquivo e recarregar**.

Consequência direta nos critérios de aceite deste pedido:

| Critério                                 | Com Kong DB-less + `kong-sync`       |
| ---------------------------------------- | ------------------------------------ |
| Requisição sem chave → 401               | Funciona                             |
| Acima do limite → 429 com `Retry-After`  | Funciona                             |
| Chave `free` em `/v1/fundamentals` → 403 | Funciona, via ACL                    |
| **Chave revogada → 401**                 | **Só depois do próximo `kong-sync`** |

Revogar uma chave é a operação em que atraso é inaceitável: revoga-se chave
porque vazou. Uma janela entre o `POST /admin/keys/{id}/revoke` e o próximo
`kong-sync` é uma janela em que a chave vazada continua valendo. Se o sync é
manual, a janela é indefinida; se é agendado, é o intervalo da agenda.

O mesmo vale, com menos gravidade, para criação: a chave nasce no banco e não
funciona até o sync. Para um produto com autosserviço, "sua chave vale em até N
minutos" é atrito no onboarding.

Há um segundo problema, de arquitetura. O pedido coloca `api_clients`,
`api_keys`, `api_plans` e `api_usage` no schema `market_data` — o serviço é
dono desses dados. Mas o `kong.yml` passaria a conter uma **cópia** das chaves.
Dois lugares com a mesma verdade, mantidos em sincronia por script, é exatamente
o que a regra de propriedade de dados do CLAUDE.md existe para evitar.

E a medição dá a volta: o `http-log` manda a requisição para um endpoint interno
do `market-data` para gravar em `api_usage` — ou seja, o serviço recebe uma
segunda requisição para registrar a primeira, que ele mesmo atendeu e sobre a
qual já sabia tudo.

## Opções consideradas

### A. Kong DB-less, autenticação no Kong, sync por script

O pedido como está escrito.

- Chaves no `kong.yml`, geradas de `api_keys` por `make kong-sync`.
- `key-auth` autentica; `acl` restringe endpoint por grupo de plano;
  `rate-limiting` limita por consumer; `http-log` alimenta `api_usage`.
- `kong reload` é graceful, não derruba conexão em curso — "sem downtime" se
  sustenta.
- **Custo:** revogação com atraso; chave duplicada em dois lugares; medição por
  requisição extra.

### B. Kong com banco, autenticação no Kong, Admin API

- Kong com Postgres próprio; consumers e chaves criados por Admin API, efeito
  imediato.
- Resolve a revogação e o onboarding.
- **Custo:** mais um banco para operar, backup e monitorar; contradiz
  explicitamente "DB-less, `kong.yml` versionado"; a configuração deixa de ser
  versionada em git e passa a ser estado mutável no banco do Kong; a chave
  continua duplicada.

### C. Kong DB-less fino, autenticação no `market-data`

- Kong fica com o que não depende de estado por cliente: roteamento, TLS,
  correlation ID, limite global de proteção, CORS.
- Autenticação, ACL por plano, limite por plano e medição ficam num plugin do
  Fastify no `market-data`, lendo `api_keys` e `api_plans` do Postgres que o
  serviço **já possui**.
- **Ganhos:** revogação imediata, porque não há cópia a sincronizar; chave com
  um único dono; `api_usage` gravado na própria requisição, sem `http-log` nem
  endpoint interno; `kong.yml` volta a ser estático e de verdade versionável,
  porque não contém mais chave de cliente.
- **Custos:** limite de taxa em processo de aplicação, não na borda — tráfego
  abusivo chega ao serviço antes de ser recusado (mitigável com limite global no
  Kong); a lógica de plano é código a manter e testar, em vez de configuração de
  plugin; perde-se o `rate-limiting` distribuído do Kong, e o limite por minuto
  precisa de contador compartilhado entre réplicas (o próprio Postgres serve no
  volume previsto).

## Decisão

**Recomendo a opção C**, com Kong DB-less reduzido a proxy e o controle de
acesso dentro do `market-data`.

A razão decisiva é a propriedade do dado. A chave de API é dado do
`market-data`: ele a emite, revoga, associa a plano e cobra por ela. Colocar uma
cópia no gateway cria duas fontes de verdade cujo desencontro aparece justamente
no caso que não pode falhar — a revogação. A opção C elimina a cópia em vez de
sincronizá-la.

A opção B resolveria a revogação, mas trocando configuração versionada por
estado mutável num banco adicional. Para um gateway cuja única
responsabilidade por cliente é "esta chave existe?", é muita infraestrutura
para pouca função.

O que se perde na C — limite aplicado na borda — importa em escala de ataque, e
nessa escala o remédio não é o `rate-limiting` por consumer de qualquer forma: é
limite global, WAF ou CDN na frente. O limite por plano é regra de negócio, e
regra de negócio no serviço é mais fácil de testar do que em plugin.

**Esta decisão não é minha para tomar.** O CLAUDE.md define Kong como
responsável por "chaves de API, rate limit por plano, medição de uso", e a
opção C muda isso. Por isso o status é `proposto`: se você mantiver o desenho
original (opção A), o caminho honesto é aceitar o atraso na revogação e
documentá-lo no guia do cliente, ou rodar o `kong-sync` a cada revogação de
forma síncrona, dentro do próprio endpoint de revogação — o que torna o endpoint
dependente de um reload do Kong e muda o tratamento de erro dele.

## Independente da opção escolhida

Estas partes do pedido não mudam entre A, B e C.

### Chaves

Guardar só o hash. Prefixo visível `mdk_live_` para o cliente reconhecer a chave
sem revelá-la, e para varredores de segredo detectarem vazamento em repositório
público.

| Coluna         | Observação                                                       |
| -------------- | ---------------------------------------------------------------- |
| `key_hash`     | hash da chave inteira; nunca a chave                             |
| `key_prefix`   | `mdk_live_a1b2c3`, exibível e indexado para lookup               |
| `status`       | `active`, `revoked`                                              |
| `last_used_at` | atualizado de forma assíncrona; escrever a cada requisição custa |

Hash: algoritmo de hash de senha (argon2id ou bcrypt) é desenhado para ser
lento, e isso é bom para senha e ruim para uma chave verificada a cada
requisição. Para chave de API, de alta entropia e gerada por nós, SHA-256 com
comparação em tempo constante é suficiente e rápido. Decidir explicitamente, não
por hábito.

### Semântica de erro

| Situação                   | Código | Corpo                                       |
| -------------------------- | ------ | ------------------------------------------- |
| Sem chave                  | 401    | `missing_api_key`                           |
| Chave inválida ou revogada | 401    | `invalid_api_key`                           |
| Endpoint fora do plano     | 403    | `plan_upgrade_required`, com o plano mínimo |
| Acima do limite            | 429    | `rate_limit_exceeded`, com `Retry-After`    |
| Tickers acima do plano     | 400    | `too_many_tickers`, com o máximo            |

Chave revogada devolve **401, não 403**, como o pedido determina. É a escolha
certa: 403 informaria que a chave existe e não tem permissão, o que diz a um
atacante que ele acertou uma chave válida.

### Medição

`api_usage` como hypertable, com continuous aggregate de uso por chave por dia.
`GET /v1/me/usage` lê o agregado, não a tabela bruta.

O critério "uso aparece em até 1 minuto" pede atenção: continuous aggregate do
TimescaleDB atualiza por política, e o agregado do dia corrente fica defasado
até a próxima execução. Atender 1 minuto exige consultar o agregado **mais** a
tabela bruta para o período ainda não materializado — padrão conhecido, mas que
precisa estar no código desde o início, senão o número aparece errado e baixo.

### O app web como cliente

O `apps/web` acessa o `market-data` pelo gateway, com chave de plano interno
ilimitado. Está certo e tem um efeito que vale nomear: o caminho que o cliente
pagante percorre é o mesmo que o nosso front percorre, então quebra de
autenticação ou de limite aparece no nosso próprio produto antes de aparecer
numa fatura.

## Pendências

1. **A escolha entre A, B e C.** Bloqueia o resto.
2. **Contador do limite por minuto entre réplicas**, se a opção for C.
3. **Rotação de chave:** o pedido pede rotacionar. Definir se a chave antiga
   morre na hora ou tem janela de carência — carência é o que permite rotação
   sem downtime no cliente, e precisa de duas chaves ativas por cliente.
4. **Plano do app web:** chave interna ilimitada precisa ser distinguível nas
   métricas, senão o nosso próprio tráfego poluirá a medição de uso dos planos.

## Fontes

- [Kong Gateway OSS — modo DB-less e plugins incluídos](https://aws.amazon.com/marketplace/pp/prodview-ryeoj376l4lq6)
- [Comparativo de edições: key-auth, ACL e mTLS no OSS; OIDC e rate limiting avançado no Enterprise](https://api7.ai/apisix-vs-kong)
- [Rate limiting por consumer com `limit_by: consumer`](https://oneuptime.com/blog/post/2026-02-09-kong-plugin-crd-rate-limiting/view)
- [Kong DB-less: configuração aplicada no reload](https://oneuptime.com/blog/post/2026-02-09-kong-gateway-database-dbless/view)

As fontes acima são blogs e comparativos, alguns de concorrentes da Kong. O que
elas indicam é consistente — `key-auth`, `acl` e `rate-limiting` básico estão no
OSS; `rate-limiting-advanced` e OIDC são Enterprise; DB-less aplica no reload —
mas **confirmar em docs.konghq.com antes de implementar**, porque a divisão de
plugins entre edições muda com o tempo.
