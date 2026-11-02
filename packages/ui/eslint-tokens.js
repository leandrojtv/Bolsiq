// Regra do design system: cor e fonte so em tokens.css.
//
// Usada pelo eslint.config.js da raiz nos arquivos de packages/ui. Qualquer
// literal com hex, rgb()/hsl() ou nome de fonte num componente reprova o lint:
// o componente usa a classe do token (bg-surface, text-up, font-mono).

const HEX = String.raw`/#[0-9a-fA-F]{3,8}(?![0-9a-zA-Z_-])/`;
const FUNCAO_DE_COR = String.raw`/\b(rgba?|hsla?|oklch|oklab|hwb)\(/`;
const FONTE = String.raw`/(^|[\s"',])(Inter|JetBrains Mono|Nunito|Roboto|Arial|Helvetica|monospace|sans-serif)([\s"',]|$)/`;
const FONTE_ARBITRARIA = String.raw`/font-\[/`;

const mensagem = (o) =>
  `${o} fora de tokens.css. Use o token (classe do preset), ver docs/services/ui.md.`;

export const regrasDeToken = [
  { selector: `Literal[value=${HEX}]`, message: mensagem("Cor hex") },
  { selector: `TemplateElement[value.raw=${HEX}]`, message: mensagem("Cor hex") },
  { selector: `Literal[value=${FUNCAO_DE_COR}]`, message: mensagem("Cor literal") },
  {
    selector: `TemplateElement[value.raw=${FUNCAO_DE_COR}]`,
    message: mensagem("Cor literal"),
  },
  { selector: `Literal[value=${FONTE}]`, message: mensagem("Fonte") },
  { selector: `TemplateElement[value.raw=${FONTE}]`, message: mensagem("Fonte") },
  {
    selector: `Literal[value=${FONTE_ARBITRARIA}]`,
    message: mensagem("Fonte arbitrária"),
  },
];
