# ADR 0006 — Jobs no próprio serviço, com pg-boss e `ROLE`

- **Status:** aceito
- **Data:** 2026-11-01
- **Decisores:** @leandrojtv

## Contexto e definição do problema

O `market-data` precisa de trabalho assíncrono e agendado: baixar o COTAHIST ao
fim da sessão, conferir DFP e ITR semanalmente, ler o informe de fundos todo
dia, buscar as séries do BCB, recalcular `adj_close` quando entra provento, e
rodar cargas históricas que levam horas.

Esse trabalho tem três características que decidem o desenho:

1. **É o mesmo domínio da API.** O job que grava `quotes_daily` usa o mesmo
   parser, o mesmo schema e as mesmas regras de proveniência que o endpoint que
   serve `quotes_daily`.
2. **É intenso e irregular.** Um backfill de 2010 processa gigabytes; a carga
   diária processa poucos megabytes. Se rodar no mesmo processo da API, a
   latência do endpoint público sofre.
3. **Não pode duplicar.** Rodar duas vezes o mesmo job não pode gerar linha
   duplicada, e dois processos não podem pegar o mesmo job.

A pergunta: onde esse trabalho roda, e como é agendado?

## Opções consideradas

1. **Serviço separado** (`market-data-jobs`), com repositório de código próprio
   e banco próprio.
2. **Mesmo código, processos distintos**, selecionados por variável de ambiente.
3. **Jobs dentro do processo da API**, com `setInterval` ou cron no container.
4. **Agendador externo** (cron do host, GitHub Actions agendado, Kubernetes
   CronJob) chamando endpoints HTTP.

## Decisão

**Opção 2:** o mesmo código do `market-data`, com `ROLE=api|worker|all`
decidindo o que o processo executa. A fila é o **pg-boss**, no próprio Postgres
do serviço. No compose, `market-data-worker` usa a mesma imagem com
`ROLE=worker`.

### Por que não serviço separado

Dividiria o domínio ao meio. O adapter da CVM, as regras de `VERSAO` e
`ORDEM_EXERC`, o tratamento do fator de cotação do COTAHIST e o schema das
tabelas seriam usados dos dois lados. Serviço separado significaria duplicar
esse código ou criar um pacote compartilhado que, na prática, é o domínio
inteiro — com a fronteira num lugar que não corresponde a nenhuma fronteira
real.

Pior: o CLAUDE.md estabelece que cada serviço é dono dos seus dados e que não há
join entre schemas de serviços diferentes. Um serviço de jobs separado
escreveria nas tabelas do `market-data`, violando a regra, ou teria banco
próprio, exigindo sincronização entre os dois. As duas saídas são piores que não
dividir.

### Por que não jobs no processo da API

A API pública será vendida: latência é o produto. Um backfill de COTAHIST
saturando event loop e conexões do mesmo processo que atende cliente pagante
degrada exatamente o que se cobra. Separar o processo, mantendo o código, isola
o recurso sem dividir o domínio.

### Por que não agendador externo

Agendador externo chamando HTTP tem três problemas concretos:

- **Perde a fila.** Job que falha precisa de retry com backoff, e isso vira
  responsabilidade do agendador, que normalmente não a tem.
- **Perde o histórico.** `GET /admin/jobs` deve mostrar última execução,
  tentativas e erro. Com cron de host, isso está num log em algum lugar.
- **Timeout de HTTP.** Backfill de horas não cabe numa requisição.

Cron do pg-boss resolve os três: o agendamento vive no banco, junto da fila, com
retry e histórico.

### Por que pg-boss e não Redis ou SQS

O CLAUDE.md já define pg-boss, e a razão se sustenta: a fila fica no Postgres
que o serviço já tem. Não acrescenta componente de infraestrutura, e — o que
mais importa aqui — **permite enfileirar na mesma transação que grava o dado**.
É isso que torna o padrão outbox possível sem entrega dupla.

NATS JetStream continua sendo o barramento de eventos entre serviços. Fila de
trabalho interna e barramento de eventos são coisas diferentes, e usar o mesmo
componente para as duas confunde as responsabilidades.

## Consequências

### Positivas

- Um único código, um único schema, um único conjunto de regras de domínio.
- Carga pesada não degrada a API pública.
- Retry com backoff e histórico de execução de graça, vindos do pg-boss.
- `ROLE=all` dá um processo só em desenvolvimento, sem precisar subir dois.
- Escala independente: `market-data-worker` sobe de réplica no backfill e volta
  depois.
- Enfileiramento transacional, que viabiliza o outbox.

### Negativas

- A imagem carrega código que o processo não usa. `ROLE=api` tem os adapters
  dentro sem nunca executá-los — imagem maior e superfície maior.
- `ROLE` é configuração que muda comportamento. Erro de digitação em produção
  pode subir dois `api` e nenhum `worker`, e nada de errado aparece até o
  primeiro job agendado não rodar. Mitigação: validar `ROLE` com Zod na
  inicialização, falhando ruidosamente, e verificar no smoke que existe worker
  ativo.
- Fila no Postgres compete com a carga de leitura pelo mesmo banco. Aceitável no
  volume previsto; se deixar de ser, a saída é réplica de leitura, não trocar a
  fila.
- Acoplamento de implantação: corrigir um adapter obriga a republicar a API
  também.

### Neutras

- `/admin/jobs` e `/admin/jobs/{name}/run` ficam fora do `/v1` público, com
  autenticação própria. Não entram no OpenAPI público e não contam para a
  compatibilidade de contrato.

## Conformidade com o CLAUDE.md

- **Serviço dono dos seus dados:** mantido; o worker é o mesmo serviço.
- **Nenhum outro serviço acessa fonte externa:** reforçado; todos os adapters
  ficam aqui.
- **Proveniência:** `source`, `fetched_at`, `license` e `source_ref` são gravados
  pelo adapter, que é o único lugar que sabe de onde veio o dado.
- **Regra 1 (tudo via Docker):** `market-data-worker` no compose, mesma imagem.

## Pendências

1. **Autenticação de `/admin`.** Token estático em variável de ambiente resolve
   o começo, mas precisa de decisão própria quando houver mais de um operador.
2. **Trava de concorrência do backfill.** Dois backfills simultâneos do mesmo ano
   fazem trabalho duplicado sem corromper dado, graças à chave natural. Vale uma
   trava, mas é otimização.
3. **Horário de verão.** A agenda é em `America/Sao_Paulo`. O Brasil não tem
   horário de verão hoje; se voltar, `19:30` muda de UTC e o pg-boss precisa
   estar configurado para o fuso, não para o deslocamento.
4. **A agenda das 19:30 em dias úteis** precisa saber o calendário de feriados
   da B3. Sem isso, roda em feriado, recebe 404 e registra falha. Feriado não é
   erro: o job deve encerrar como "sem dado" em vez de `failed`.
