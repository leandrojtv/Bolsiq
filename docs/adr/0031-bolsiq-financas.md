# ADR 0031 - Bolsiq Finanças: módulo de finanças pessoais

- **Status:** aceito
- **Data:** 2026-11-19
- **Decisores:** @leandrojtv

## Contexto

O Bolsiq cobre investimentos: ativos, comparação, screener, carteiras e alertas. Falta o
lado do dinheiro do dia a dia: contas, categorias, receitas, despesas, cartões e o que
sobra no fim do mês. A pessoa que acompanha a carteira aqui quer ver o orçamento no mesmo
lugar, com o mesmo login, e no futuro uma visão consolidada dos dois.

Finanças pessoais tem dado tão sensível quanto a carteira (salário, gastos, onde a
pessoa mora) e um ciclo de vida diferente: muito lançamento pequeno, importação de
extrato, categorização. Misturar com o `portfolio` acoplaria dois domínios que vão
crescer em direções diferentes.

## Decisão

**Módulo próprio, "Bolsiq Finanças", dentro do mesmo app**, no formato do `portfolio`
(ADR 0009 para a fronteira, ADR 0011 e 0022 para a RLS).

1. **Pacote `@bolsiq/finance`** em `packages/finance`: schema Drizzle, migrations
   versionadas, funções de domínio puras e as operações de banco que recebem a transação
   já aberta. O export `@bolsiq/finance/puro` tem só domínio e schemas Zod, sem banco,
   para o navegador.
2. **Schema Postgres `finance`**, dono dos próprios dados. Nenhum join com `portfolio`,
   `app`, `analytics` ou `market_data`. `user_id` é o id do Better Auth, guardado como
   texto, sem chave estrangeira para `app.user` (mesmo motivo: o módulo tem que poder
   sair do cluster).
3. **RLS no padrão do ADR 0011**: `finance.usuario_atual()`, `ENABLE` e `FORCE` em toda
   tabela, papel `bolsiq_app` sem `BYPASSRLS`, acesso só por `comoUsuario` (`SET LOCAL
ROLE` e `set_config(..., true)`). `audit_log` append-only por `REVOKE`. `outbox`
   aceita só `INSERT` da aplicação: o publicador lê como dono.
4. **`user_id` redundante em toda tabela**, como no `portfolio`: a política compara uma
   coluna indexada da própria linha, sem subconsulta.
5. **Rotas de UI em `/financas/*` e BFF em `/api/financas/*`.** Todo endpoint tem
   schema Zod e entra no OpenAPI gerado por `@bolsiq/finance` (`/api/financas/openapi.json`).
   Um teste do web reprova rota em `app/api/financas` que não esteja no documento.
6. **Painel geral (`/painel`) compõe chamando os módulos pelo BFF**, nunca por SQL entre
   schemas. Nesta etapa a rota existe com estado vazio.
7. **Eventos via outbox no schema `finance`**, publicados no NATS como `finance.*`
   (ADR 0008). A tabela nasce agora; o publicador entra com o primeiro evento
   (`finance.importacao_confirmada`).
8. **Jobs no pg-boss rodando no `portfolio-worker`** por enquanto, com o mesmo argumento
   do ADR 0027: ele já tem fila, conexão e o passo de migrations dos schemas do app. As
   migrations do `finance` passam a ser aplicadas por ele (journal `drizzle_finance`).

### Modelo de dados desta etapa

- `accounts`: contas (corrente, poupança, carteira, benefício, caixa de corretora) com
  saldo inicial numa data. O saldo inicial vale no **início** do dia `data_saldo_inicial`:
  lançamentos dessa data em diante movem o saldo.
- `categories`: árvore de um nível (`parent_id`), natureza receita ou despesa, custo fixo
  ou variável, essencial ou não. As de `sistema = true` (Tarifas bancárias, Juros e
  encargos, IOF) não podem ser apagadas nem ter a natureza trocada: os insights futuros
  dependem delas.
