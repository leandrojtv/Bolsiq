# web

`apps/web`: Next.js (App Router), UI e BFF. Usa os componentes e tokens de
[packages/ui](ui.md) e o design de [docs/design/](../design/README.md).
Decisões no [ADR 0020](../adr/0020-bff-do-web.md).

## Estado atual

| Parte                                           | Estado                                                     |
| ----------------------------------------------- | ---------------------------------------------------------- |
| AppShell, busca global (Ctrl+K)                 | pronto                                                     |
| `/ativo/[ticker]`                               | pronto: cabeçalho, gráfico, indicadores, preço justo, abas |
| Watchlist                                       | no `localStorage`; vai para o banco no Prompt E            |
| PWA                                             | manifest, ícones gerados dos tokens, service worker        |
| `/comparar`, `/screener`                        | pronto                                                     |
| `/alertas`, `/configuracoes/notificacoes`, sino | pronto; usuário provisório por cookie (ADR 0021)           |
| `/carteiras`                                    | página provisória "Em construção"                          |
| Login                                           | **não implementado** (Prompt E)                            |

O assistente "Pergunte ao Bolsiq" está em [assistant.md](assistant.md).

## Rodando

```bash
make dev-up
```

App em http://localhost:3000. Para ter dados, rode uma vez:

```bash
make backfill FROM=2024
```

`make dev-up` é descartável: o banco morre com o container. Para uso contínuo, com o banco em
volume e os serviços voltando quando o Docker reinicia, use o ambiente duradouro, em
http://localhost:3200:

```bash
make local-up
```

`make local-start` sobe sem reconstruir as imagens, `make local-down` para e mantém os dados, e
`make local-backfill FROM=2024` faz a carga histórica. Os jobs do `market-data-worker` mantêm os
dados em dia enquanto ele estiver no ar. `BRAPI_TOKEN` vem do `.env` da raiz; sem ele, só PETR4,
VALE3, ITUB4 e MGLU3 têm cotação corrente, e os demais usam o último fechamento do COTAHIST, com o
selo de atraso.

Não carregue `infra/docker/seed-e2e.sql` nesse ambiente: os preços dele são sintéticos.

## Rotas

| Rota                                              | O que é                                                   |
| ------------------------------------------------- | --------------------------------------------------------- |
| `/ativo/[ticker]`                                 | página do ativo; 404 próprio para ticker fora do universo |
| `/api/v1/...`                                     | BFF do `/v1`, só leitura, com a chave interna             |
| `/api/indicadores/[ticker]`                       | últimos indicadores do analytics                          |
| `/api/stream?t=PETR4`                             | cotação ao vivo por SSE, ponte para o `/v1/stream`        |
| `/api/health`                                     | health da imagem e do compose                             |
| `/api/alertas/regras`, `/api/alertas/regras/[id]` | listar, criar, ligar e desligar, remover regra            |
| `/api/notificacoes`, `/api/notificacoes/lidas`    | central e marcar como lida                                |
| `/api/notificacoes/stream`                        | sino por SSE, ponte para `alerts.inapp.<user_id>`         |
| `/api/preferencias`                               | canais, e-mail e silêncio do usuário                      |
| `/api/push`                                       | chave VAPID pública e inscrição de Web Push               |
| `/manifest.webmanifest`, `/icones/*`, `/sw.js`    | PWA                                                       |
| `/api/assistente/*`                               | assistente: chat, configuração, perfil e conversas        |

## Página do ativo

- **Primeira pintura no servidor**, com o cache do `fetch` do Next: cotação
  15 s, histórico 5 min, cadastro, proventos e fundamentos 1 h. Com cache
  quente a página sai em cerca de 150 ms.
- **Gráfico** com TradingView Lightweight Charts, carregado só no cliente e
  fora do bundle inicial: velas e volume, períodos 1M a Máx, intervalo diário,
  semanal e mensal, MM 20, MM 50 e IFR 14 (Wilder), ajuste por proventos e
  OHLCV no crosshair. No celular, linha com área, como no AtivoMobile.
- **Cores do gráfico** lidas dos tokens em tempo de execução: o canvas não
  entende `var(--up)`.
- **Ao vivo**: cotação revalidada a cada minuto e SSE com a aba visível; a
  vela do dia acompanha.
- **Preço justo**: barra com preço sobre valor justo, veredito do método
  ("Indica compra", "Desconto pequeno", "Acima do justo"), helper e o aviso "Não é
  recomendação".
