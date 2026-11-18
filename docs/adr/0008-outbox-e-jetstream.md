# ADR 0008 — Outbox no Postgres com NATS JetStream

- **Status:** aceito
- **Data:** 2026-11-02
- **Decisores:** @leandrojtv

## Contexto e definição do problema

O `market-data` grava cotação, demonstração financeira e provento, e outros
módulos precisam reagir: o front atualiza a tela, o `analytics` recalcula
indicador, o próprio `market-data` recalcula `adj_close` quando entra provento,
o `alerts` dispara notificação.

Três propriedades decidem o desenho:

1. **Evento sem dado é pior que dado sem evento.** Se o `alerts` avisa que a
   PETR4 caiu 5% e a cotação não está no banco, o cliente abre a tela e não vê
   nada. Dado gravado sem evento publicado é um atraso; evento publicado sem o
   dado é uma mentira.
2. **O broker vai cair.** Uma máquina única, um container reiniciado num deploy,
   um disco cheio. A carga diária do COTAHIST não pode falhar porque o NATS
   reiniciou.
3. **Reentrega é certa, não eventual.** Um consumidor que processa e morre antes
   do ack recebe a mensagem de novo. Isso é o funcionamento normal de
   at-least-once, não um caso de exceção.

## Opções consideradas

1. **Publicar direto no NATS**, dentro do mesmo código que grava o dado.
2. **Outbox no Postgres** + publisher assíncrono.
3. **CDC** (Debezium ou `wal2json`) lendo o WAL do Postgres.
4. **Só `LISTEN/NOTIFY`** do Postgres, sem broker.

## Decisão

**Opção 2:** tabela `outbox` no schema `market_data`, gravada na mesma transação
do dado, e um publisher que a esvazia contra o JetStream.

Três camadas de garantia, porque nenhuma basta sozinha:

| Camada                                                              | O que cobre                                                            |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Outbox na mesma transação                                           | Evento nunca existe sem o dado, nem se perde quando o broker está fora |
| Deduplicação do JetStream por `Nats-Msg-Id` = id da linha do outbox | Republicação dentro da janela de 2h não vira mensagem nova             |
| `processed_events` no consumidor, gravado na transação do handler   | O que passa da janela — e passa                                        |
| Dead-letter após 5 entregas                                         | Payload inválido ou bug de handler não bloqueiam a fila atrás deles    |

### Por que não publicar direto

Porque não existe transação entre o Postgres e o NATS. Qualquer ordem falha:

- **Gravar e depois publicar:** o processo morre entre os dois e o evento se
  perde. O dado existe e ninguém reagiu.
- **Publicar e depois gravar:** a transação do banco faz rollback e o evento já
  saiu. Pior dos dois, porque produz o estado mentiroso do item 1.

O outbox resolve movendo o problema para dentro de uma única transação: o evento
é uma linha como qualquer outra. A publicação passa a ser um detalhe de
entrega, que pode falhar e ser repetida.

### Por que não CDC

CDC daria o mesmo efeito sem a tabela, lendo o WAL. Três custos pesaram:

- **Acopla o evento ao schema.** O evento publicado passaria a ser o formato das
  colunas. Renomear uma coluna viraria quebra de contrato para consumidores
  externos — exatamente o que o versionamento no nome do evento existe para
  evitar.
- **Infraestrutura.** Debezium pede Kafka Connect ou equivalente. Para um
  serviço numa máquina, é mais peça para operar que o problema que resolve.
- **Semântica.** O evento que queremos publicar não é "a linha X mudou", é
  "a cotação da PETR4 foi atualizada". A tradução de um para o outro vive em
  algum lugar de qualquer forma; no outbox ela vive no código que já conhece o
  domínio.

CDC volta à mesa se o volume de escrita tornar o outbox um gargalo. Hoje são
alguns milhares de linhas por dia.

### Por que não só `LISTEN/NOTIFY`

`NOTIFY` não tem persistência: quem não estava escutando no instante da
notificação não a recebe. Serve para **acordar** o publisher (e é a evolução
natural do loop atual), não para entregar evento a consumidor que pode estar
reiniciando.

### Por que retenção `limits` e não `workqueue`

Em `workqueue` o primeiro consumidor a processar remove a mensagem do stream. Os
eventos aqui têm vários consumidores independentes — WebSocket do front,
`analytics`, recálculo de proventos — e cada um lê no seu ritmo. Com
`workqueue`, o primeiro a consumir cegaria os outros.

