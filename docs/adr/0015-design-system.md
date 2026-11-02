# ADR 0015 - Design system em packages/ui, com tokens em CSS e Tailwind 4

- **Status:** aceito
- **Data:** 2026-11-02
- **Decisores:** @leandrojtv

## Contexto

As telas de `docs/design/` definem cor, raio, fonte e espaçamento com estilo
inline. Sem uma fonte única, cada tela do `apps/web` copiaria hex e tamanhos, e
o primeiro ajuste de cor viraria uma busca em dezenas de arquivos. O CLAUDE.md
fixa Tailwind e shadcn/ui no front.

## Decisão

**`packages/ui` é a fonte única do visual.**

1. **Tokens em CSS variables** (`tokens.css`), com os valores da tabela do
   `docs/design/README.md` sem arredondar. Cores que as telas usam e a tabela
   não lista (link, borda de input, tons suaves de alta e queda) entram como
   tokens derivados, com nome de papel, em vez de hex solto.
2. **Tailwind 4, com o preset em CSS** (`preset.css`, `@theme inline`). O
   Tailwind 4 trocou o preset em JavaScript por configuração em CSS; `inline`
   faz `bg-surface` apontar para `var(--surface)`, então trocar o tema troca
   tudo sem rebuild. A paleta padrão do Tailwind é removida
   (`--color-*: initial`): `bg-blue-500` nem existe.
3. **Tema escuro como padrão**, em `:root`. Tema claro é outro bloco
   `[data-theme="light"]` redefinindo as mesmas variáveis; hoje existe vazio,
   porque não há valores aprovados, e cor inventada é pior que nenhuma.
4. **shadcn/ui como padrão, Radix como base**: os componentes seguem a forma do
   shadcn (código no repositório, `cva`, `cn`) sobre primitivos do Radix para
   o que tem comportamento (Tabs, Switch, Select).
5. **Fontes auto-hospedadas**: no app, `next/font` (`@bolsiq/ui/fonts`), que
   baixa no build e serve do próprio domínio. No Storybook, `@fontsource`, com
   os arquivos no pacote: a regressão visual não depende de rede.
6. **Lint que reprova hex, função de cor e nome de fonte** em qualquer arquivo
   de `packages/ui` que não seja `tokens.css` (ESLint para TS/TSX, script para
   CSS). A guarda tem teste próprio.
7. **Regressão visual com Playwright** contra o Storybook estático, rodando na
   imagem oficial do Playwright, no CI e na máquina. Referência gerada no macOS
   reprovaria no Linux do CI sem nada ter mudado.

## Consequências

### Positivas

- Mudar uma cor é mudar uma linha, e o teste de contraste confere os pares de
  texto e fundo a cada mudança.
- O `apps/web` não decide cor nem fonte: usa componente e classe de token.
- Acessibilidade conferida em teste: axe por história, foco visível, alvo de
  44 px.

### Negativas

- Tailwind 4 em vez de 3: menos material de referência, e o "preset" é um CSS,
  não o `presets: []` do `tailwind.config.js`.
- Duas origens de fonte (next/font no app, @fontsource no Storybook), com o
  mesmo arquivo de fonte, mas carregamento diferente.
- A regressão visual exige Docker localmente.

## Notas

O número 0015 estava reservado para "Proveniência obrigatória em todo dado de
mercado". A reserva passou para 0019.
