import type { Meta, StoryObj } from "@storybook/react-vite";

const CORES: { grupo: string; tokens: string[] }[] = [
  { grupo: "Superfícies", tokens: ["bg", "sidebar", "surface", "surface-2"] },
  {
    grupo: "Bordas",
    tokens: ["border", "border-strong", "border-input", "border-active"],
  },
  { grupo: "Texto", tokens: ["text", "text-2", "text-3", "link", "link-hover"] },
  {
    grupo: "Ação",
    tokens: ["accent", "accent-soft", "accent-soft-text", "accent-tint", "on-accent"],
  },
  {
    grupo: "Variação",
    tokens: [
      "up",
      "up-soft",
      "up-strong",
      "down",
      "down-soft",
      "down-strong",
      "on-down",
      "volume-up",
      "volume-down",
    ],
  },
  { grupo: "Aviso", tokens: ["warn", "warn-bg"] },
  {
    grupo: "Séries",
    tokens: [
      "series-1",
      "series-2",
      "series-3",
      "series-3-soft",
      "series-3-strong",
      "series-4",
      "series-5",
      "series-6",
      "benchmark",
    ],
  },
];

const RAIOS = [
  ["card-radius", "cards"],
  ["control-radius", "botões e inputs"],
  ["item-radius", "itens de menu"],
  ["chip-radius", "chips"],
];

function Tokens() {
  return (
    <div className="flex flex-col gap-8">
      {CORES.map((g) => (
        <section key={g.grupo} className="flex flex-col gap-3">
          <h2 className="m-0 text-base font-semibold">{g.grupo}</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
            {g.tokens.map((t) => (
              <div key={t} className="flex flex-col gap-1.5">
                <div
                  className="h-14 rounded-control border border-border"
                  style={{ background: `var(--${t})` }}
                />
                <code className="font-mono text-xs text-text-2">--{t}</code>
              </div>
            ))}
          </div>
        </section>
      ))}
      <section className="flex flex-col gap-3">
        <h2 className="m-0 text-base font-semibold">Raios</h2>
        <div className="flex flex-wrap gap-4">
          {RAIOS.map(([t, uso]) => (
            <div key={t} className="flex flex-col items-center gap-1.5">
              <div
                className="size-20 border border-border-strong bg-surface"
                style={{ borderRadius: `var(--${t})` }}
              />
              <code className="font-mono text-xs text-text-2">--{t}</code>
              <span className="text-xs text-text-3">{uso}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="m-0 text-base font-semibold">Fontes</h2>
        <p className="m-0 font-sans text-base">
          Inter: texto, títulos e rótulos. 400, 500, 600 e 700.
        </p>
        <p className="m-0 font-mono text-base tabular-nums">
          JetBrains Mono: 1.234.567,89 · R$ 37,42 · ▲ +2,35%
        </p>
      </section>
    </div>
  );
}

const meta: Meta<typeof Tokens> = {
  id: "tokens",
  title: "Fundamentos/Tokens",
  component: Tokens,
};
export default meta;
export const Todos: StoryObj<typeof Tokens> = {};