- `transactions`: valor sempre positivo em `numeric(18,2)`; o sinal sai do `tipo`.
  Transferência é um **par** de lançamentos, um em cada conta, ligados por
  `transferencia_par_id`, com `transferencia_sentido` (`saida` ou `entrada`) para saber
  de que lado o dinheiro saiu. Transferência nunca conta como receita nem despesa.
  `competencia` é o primeiro dia do mês (check no banco). `hash_dedupe` único por usuário
  quando não nulo, para a importação.
- `audit_log` e `outbox`.

**Chaves estrangeiras compostas com o dono.** A checagem de FK do Postgres ignora a RLS:
com uma FK simples, o usuário A conseguiria gravar um lançamento apontando para a conta ou
a categoria do B, se o filtro da aplicação falhasse. Por isso `accounts` e `categories`
têm `UNIQUE (user_id, id)` e as FKs de `transactions` e de `categories.parent_id` são
`(user_id, ...)`. Sem `ON DELETE`: apagar categoria zera antes os lançamentos e as
subcategorias que a usam, e conta com lançamento não se apaga (arquiva-se).

`transferencia_par_id` não tem chave estrangeira: os dois lados são gravados na mesma
transação, um apontando para o outro, e uma FK imediata recusaria o primeiro `INSERT`. A
integridade fica na operação única que cria, edita e apaga os dois lados juntos.

### Categorias padrão

Semeadas por usuário no primeiro acesso ao módulo, com `ON CONFLICT DO NOTHING` sobre
`(user_id, parent_id, nome)` com `NULLS NOT DISTINCT`. Rodar duas vezes não duplica.

### Módulo ativo e tela de entrada

O app ganha três áreas: Investimentos, Finanças e Painel. O `AppShell` recebe a lista de
módulos e mostra o seletor (no topo do menu lateral; no celular, no topo da tela) e a
navegação de cada um. O último módulo usado fica no cookie `bolsiq_modulo`, preferência
do aparelho como o tema; o login sem `volta` abre a tela de entrada desse módulo. Quando
houver tabela de preferências por usuário, ele migra para lá.

## Critério para separar o `finance-worker`

Sai do `portfolio-worker` para processo próprio quando qualquer um destes acontecer:

- os jobs de finanças (recorrências, importação de extrato) passarem de 20% do tempo de
  CPU do worker, ou atrasarem os jobs do portfolio;
- a importação de extrato precisar de dependência de sistema que a imagem do portfolio
  não tem;
- o módulo precisar de escala ou janela de deploy independente.

A fronteira já é a fila (`finance.*` no pg-boss) e o schema: separar é mudar onde o
handler é registrado, não o código do módulo.

## Consequências

### Positivas

- Usuário A não lê, edita nem apaga dado do B, verificado contra Postgres real
  (`packages/finance/src/integration/rls.test.ts`).
- O módulo pode virar serviço levando o schema inteiro, sem desfazer join.
- Transferência em par mantém o saldo de cada conta correto sem inflar receita e despesa.

### Negativas

- Mais um schema, mais um journal de migration e mais um conjunto de políticas para
  manter.
- O Painel geral vai custar chamadas ao BFF de cada módulo em vez de uma consulta.
- A preferência de módulo é por aparelho, não por conta, até existir a tabela.

## Alternativas consideradas

- **Tabelas novas no schema `portfolio`.** Menos cerimônia hoje, e acopla dois domínios
  que vão crescer separados; desfazer depois exigiria migração de dado.
- **Serviço próprio desde já.** Um único cliente (o web), sem carga que justifique
  processo e imagem novos, mesmo argumento do ADR 0009.
- **Transferência como um lançamento só, com conta de origem e destino.** Simplifica a
  gravação e complica toda leitura por conta (saldo, extrato, conciliação), que teria de
  olhar duas colunas.
