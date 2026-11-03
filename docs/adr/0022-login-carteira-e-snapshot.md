# ADR 0022 - Login, papel da RLS por transação, snapshot da carteira e LGPD

- **Status:** aceito
- **Data:** 2026-11-03
- **Decisores:** @leandrojtv

## Contexto

O Prompt E liga o Better Auth (ADR 0010) e as telas de carteira ao schema
`portfolio`, que já tem RLS forçada (ADR 0011). Quatro decisões apareceram na
implementação e não estavam em nenhum ADR:

1. Como a aplicação passa a valer para a RLS sem uma segunda URL de banco.
2. Quem grava o snapshot diário, e quando.
3. O que acontece com o id provisório do aparelho (ADR 0021) no login.
4. O que a exclusão de conta apaga, incluindo a auditoria append-only.

## Decisão

### 1. `SET LOCAL ROLE bolsiq_app` em cada transação

O papel `bolsiq_app` continua `NOLOGIN NOBYPASSRLS`. A aplicação conecta com o
`DATABASE_URL` de sempre e todo acesso ao `portfolio` passa por
`comoUsuario(db, userId, fn)` (`packages/portfolio/src/db/sessao.ts`), que abre
a transação com:

```sql
SET LOCAL ROLE bolsiq_app;
SELECT set_config('bolsiq.user_id', $1, true);
```

Com o papel trocado, nem superusuário nem dono das tabelas ignoram a RLS, e
os dois `LOCAL` morrem no fim da transação. O login do `DATABASE_URL` precisa
poder assumir o papel (superusuário no compose; em produção,
`GRANT bolsiq_app TO <login>`). Isso substitui o `DATABASE_URL_APP` previsto no
ADR 0011: uma URL a menos para confundir, e a barreira vale do mesmo jeito.

O `user_id` vem só da sessão do Better Auth, lida no servidor. Carteira de
outro usuário responde 404, igual a inexistente.

### 2. `portfolio-worker`: marcação e job agendado

- Toda escrita do app na carteira grava `portfolios.recalcular_desde`
  (a menor data afetada).
- O `portfolio-worker` procura carteiras marcadas a cada 2 s, recalcula a
  série inteira como o dono (mesma RLS), regrava `snapshots` e desmarca.
- Um job do pg-boss no fechamento (`0 19 * * 1-5`, Brasília) marca todas as
  carteiras com transação: é o snapshot diário.
- A única consulta que cruza usuários é a lista de marcadas (id e dono), com a
  conexão do dono das tabelas.

Preço vem do `/v1/history?adjusted=false`: desdobramento e provento já estão
nas transações, e o preço ajustado os contaria duas vezes.

**TWR: retirada no fim do dia.** A convenção anterior (todo fluxo no início do
dia) dava -100% no dia em que a carteira vendia tudo. Agora o aporte entra no
denominador e a retirada (venda, provento) volta ao numerador:
$r_t = (V_t + S_t) / (V_{t-1} + A_t) - 1$.

### 3. Vínculo do aparelho no primeiro login

Depois do login, o navegador chama `POST /api/conta/vincular` uma vez por conta
e aparelho, com a watchlist do `localStorage`. O servidor:

- grava a watchlist em `app.watchlist` se a conta ainda não tem uma;
- passa regras, notificações, entregas e inscrições de push do id provisório
  (`dev_…`) para a conta; preferência da conta vence a do aparelho;
- apaga o cookie `bolsiq_uid`.

Sem login, alertas continuam funcionando com o id provisório. Carteira exige
login.

### 4. LGPD

- **Exportar** (`GET /api/conta/exportar`): JSON com conta, watchlist,
  carteiras, transações, importações, auditoria, regras, notificações e
  preferências.
- **Excluir** (`POST /api/conta/excluir`, com "EXCLUIR" digitado): encerra a
  sessão, apaga carteira (pela RLS), alertas, watchlist e auditoria, e por fim
  a conta, que leva sessões, senhas e 2FA pela FK com cascade.
- **A auditoria sai junto.** Ela é append-only para o papel da aplicação; a
  exclusão usa a conexão do dono das tabelas, fora do `comoUsuario`, e é a
  única escrita no `portfolio` que não passa pela RLS. Guardar IP e user agent
  de quem pediu para ser esquecido não tem base legal neste produto (não há
  obrigação fiscal sobre a carteira declarada pelo usuário).

## Consequências

- Esquecer o `comoUsuario` não vaza dado: sem papel trocado e sem usuário, a
  consulta como superusuário veria tudo, por isso o BFF só importa as tabelas
  do portfolio dentro de `lib/carteira.ts` e `lib/conta.ts`.
- O gráfico de rentabilidade aparece segundos depois de uma importação, não
  na hora: a tela consulta de novo enquanto a carteira está marcada.
- Recalcular a série inteira custa uma busca de histórico por ativo. Para
  carteira de pessoa física é rápido; para milhares de carteiras no
  fechamento, o histórico pode vir de cache próprio no futuro.
- Revogação de sessão leva até 1 min por causa do cache de sessão no cookie.

## Alternativas consideradas

- **Login próprio para `bolsiq_app` e `DATABASE_URL_APP`**: duas pools e duas
  senhas, e as tabelas do `app` e do `alerts` ficariam numa terceira conexão.
- **Snapshot só no job diário**: o gráfico de quem acabou de importar ficaria
  vazio até a noite.
- **Recalcular na requisição do app**: buscar o histórico de cada ativo deixa
  a importação de 500 linhas acima dos 5 s.
- **Anonimizar a auditoria em vez de apagar**: o `REVOKE UPDATE` impede, e
  anonimizar user id sem apagar IP não resolve.
