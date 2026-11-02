# Design de referência do apps/web

Fonte da verdade visual das telas. Canvas original: https://claude.ai/artifact/Qbxs6gp5E1KYUzgHLWF897

Cada `.dc.html` é uma tela: o markup dentro de `<x-dc>` é o layout (estilos inline), e o bloco `<script type="text/x-dc">` gera dados de exemplo. Use os arquivos como especificação de layout, hierarquia, espaçamento, cores e estados; não copie o runtime `support.js` nem os dados de exemplo.

| Arquivo | Rota no app |
|---|---|
| Main.dc.html | `/ativo/[ticker]` (desktop) |
| AtivoMobile.dc.html | `/ativo/[ticker]` em 390 px |
| Comparador.dc.html | `/comparar?t=...` |
| Screener.dc.html | `/screener` |
| Carteira.dc.html | `/carteiras/[id]` |
| Alertas.dc.html | `/alertas` |

## Tokens

| Token | Valor | Uso |
|---|---|---|
| bg | #0B0F14 | fundo da página |
| sidebar | #0F141B | menu lateral, fundos de controle |
| surface | #121821 | cards |
| surface-2 | #18202B | item ativo, chips |
| border | #1E2631 | bordas de card e linhas de tabela |
| border-strong | #2B3542 | bordas de input e botão secundário |
| text | #E7EBF0 | texto principal |
| text-2 | #AEB8C5 | texto secundário |
| text-3 | #9BA6B4 | rótulos, legendas |
| accent | #6C9CFF | ação primária, série principal |
| accent-soft | #233049 | botão segmentado selecionado (texto #C2D5FF) |
| up | #3DD68C | alta, sempre com ▲ |
| down | #FF8A5B | queda, sempre com ▼ |
| warn | #F5C46B sobre #2A2113 | selo de atraso, beta |
| série 2/3/4 | #F5C46B, #C9A7FF, #4FD1C5 | comparador e alocação |
| benchmarks | #8A95A3 tracejado | CDI 6-4, IPCA 2-4, IBOV 12-4 |

- Fontes: Inter (texto, 400/500/600/700) e JetBrains Mono (todo número, `tabular-nums`).
- Raio: 14 px cards, 10 px botões e inputs, 8 px itens de menu, 6 px chips.
- Alvos de toque: mínimo 44 px. Contraste mínimo 4,5:1.
- Layout: menu lateral de 220 px que vira navegação inferior abaixo de 768 px; conteúdo fluido com padding 28 px.
