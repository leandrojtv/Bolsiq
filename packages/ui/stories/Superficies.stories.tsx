import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button, Card, Percent, StatTile } from "../src/index.js";

const meta: Meta = { id: "superficies", title: "Layout/Card e StatTile" };
export default meta;

export const Indicadores: StoryObj = {
  render: () => (
    <Card title="Indicadores" className="max-w-sm">
      <div className="grid grid-cols-2 gap-2.5">
        <StatTile label="P/L" value="6,14" />
        <StatTile label="P/VP" value="1,63" />
        <StatTile label="ROE" value={<Percent value="0.2649" />} subtitle="DFP 2025" />
        <StatTile label="DL/EBITDA" value="1,73" />
      </div>
    </Card>
  ),
};

export const ComAcao: StoryObj = {
  render: () => (
    <Card
      title="Filtros"
      action={<Button variant="ghost">Limpar</Button>}
      className="max-w-sm"
    >
      <p className="m-0 text-sm text-text-3">Conteúdo do card.</p>
    </Card>
  ),
};

export const Botoes: StoryObj = {
  render: () => (
    <div className="flex flex-wrap gap-2.5">
      <Button variant="primary">Criar alerta</Button>
      <Button>+ Watchlist</Button>
      <Button variant="ghost">Limpar</Button>
      <Button disabled>Indisponível</Button>
    </div>
  ),
};