- **Sinais dos indicadores** ([ADR 0027](../adr/0027-sinais-dos-indicadores.md)): ponto
  verde, amarelo ou vermelho em cada indicador e botão "?" com o helper (o que mede e
  as três faixas). Card "Sinais técnicos" com MM 20/50/200 e IFR 14 do último pregão,
  calculado no servidor sobre 14 meses de histórico.

## PWA

- Manifest e ícones (192, 512 e maskable) gerados no build a partir de
  `tokens.css`.
- Service worker (`public/sw.js`): páginas e `/_next/static` em cache; sem
  rede, abre a última versão da página ou `/offline`. `/api/v1/quotes` vai à
  rede primeiro e guarda a resposta, então a última cotação aparece offline.
- Registrado só em produção.

## Variáveis

| Variável                                   | Para quê                                 |
| ------------------------------------------ | ---------------------------------------- |
| `MARKET_DATA_URL`                          | base do `/v1`; com o Kong, o gateway     |
| `MARKET_DATA_API_KEY`                      | chave interna do BFF; nunca no navegador |
| `DATABASE_URL`                             | schemas `analytics` e `alerts`           |
| `NATS_URL`                                 | sino: assinatura de `alerts.inapp.*`     |
| `VAPID_PUBLIC_KEY`                         | Web Push; vazio deixa Push indisponível  |
| `FEATURE_TELEGRAM`                         | mostra o canal Telegram (`true`)         |
| `APP_URL`                                  | base dos links de e-mail e do Google     |
| `BETTER_AUTH_SECRET`                       | assina sessão; obrigatório em produção   |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | botão do Google; sem eles some           |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`      | e-mails de conta (Mailpit em dev)        |
| `AUTH_RATE_LIMIT`                          | tentativas de login por IP por minuto    |
| `ASSISTANT_*`                              | [assistant.md](assistant.md#variáveis)   |

## Testes

| Comando                                                        | O que confere                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------------- |
| `pnpm --filter @bolsiq/web test:unit`                          | IFR e médias, lista do BFF, chave no header, watchlist        |
| `pnpm --filter @bolsiq/web exec playwright test --project=e2e` | página do ativo, 404, busca, watchlist, celular, BFF, PWA     |
| `pnpm --filter @bolsiq/web capturas`                           | telas em 390, 768 e 1440 px para comparar com o design        |
| `node apps/web/scripts/checar-bundle.mjs`                      | nenhuma chave em `.next/static`; roda em todo build de imagem |

No CI o job `e2e` sobe o compose, grava `infra/docker/seed-e2e.sql` e roda o
projeto `e2e` contra http://localhost:3000.

Lighthouse mobile em `/ativo/PETR4`, cache quente, mediana de 5 rodadas:
performance 98, acessibilidade 100.

## Comparador

`/comparar?t=PETR4,PRIO3,HGLG11,07455507000189&p=1A`. A URL é o estado: chips,
período e ordem de cor. Cor fixa por posição (`series-1` a `series-6`).

- Séries montadas no servidor (`lib/comparar.ts`): ativos pelo histórico
  ajustado, fundos pela cota da CVM, CDI e IPCA acumulados, IBOV pelo `/v1/macro`.
- Benchmarks tracejados como no design (CDI 6-4, IPCA 2-4, IBOV 12-4).
- ECharts com import modular (linha, eixo, tooltip, linha de referência).
- "Melhor da linha" vem de `melhoresDaLinha` do analytics, não do front.

## Screener

`/screener?preset=graham&tipos=stock&f=pl:0:15;pvp::1.5&liq=1000000&indef=1&ord=pl&dir=asc&pag=2&cols=pl,pvp`.
`lib/screener-url.ts` lê e escreve esse estado; o preset preenche as faixas do
autor, e qualquer mudança de filtro sai do preset.

- Primeira pintura no servidor com `executarScreener`; depois, `POST
/api/screener`.
- Ordenação no servidor (a coluna clicada vira `ord`/`dir`); 50 por página.
- Seleção de até 6 linhas abre o comparador; o CSV exporta até 1.000 linhas
  com as colunas escolhidas.

## Alertas

Design em [docs/design/Alertas.dc.html](../design/Alertas.dc.html). Decisões no
[ADR 0021](../adr/0021-identidade-provisoria-e-sino.md).

- **Central**: Todas ou Não lidas; clicar marca como lida e abre o ativo.
  O link do e-mail (`/alertas?n=<id>`) destaca e marca a notificação.
- **Nova regra**: 9 tipos em três grupos (Preço, Fundamentos, Eventos). O
  campo Valor só habilita quando o tipo exige. Canais app, e-mail, push e
  Telegram (só com a flag). Cooldown de 1 h, 24 h ou 7 dias e silêncio das
  22h às 7h. O mesmo schema Zod (`lib/alertas-modelo.ts`) valida no navegador
  e no BFF.
- **Minhas regras**: Switch liga e desliga; o worker vê a mudança em até 2 s.
- **Criação rápida**: "Criar alerta" na página do ativo abre um sheet com o
  ticker preenchido.
- **Sino**: contador por SSE; abre com o total do banco e soma a cada aviso.
- **Push**: a permissão só é pedida ao marcar o canal; o service worker mostra
  a notificação e o clique abre a central.
- **Preferências** (`/configuracoes/notificacoes`): canais ligados, e-mail e
  janela de silêncio. Uma regra só avisa pelos canais ligados aqui; o app
  sempre recebe.
- **E-mail**: React Email (`packages/alerts/src/canais/templates.tsx`) no
  visual Bolsiq, com as cores de `@bolsiq/ui/tokens.json`.

e2e em `e2e/alertas.spec.ts`: regra criada pela tela dispara no sino em até
5 s e chega no Mailpit; regra desligada não dispara; sheet do ativo;
preferências.

## Conta

Better Auth (ADR 0010), configurado em `packages/auth` e servido em
`/api/auth`. Decisões de uso no [ADR 0022](../adr/0022-login-carteira-e-snapshot.md).

- **Telas**: `/entrar`, `/cadastro`, `/recuperar`, `/redefinir-senha`,
  `/configuracoes/seguranca` (2FA por TOTP) e `/configuracoes/conta` (sair,
  exportar e excluir).
- **E-mail obrigatório verificado**: o link chega pelo SMTP (Mailpit em dev) e
  já entra na conta. Login antes de verificar reenvia o link.
- **Google** só aparece com `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`.
- **Rotas protegidas** (`/carteiras`, `/configuracoes/conta`,
  `/configuracoes/seguranca`): o `proxy.ts` redireciona sem cookie de sessão;
  a página e o BFF validam a sessão de verdade.
- **Primeiro login no aparelho**: watchlist do `localStorage` e alertas do id
  provisório passam para a conta.

## Carteira

Design em [docs/design/Carteira.dc.html](../design/Carteira.dc.html).

- Seletor de carteira (com "Nova carteira…"); a primeira visita cria
  "Principal".
- Resumo: patrimônio, TWR 12m contra o CDI do período, não realizado,
  realizado e proventos 12m.
- Rentabilidade: TWR dos snapshots contra CDI, IPCA+6% e IBOV, em base 100.
  Enquanto o `portfolio-worker` recalcula, a tela consulta de novo a cada 3 s.
- Alocação por classe, setor ou ativo; posições com o aviso de evento
  corporativo ("Desdobramento 1:2 aplicado"); proventos por mês.
- Nova transação e importação em sheet (embaixo no celular), com relatório
  das linhas rejeitadas. Arquivo de posições, reconhecido pelo cabeçalho, passa
  por revisão antes de gravar ([layout](portfolio.md#layout-de-posicao)).
- "Com IA": extrato em qualquer formato, de qualquer instituição, vários arquivos ou
  texto colado; estimativa de custo, progresso por etapa e a mesma revisão, com
  confiança, trecho de origem e edição por linha ([importacao-ia.md](importacao-ia.md)).
- Colunas de Posições: Ativo, Qtd., Preço médio, Cotação, Custo, Atual (valor de
  mercado), Não realizado, Realizado e Proventos. Segue o design, mais a Cotação,
  que o design não prevê.
- "Renda fixa, fundos e outros": posições vigentes agrupadas por classe, com o
  valor do extrato. Entram no patrimônio e na alocação, não no TWR.
- Toda leitura e escrita passa por `comoUsuario` (RLS). Carteira de outro
  usuário responde 404.

e2e: `e2e/carteira.spec.ts` (conferência, isolamento entre usuários,
500 linhas em menos de 5 s, nova transação, carga e recarga de posições) e `e2e/autenticacao.spec.ts`
(login, recuperação, 2FA, watchlist, LGPD).
