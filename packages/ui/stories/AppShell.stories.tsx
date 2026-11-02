import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  AppShell,
  Card,
  Change,
  navegacaoPadrao,
  Price,
  SourceLine,
  StaleBadge,
} from "../src/index.js";

const meta: Meta<typeof AppShell> = {
  id: "app-shell",
  title: "Layout/AppShell",
  component: AppShell,
  parameters: { layout: "fullscreen" },
};
export default meta;

const WATCH = [
  { ticker: "PETR4", href: "#petr4", changePercent: 0.0235 },
  { ticker: "VALE3", href: "#vale3", changePercent: -0.0082 },
  { ticker: "WEGE3", href: "#wege3", changePercent: 0.0041 },
  { ticker: "HGLG11", href: "#hglg11", changePercent: 0.0012 },
  { ticker: "ITUB4", href: "#itub4", changePercent: -0.003 },
];

function Conteudo() {
  return (
    <>
      <section className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="m-0 font-mono text-[30px] font-bold tracking-tight">PETR4</h1>
          <span className="text-base text-text-2">Petrobras PN</span>
        </div>
        <div className="flex flex-wrap items-baseline gap-3.5">
          <Price value="37.42" className="text-[40px] font-semibold" />
          <Change value="0.86" percent="0.0235" className="text-lg font-semibold" />
        </div>
        <div className="flex items-center gap-2">
          <StaleBadge delayMinutes={15} />
          <SourceLine
            source="B3 via brapi"
            fetchedAt="2026-11-02T17:52:00Z"
            now={new Date("2026-11-02T18:00:00Z")}
          />
        </div>
      </section>
      <Card title="Gráfico de preço">
        <div className="h-48 rounded-control bg-sidebar" />
      </Card>
    </>
  );
}

export const Desktop: StoryObj<typeof AppShell> = {
  args: {
    nav: navegacaoPadrao("/ativo"),
    watchlist: WATCH,
    notifications: 3,
    userInitials: "LB",
  },
  render: (args) => (
    <AppShell {...args}>
      <Conteudo />
    </AppShell>
  ),
};

export const Mobile: StoryObj<typeof AppShell> = {
  ...Desktop,
  globals: { viewport: { value: "mobile2" } },
};
