# ADR 0020 - BFF do apps/web: chave só no servidor, cotação ao vivo por SSE

- **Status:** aceito
- **Data:** 2026-11-02
- **Decisores:** @leandrojtv

## Contexto

O `apps/web` consome o `/v1` do market-data, que no plano do ADR 0007 fica
atrás do Kong com chave por cliente. O próprio app é um cliente: precisa de
chave, e ela não pode ir para o navegador. O Kong ainda não existe. A cotação
ao vivo vem do WebSocket `/v1/stream`, que também passaria pelo gateway.

## Decisão

1. **Route handlers do Next como BFF.** O navegador chama `/api/v1/...`; o
   servidor repassa ao market-data com `X-API-Key` (`MARKET_DATA_API_KEY`).
   Só uma lista fechada de caminhos de leitura passa (`lib/market-data.ts`);
   `/admin` e qualquer outro respondem 404 sem tocar o upstream.
2. **Sem Kong por enquanto**: `MARKET_DATA_URL` aponta direto para o
   market-data. Quando o gateway entrar, muda só a URL.
3. **Cotação ao vivo por Server-Sent Events** (`/api/stream`). O servidor abre
   o WebSocket com a chave e repassa só as mensagens de cotação. O cliente só
   assina com a aba visível.
4. **Indicadores lidos do schema `analytics`**, direto do banco: o analytics é
   módulo do app (ADR 0009). O app não lê `market_data`.
5. **Server Components na primeira pintura, TanStack Query depois.** A página
   do ativo espera os dados no servidor (cache do `fetch` do Next) e manda o
   HTML completo; o cliente assume com `initialData`.
6. **Sem streaming na página do ativo.** Com `loading.tsx` ou `Suspense`, o
   Next responde 200 antes do `notFound()` e o 404 vira 200; e o preço, maior
   elemento da tela, chega depois, pelo script de troca do streaming
   (Lighthouse mobile: LCP de 3,8 s com streaming, 1,8 s sem).

## Consequências

### Positivas

- A chave não chega ao navegador. O build da imagem procura o prefixo de chave
  (`mdk_live_`, `mdk_test_`) no bundle e reprova se achar.
- O 404 de ticker inexistente é um 404 HTTP de verdade.
- Trocar para o Kong não muda código do app.

### Negativas

- Uma conexão WebSocket por aba aberta no servidor do app. No volume atual,
  aceitável; com muitos usuários, um único assinante no servidor com fan-out
  em memória resolve.
- Sem esqueleto na primeira navegação para o ativo: o servidor espera os dados
  (cerca de 150 ms com cache quente). Os esqueletos ficam onde o carregamento é
  no cliente: gráfico, troca de período, demonstrativos trimestrais.
