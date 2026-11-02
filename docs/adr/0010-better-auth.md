# ADR 0010 - Better Auth para autenticacao

- **Status:** proposto
- **Data:** 2026-11-02
- **Decisores:** @leandrojtv

> **Status proposto, nao aceito.** A decisao esta registrada, mas nao
> implementada: ela vive no `apps/web`, que ainda nao existe. O que ja esta
> pronto e a camada de banco que a autenticacao vai alimentar (schema
> `portfolio`, com RLS -- ver [ADR 0011](0011-rls.md)).

## Contexto

O produto precisa de conta de usuario para carteira: e-mail e senha, login com
Google, verificacao de e-mail, 2FA opcional por TOTP, recuperacao de senha, e
papeis `user` e `admin`. A sessao tem de viver no Postgres, porque a RLS do
`portfolio` depende de saber quem e o usuario em cada transacao.

Tres restricoes pesam:

1. **A sessao e o insumo da RLS.** O `user_id` que vai para
   `SET LOCAL bolsiq.user_id` sai da sessao. Autenticacao que guarde sessao
   fora do Postgres obriga uma ida a mais de rede em cada requisicao, antes de
   qualquer consulta.
2. **Dado financeiro.** Vazamento de sessao da acesso a carteira. 2FA e
   auditoria nao sao enfeite.
3. **Uma pessoa mantendo.** Autenticacao escrita a mao e o lugar classico onde
   um projeto pequeno introduz falha de seguranca sem notar.

## Opcoes consideradas

1. **Better Auth** - biblioteca TypeScript, sessao no proprio banco via adapter.
2. **Auth.js (NextAuth)** - o mais usado no ecossistema Next.
3. **Servico gerenciado** (Clerk, Auth0, Supabase Auth).
4. **Implementacao propria** com argon2 e cookie assinado.

## Decisao

**Better Auth**, com adapter Drizzle apontando para o schema `app` no mesmo
Postgres.

### Por que nao servico gerenciado

E a opcao mais segura em termos de implementacao, e foi descartada por uma razao
concreta: **a sessao ficaria fora do banco**. Cada requisicao teria de validar
token no provedor ou confiar em JWT, e o `user_id` da RLS passaria a vir de um
token em vez de uma linha de sessao verificavel. Soma-se o custo por usuario
ativo num produto que pretende ter plano gratuito.

### Por que nao Auth.js

Auth.js e maduro e tem mais exemplos, mas o modelo dele e centrado em OAuth e
JWT; e-mail e senha com verificacao, 2FA TOTP e papeis exigem montar as pecas a
mao ou dependem de plugins de terceiros. Better Auth traz 2FA, verificacao de
e-mail e organizacao de papeis como recurso de primeira classe, com sessao em
banco por padrao.

### Por que nao implementacao propria

Hash de senha, rotacao de sessao, protecao contra fixacao, fluxo de recuperacao
que nao vira enumeracao de usuarios, TOTP com janela de tolerancia. Cada um
desses tem um jeito errado que funciona nos testes. Nao e trabalho que um
projeto de uma pessoa deva fazer.

### Schema separado

As tabelas da autenticacao ficam no schema `app`, nao em `portfolio` nem em
`public`. O `portfolio` referencia `user_id` como texto, **sem foreign key**
para `app.user`: isso mantem o pacote `portfolio` extraivel sem arrastar a
autenticacao, pelo mesmo critério do ADR 0009 (analytics como modulo). O preco e que exclusao de usuario
nao cascateia pelo banco, e precisa ser feita pelo fluxo de LGPD.

## Consequencias

### Positivas

- Sessao no Postgres: a RLS le o usuario sem ida de rede adicional.
- 2FA, verificacao de e-mail e recuperacao vem prontos e testados.
- Papeis `user` e `admin` sem tabela propria a manter.
- Mailpit no compose deixa o fluxo de e-mail testavel sem mandar mensagem de
  verdade de maquina de desenvolvimento.

### Negativas

- Dependencia nova no caminho de autenticacao, com a superficie que isso traz.
- Better Auth e mais novo que Auth.js: menos exemplo publico, e a chance de
  mudanca de API em versao menor e maior.
- Migrations da autenticacao sao geradas pela propria biblioteca, o que cria um
  terceiro conjunto de migrations no repositorio, com journal proprio.
- Sem foreign key entre `app.user` e `portfolio.portfolios`, exclusao de usuario
  depende de codigo, nao do banco.

## Pendencias

1. **Implementar.** Depende de `apps/web`.
2. **Rate limit no login** e nos fluxos de recuperacao. Decidir se no Kong, na
   aplicacao, ou nos dois -- o ADR 0007 ainda esta aberto.
3. **Auditar evento de autenticacao** em `portfolio.audit_log`: login, troca de
   senha, ativacao de 2FA, revogacao de sessao.
4. **Fluxo de LGPD**: exportacao e exclusao, incluindo o que fazer com a
   auditoria, que e append-only por escolha.
5. **Decidir o que acontece com a carteira** quando a conta e excluida: apagar,
   anonimizar ou reter por obrigacao fiscal.