### Por que a marca de idempotência comita com o handler

`processed_events` é gravada **na mesma transação** que as escritas do handler,
e é o handler que recebe o `tx`. Isso elimina o estado intermediário: não existe
"processei mas não marquei" (reprocessaria) nem "marquei mas não processei"
(perderia o efeito).

É o mais perto de exactly-once que se consegue sem transação distribuída, e vale
nomear o limite: só funciona porque efeito e marca vivem **no mesmo banco**. Um
handler cujo efeito é chamar uma API externa não ganha essa garantia, e precisa
ser idempotente por conta própria.

### Por que o WebSocket é at-most-once

O `/v1/stream` usa assinatura **core** do NATS, não consumidor durável. Uma
publicação JetStream é uma mensagem NATS comum que o stream também captura,
então o assinante core a recebe em tempo real, sem ack e sem estado.

É deliberado, e a assimetria com o resto é o ponto: quem acabou de abrir o
navegador quer o preço de agora, não trinta dias de histórico despejados na
tela. Um consumidor durável por conexão de WebSocket também guardaria estado por
aba aberta. Cotação perdida numa reconexão não importa — a próxima atualização
do mesmo ticker torna a anterior irrelevante.

## Consequências

### Positivas

- Evento e dado são atômicos. Não existe evento fantasma.
- O NATS pode cair sem perda: verificado derrubando o container, gravando cinco
  cotações e subindo de novo — todas chegaram, nenhuma duplicada.
- Payload é validado três vezes, em pontos com propósitos diferentes: ao gravar
  no outbox (falha com pilha de chamadas apontando para quem errou), ao publicar
  (pega linha escrita por versão anterior do serviço) e ao consumir (não confia
  no barramento).
- `docs/events.md` é gerado dos schemas, e o CI reprova se divergir.
- A configuração do stream é código, aplicada na subida, com uma única fonte
  compartilhada entre o cliente e o gerador de documentação.

### Negativas

- **Latência.** A cotação passa pelo outbox antes de chegar ao WebSocket. Com o
  loop de um segundo, é até um segundo de atraso. `LISTEN/NOTIFY` acordando o
  publisher reduz isso quando incomodar.
- **Mais uma tabela a podar.** O outbox é fila, não histórico; sem poda cresce
  para sempre. Há `podarOutbox`, mas ainda não está agendada.
- **Publisher é ponto único de progresso.** Se ele para, nada é publicado e o
  dado continua sendo gravado — recuperável, mas invisível até alguém olhar.
  Precisa de alerta sobre a idade da linha pendente mais antiga.
- **`processed_events` cresce com o volume de eventos.** Precisa de retenção; o
  horizonte razoável é o da janela de reentrega, não para sempre.

## O que a implementação ensinou

Dois achados que não vieram de inspeção, e sim de rodar contra NATS e Postgres
reais. Ficam registrados porque os dois são armadilhas de formato, a mesma
classe do `parseBcbDate`.

**1. O Postgres não devolve ISO.** `timestamptz` volta como
`2026-10-31 21:05:00+00` — espaço em vez de `T`, offset sem minutos. O envelope
exige ISO 8601 com offset, então o `occurred_at` publicado era rejeitado por
todo consumidor: os cinco eventos do primeiro teste foram **todos** para a
dead-letter com "Invalid datetime". O dado entrava ISO e voltava em outro
formato. Corrigido em `paraIsoUtc`, com teste que verifica o resultado contra o
próprio schema do envelope.

**2. Consumidor durável novo reprocessa o stream inteiro.** É o comportamento
correto do JetStream com `deliver_policy: all`, e é o que se quer em produção.
Mas torna qualquer teste que crie consumidores em sequência dependente da
ordem. Daí a opção `desde: "novas"`, que existe tanto para teste quanto para
consumidor efêmero legítimo.

## Pendências

1. **Agendar `podarOutbox`** e definir retenção de `processed_events`.
2. **Alerta de idade da linha pendente mais antiga** no outbox — é o sinal de
   que o publisher parou.
3. **`LISTEN/NOTIFY`** para acordar o publisher, se a latência de um segundo
   incomodar.
4. **Autenticação no NATS**, quando o barramento sair da máquina única.
5. **Limite de tickers por conexão no `/v1/stream` por plano**, hoje um teto
   único de 200 — depende da autenticação do ADR 0007.
