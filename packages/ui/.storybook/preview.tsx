import type { Preview } from "@storybook/react-vite";
import "./preview.css";

const preview: Preview = {
  parameters: {
    layout: "padded",
    backgrounds: { disable: true },
    a11y: { test: "error" },
    controls: { expanded: true },
  },
  decorators: [
    (Story) => (
      <div data-theme="dark" className="bg-bg font-sans text-text">
        <Story />
      </div>
    ),
  ],
};

export default preview;
