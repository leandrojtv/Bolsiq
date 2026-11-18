import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button, Sheet } from "../src/index.js";

const meta: Meta = { id: "sheet", title: "Layout/Sheet" };
export default meta;

export const Aberto: StoryObj = {
  render: function Render() {
    const [aberto, setAberto] = useState(true);
    return (
      <>
        <Button variant="primary" onClick={() => setAberto(true)}>
          Criar alerta
        </Button>
        <Sheet
          open={aberto}
          onOpenChange={setAberto}
          title="Novo alerta para PETR4"
          description="Avisamos quando a condição acontecer."
        >
          <p className="m-0 text-text-2">Conteúdo do formulário.</p>
        </Sheet>
      </>
    );
  },
};
