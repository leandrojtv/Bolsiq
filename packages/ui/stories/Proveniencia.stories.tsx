import type { Meta, StoryObj } from "@storybook/react-vite";
import { SourceLine, StaleBadge } from "../src/index.js";

const meta: Meta = { id: "proveniencia", title: "Dados/Proveniência" };
export default meta;

const AGORA = new Date("2026-11-02T18:00:00Z");

export const Selos: StoryObj = {
  render: () => (
    <div className="flex flex-col items-start gap-3">
      <div className="flex items-center gap-2">
        <StaleBadge delayMinutes={15} />
        <SourceLine source="B3 via brapi" fetchedAt="2026-11-02T17:52:00Z" now={AGORA} />
      </div>
      <StaleBadge delayMinutes={1440} />
      <StaleBadge delayMinutes={15} stale />
      <SourceLine source="CVM DFP" fetchedAt="2026-10-30T09:15:00Z" now={AGORA} />
      <span className="text-xs text-text-3">
        Sem atraso o selo não aparece: [<StaleBadge delayMinutes={0} />]
      </span>
    </div>
  ),
};
