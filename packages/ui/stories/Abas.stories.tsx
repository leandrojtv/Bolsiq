import type { Meta, StoryObj } from "@storybook/react-vite";
import { Tabs } from "../src/index.js";

const meta: Meta = { id: "abas", title: "Controles/Tabs" };
export default meta;

export const Detalhes: StoryObj = {
  render: () => (
    <Tabs
      label="Detalhes do ativo"
      items={[
        {
          value: "proventos",
          label: "Proventos",
          content: <p className="m-0 text-text-2">Proventos por ano.</p>,
        },
        {
          value: "demos",
          label: "Demonstrativos",
          content: <p className="m-0 text-text-2">DRE, BP e DFC.</p>,
        },
        {
          value: "sobre",
          label: "Sobre",
          content: <p className="m-0 text-text-2">Resumo da empresa.</p>,
        },
      ]}
    />
  ),
};
