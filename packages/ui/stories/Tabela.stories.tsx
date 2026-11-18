import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Card,
  Change,
  CompactNumber,
  DataTable,
  Percent,
  type Column,
} from "../src/index.js";

const meta: Meta = { id: "tabela", title: "Dados/DataTable" };
export default meta;

interface Linha {
  ticker: string;
  nome: string;
  pl: number | null;
  dy: number;
  variacao: number;
  liquidez: number;
}

const LINHAS: Linha[] = [
  {
    ticker: "PETR4",
    nome: "Petrobras PN",
    pl: 6.14,
    dy: 0.069,
    variacao: 0.0235,
    liquidez: 3_265_521_701,
  },
  {
    ticker: "VALE3",
    nome: "Vale ON",
    pl: 22.42,
    dy: 0.09,
    variacao: -0.0082,
    liquidez: 1_820_000_000,
  },
  {
    ticker: "WEGE3",
    nome: "WEG ON",
    pl: 29.94,
    dy: 0.018,
    variacao: 0.0041,
    liquidez: 410_000_000,
  },
  {
    ticker: "MGLU3",
    nome: "Magazine Luiza ON",
    pl: null,
    dy: 0,
    variacao: -0.031,
    liquidez: 220_000_000,
  },
];

const COLUNAS: Column<Linha>[] = [
  {
    key: "ticker",
    header: "Ativo",
    cell: (l) => <span className="font-mono font-semibold">{l.ticker}</span>,
    sortValue: (l) => l.ticker,
  },
  { key: "nome", header: "Nome", cell: (l) => l.nome },
  {
    key: "pl",
    header: "P/L",
    numeric: true,
    cell: (l) => (l.pl === null ? "—" : l.pl.toFixed(2).replace(".", ",")),
    sortValue: (l) => l.pl,
  },
  {
    key: "dy",
    header: "DY 12m",
    numeric: true,
    cell: (l) => <Percent value={l.dy} />,
    sortValue: (l) => l.dy,
  },
  {
    key: "var",
    header: "Dia",
    numeric: true,
    cell: (l) => <Change percent={l.variacao} />,
    sortValue: (l) => l.variacao,
  },
  {
    key: "liq",
    header: "Liquidez",
    numeric: true,
    cell: (l) => <CompactNumber value={l.liquidez} prefix="R$ " />,
    sortValue: (l) => l.liquidez,
  },
];

export const Screener: StoryObj = {
  render: () => (
    <Card title="Resultados">
      <DataTable
        caption="Resultado do screener"
        columns={COLUNAS}
        rows={LINHAS}
        rowKey={(l) => l.ticker}
        initialSort={{ key: "pl", direction: "asc" }}
      />
    </Card>
  ),
};

export const Vazia: StoryObj = {
  render: () => (
    <DataTable
      caption="Sem resultado"
      columns={COLUNAS}
      rows={[]}
      rowKey={(l) => l.ticker}
    />
  ),
};

export const Estreita: StoryObj = {
  globals: { viewport: { value: "mobile1" } },
  render: () => (
    <div className="max-w-[360px] rounded-card border border-border bg-surface">
      <DataTable
        caption="Rolagem horizontal"
        columns={COLUNAS}
        rows={LINHAS}
        rowKey={(l) => l.ticker}
      />
    </div>
  ),
};
