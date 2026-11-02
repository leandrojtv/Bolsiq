import type { Meta, StoryObj } from "@storybook/react-vite";
import { Change, CompactNumber, Money, Percent, Price } from "../src/index.js";

const meta: Meta = { id: "numeros", title: "Números/Formatação" };
export default meta;

export const PriceStory: StoryObj = {
  name: "Price",
  render: () => (
    <div className="flex flex-col gap-2">
      <Price value="37.42" className="text-[40px] font-semibold" />
      <Price value="37.42" currency={false} />
      <Price value="0.123456" decimals={4} />
    </div>
  ),
};

export const ChangeStory: StoryObj = {
  name: "Change",
  render: () => (
    <div className="flex flex-col gap-2 text-lg font-semibold">
      <Change value="0.86" percent="0.0235" />
      <Change value="-0.31" percent="-0.0082" />
      <Change value="0" percent="0" />
      <Change percent="0.0041" />
    </div>
  ),
};

export const PercentStory: StoryObj = {
  name: "Percent",
  render: () => (
    <div className="flex flex-col gap-2">
      <Percent value="0.1007" />
      <Percent value="0.0235" sign colored />
      <Percent value="-0.0082" sign colored />
    </div>
  ),
};

export const CompactStory: StoryObj = {
  name: "CompactNumber",
  render: () => (
    <div className="flex flex-col gap-2">
      <CompactNumber value={48_200_000} />
      <CompactNumber value="490829000000" prefix="R$ " />
      <CompactNumber value={3_400} />
    </div>
  ),
};

export const MoneyStory: StoryObj = {
  name: "Money",
  render: () => (
    <div className="flex flex-col gap-2">
      <Money value="1234567.891" />
      <Money value="-52.8" />
    </div>
  ),
};
