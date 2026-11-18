# ui (design system)

`packages/ui`: tokens, preset do Tailwind, fontes e componentes do Bolsiq. É a
fonte única do visual das telas de [docs/design/](../design/README.md). Decisão
no [ADR 0015](../adr/0015-design-system.md).

## Uso no app

```css
/* app/globals.css */
@import "tailwindcss";
@import "@bolsiq/ui/tokens.css";
@import "@bolsiq/ui/preset.css";
```

```tsx
// app/layout.tsx
import { inter, jetbrainsMono } from "@bolsiq/ui/fonts";

<html lang="pt-BR" className={`${inter.variable} ${jetbrainsMono.variable}`}>
```

```tsx
import { AppShell, Change, Price, StaleBadge } from "@bolsiq/ui";
```

O `preset.css` declara `@source "./src"`: o Tailwind do app gera as classes que
os componentes usam sem configuração extra.

## Tokens

Em `tokens.css`. Os valores da tabela do `docs/design/README.md` estão lá sem
arredondar; os derivados são cores que as telas usam e a tabela não lista.

| Grupo      | Tokens                                                                              |
| ---------- | ----------------------------------------------------------------------------------- |
| Superfície | `bg`, `sidebar`, `surface`, `surface-2`                                             |
| Borda      | `border`, `border-strong`; derivados `border-input`, `border-active`                |
| Texto      | `text`, `text-2`, `text-3`; derivados `link`, `link-hover`                          |
| Ação       | `accent`, `accent-soft`, `accent-soft-text`; derivados `accent-tint`, `on-accent`   |
| Variação   | `up`, `down`; derivados `*-soft`, `*-strong`, `on-down`, `volume-up`, `volume-down` |
| Aviso      | `warn`, `warn-bg`                                                                   |
| Séries     | `series-1` (= accent), `series-2`, `series-3`, `series-4`, `benchmark`              |
| Raio       | `card-radius` 14, `control-radius` 10, `item-radius` 8, `chip-radius` 6             |
| Fonte      | `font-family-sans` (Inter), `font-family-mono` (JetBrains Mono)                     |
| Layout     | `sidebar-width` 220, `touch-target` 44, `content-padding` 28                        |

No Tailwind cada token vira utilidade: `bg-surface`, `text-text-3`,
`border-border-strong`, `rounded-card`, `font-mono`, `w-sidebar`, `h-touch`.

**Tema.** Escuro é o padrão, em `:root`. O claro é o bloco
`[data-theme="light"]`, hoje vazio de propósito: sem valores aprovados, ativar
o claro mantém o escuro em vez de exibir cor inventada. Para criar o tema,
redefina ali as mesmas variáveis; nenhum componente muda.

**Fontes.** No app, `next/font` (`@bolsiq/ui/fonts`) define `--font-inter` e
`--font-jetbrains`, que `tokens.css` lê. No Storybook essas variáveis não
existem e vale o fallback, as famílias que o `@fontsource` registra.

## Componentes

| Componente                             | Para quê                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------ |
| `Price`, `Money`                       | preço e valor em `R$ 1.234,56`                                           |
| `Change`                               | variação com seta e sinal sempre (`▲ +0,86 (+2,35%)`), cor de alta/queda |
| `Percent`                              | fração como percentual (`0.0235` vira `2,35%`)                           |
| `CompactNumber`                        | `1,2 bi`, `48,2 mi`, `3,4 mil`                                           |
| `StaleBadge`                           | "Atraso de 15 min" a partir de `meta.delay_minutes`; some sem atraso     |
| `SourceLine`                           | "Fonte: B3 via brapi · atualizado 14:52", hora em America/Sao_Paulo      |
| `Card`, `StatTile`                     | superfícies das telas                                                    |
| `Button`                               | primário, secundário, fantasma; `asChild` para link                      |
| `SegmentedControl`                     | seletor de período, botões com `aria-pressed`                            |
| `ToggleChip`                           | MM 20, IFR 14, benchmarks; amostra pela cor da série                     |
| `Tabs`, `Select`, `Switch`             | Radix por baixo; `Switch` com `role=switch`                              |
| `DataTable`                            | ordenação, primeira coluna fixa, rolagem horizontal em tela estreita     |
| `RangeInput`                           | mínimo e máximo do screener                                              |
| `EmptyState`, `ErrorState`, `Skeleton` | estados; erro com `role=alert` e código de correlação                    |
| `AppShell`                             | menu de 220 px; abaixo de 768 px, navegação inferior de 5 itens          |

Os números usam JetBrains Mono com `tabular-nums`. Valor monetário chega como
string decimal do `/v1` (regra 5) e só vira `number` no último passo, para o
`Intl` formatar.

## Acessibilidade

- **Alvo de 44 px.** O design desenha segmentado e chip com 36 px; um
  `::after` estende a área clicável 4 px para cada lado (`ALVO_44`), sem mudar
  o desenho. Teste em `tests/visual`.
- **Contraste de 4,5:1.** `tests/unit/contraste.test.ts` lê `tokens.css` e
  confere cada par de texto e fundo usado.
- **Foco visível** em todo elemento interativo (`:focus-visible` com o accent).
- **Leitor de tela.** `Change` fala "alta de 0,86 (+2,35%)"; segmentado e chip
  com `aria-pressed`; `DataTable` com `aria-sort`; `AppShell` com
  `aria-current` e contador no rótulo do sino.
- O axe roda em cada história da regressão visual e reprova violação.

## Storybook

```bash
make storybook
```

Sobe em http://localhost:6006 pelo perfil `tools` do compose. Uma história por
componente e a página **Fundamentos/Tokens**.

## Testes

| Teste                                | O que confere                                               |
| ------------------------------------ | ----------------------------------------------------------- |
| `pnpm --filter @bolsiq/ui test:unit` | formatação, comportamento e acessibilidade dos componentes  |
| `tests/unit/contraste.test.ts`       | contraste dos tokens                                        |
| `tests/unit/lint-tokens.test.ts`     | a própria regra do lint                                     |
| `make ui-visual`                     | regressão visual e axe, na imagem do Playwright, como no CI |
| `make ui-visual-update`              | regrava as referências depois de mudança visual intencional |

As referências ficam em `tests/visual/__screenshots__` e são geradas na imagem
oficial do Playwright: fonte e antialias mudam entre sistemas.

## Lint: nenhuma cor fora de tokens.css

O ESLint reprova, em `packages/ui`, literal com hex, `rgb()`/`hsl()`,
`font-[...]` ou nome de fonte (`eslint-tokens.js`). `scripts/checar-tokens.mjs`
faz o mesmo nos CSS, exceto `tokens.css`. Cor nova entra como token, com nome
de papel.

## Como adicionar um componente

1. Arquivo em `src/components/`, exportado em `src/index.ts`.
2. Só classes de token (`bg-surface`, `text-up`). Cor que não existe vira token
   novo em `tokens.css` e `preset.css`, e entra no teste de contraste.
3. Controle interativo: alvo de 44 px (`h-touch` ou `ALVO_44`), foco visível,
   papel ARIA. Comportamento com teclado vem do Radix quando houver primitivo.
4. Teste em `src/components/componentes.test.tsx`.
5. História em `stories/`, com `id` ASCII estável.
6. Se a história for das principais, inclua em `tests/visual/historias.spec.ts`
   e rode `make ui-visual-update`.
