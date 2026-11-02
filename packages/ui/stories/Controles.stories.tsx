import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  RangeInput,
  SegmentedControl,
  Select,
  Switch,
  ToggleChip,
} from "../src/index.js";

const meta: Meta = { id: "controles", title: "Controles/Seletores" };
export default meta;

const PERIODOS = ["1M", "6M", "1A", "5A", "Máx"].map((p) => ({ value: p, label: p }));

export const Segmentado: StoryObj = {
  render: function Render() {
    const [p, setP] = useState("6M");
    return (
      <SegmentedControl label="Período" options={PERIODOS} value={p} onChange={setP} />
    );
  },
};

export const Chips: StoryObj = {
  render: function Render() {
    const [on, setOn] = useState({ ma20: true, ma50: true, ifr: false, cdi: true });
    return (
      <div className="flex flex-wrap gap-2">
        <ToggleChip
          swatch="series-1"
          pressed={on.ma20}
          onPressedChange={(v) => setOn({ ...on, ma20: v })}
        >
          MM 20
        </ToggleChip>
        <ToggleChip
          swatch="series-2"
          pressed={on.ma50}
          onPressedChange={(v) => setOn({ ...on, ma50: v })}
        >
          MM 50
        </ToggleChip>
        <ToggleChip
          swatch="series-3"
          pressed={on.ifr}
          onPressedChange={(v) => setOn({ ...on, ifr: v })}
        >
          IFR 14
        </ToggleChip>
        <ToggleChip
          swatch="benchmark"
          pressed={on.cdi}
          onPressedChange={(v) => setOn({ ...on, cdi: v })}
        >
          CDI
        </ToggleChip>
      </div>
    );
  },
};

export const Faixa: StoryObj = {
  render: function Render() {
    const [f, setF] = useState({ min: "0", max: "15" });
    return (
      <div className="max-w-xs">
        <RangeInput
          label="P/L"
          min={f.min}
          max={f.max}
          onChange={setF}
          onRemove={() => undefined}
          removeLabel="Remover filtro P/L"
        />
      </div>
    );
  },
};

export const Interruptor: StoryObj = {
  render: function Render() {
    const [a, setA] = useState(true);
    const [b, setB] = useState(false);
    return (
      <div className="flex flex-col gap-1">
        <Switch checked={a} onCheckedChange={setA} label="Ajustado por proventos" />
        <Switch
          checked={b}
          onCheckedChange={setB}
          label="Incluir ativos com indicador indefinido"
        />
      </div>
    );
  },
};

export const Selecao: StoryObj = {
  render: function Render() {
    const [v, setV] = useState("pl");
    return (
      <Select
        label="Ordenar por"
        value={v}
        onValueChange={setV}
        options={[
          { value: "pl", label: "P/L" },
          { value: "dy", label: "Dividend yield" },
          { value: "roe", label: "ROE" },
        ]}
      />
    );
  },
};
