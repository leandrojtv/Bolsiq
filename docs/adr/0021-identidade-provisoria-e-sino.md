# ADR 0021 - Identidade provisória por dispositivo e sino por SSE

- **Status:** aceito
- **Data:** 2026-11-02
- **Decisores:** @leandrojtv

## Contexto

As telas de alertas (Prompt F) gravam regras, notificações e preferências por
`user_id`, mas o login (Prompt E, Better Auth, ADR 0010) ainda não existe. O
sino do AppShell precisa do contador em tempo real; o alerts-worker já publica
cada aviso em `alerts.inapp.<user_id>` no NATS core (ADR 0012).

## Decisão

1. **Identidade provisória por dispositivo.** O `proxy.ts` do Next grava o
   cookie `bolsiq_uid` (`dev_<uuid>`, httpOnly, SameSite=Lax, 1 ano) quando não
   existe. O BFF lê o id só do cookie (`lib/usuario.ts`), nunca de parâmetro.
   O prefixo `dev_` separa esses ids dos que o Better Auth vai gerar.
2. **Sino por Server-Sent Events.** `/api/notificacoes/stream` assina
   `alerts.inapp.<uid>` no NATS core e repassa ao navegador. O navegador não
   fala com o NATS. A conexão abre com o contador do banco, então um aviso
   perdido com a aba fechada não deixa o sino errado; o NATS core não guarda
   mensagem, e não precisa: a notificação está no banco.
3. **Alertas como módulo do app** (CLAUDE.md): o BFF lê e grava o schema
   `alerts` direto, e toda escrita atualiza `atualizado_em`, que o worker usa
   para recarregar as regras a cada 2 s.
4. **Web Push só sob demanda.** A permissão é pedida quando o usuário marca o
   canal Push, nunca ao abrir a página. Sem `VAPID_PUBLIC_KEY` o canal aparece
   como indisponível.

## Consequências

- Limpar os cookies perde as regras daquele navegador. Aceitável até o login.
- Com o login, um passo único migra `dev_<uuid>` para o id do usuário no
  primeiro acesso autenticado (update em `alert_rules`, `notifications`,
  `user_prefs` e `push_subscriptions`), e o `proxy.ts` deixa de criar o cookie.
- Cada aba aberta mantém uma conexão SSE e uma assinatura no NATS. Para o
  volume atual é irrelevante; com muitos usuários, uma assinatura por processo
  com wildcard e fan-out em memória troca a conta.

## Alternativas consideradas

- **Esperar o login**: travaria o Prompt F sem ganho; a troca do id é local.
- **Polling do contador**: simples, mas não cumpre os 5 s sem martelar o banco.
- **WebSocket do navegador direto no NATS**: expõe o broker e exige
  autorização por subject no NATS.
