# web

`apps/web`: Next.js (App Router), UI e BFF. Usa os componentes e tokens de
[packages/ui](ui.md) e o design de [docs/design/](../design/README.md).
Decisões no [ADR 0020](../adr/0020-bff-do-web.md).

## Estado atual

| Parte                                              | Estado                                                     |
| -------------------------------------------------- | ---------------------------------------------------------- |
| AppShell, busca global (Ctrl+K)                    | pronto                                                     |
| `/ativo/[ticker]`                                  | pronto: cabeçalho, gráfico, indicadores, preço justo, abas |
| Watchlist                                          | no `localStorage`; vai para o banco no Prompt E            |
| PWA                                                | manifest, ícones gerados dos tokens, service worker        |
| `/comparar`, `/screener`, `/carteiras`, `/alertas` | página provisória "Em construção" (Prompts D a F)          |
| Login                                              | **não implementado** (Prompt E)                            |

## Rodando

```bash
make dev-up
```

App em http://localhost:3000. Para ter dados, rode uma vez:

```bash
make backfill FROM=2024
```

## Rotas

| Rota                                           | O que é                                                   |
| ---------------------------------------------- | --------------------------------------------------------- |
| `/ativo/[ticker]`                              | página do ativo; 404 próprio para ticker fora do universo |
| `/api/v1/...`                                  | BFF do `/v1`, só leitura, com a chave interna             |
| `/api/indicadores/[ticker]`                    | últimos indicadores do analytics                          |
| `/api/stream?t=PETR4`                          | cotação ao vivo por SSE, ponte para o `/v1/stream`        |
| `/api/health`                                  | health da imagem e do compose                             |
| `/manifest.webmanifest`, `/icones/*`, `/sw.js` | PWA                                                       |

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
- **Preço justo**: barra com preço sobre valor justo e o aviso "Não é
  recomendação".

## PWA

- Manifest e ícones (192, 512 e maskable) gerados no build a partir de
  `tokens.css`.
- Service worker (`public/sw.js`): páginas e `/_next/static` em cache; sem
  rede, abre a última versão da página ou `/offline`. `/api/v1/quotes` vai à
  rede primeiro e guarda a resposta, então a última cotação aparece offline.
- Registrado só em produção.

## Variáveis

| Variável              | Para quê                                 |
| --------------------- | ---------------------------------------- |
| `MARKET_DATA_URL`     | base do `/v1`; com o Kong, o gateway     |
| `MARKET_DATA_API_KEY` | chave interna do BFF; nunca no navegador |
| `DATABASE_URL`        | leitura do schema `analytics`            |

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
