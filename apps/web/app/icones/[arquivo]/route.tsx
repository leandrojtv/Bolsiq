import { ImageResponse } from "next/og";
import { valorDoToken } from "@/lib/tokens";

export const dynamic = "force-static";

const ARQUIVOS = {
  "192.png": [192, false],
  "512.png": [512, false],
  "maskable-512.png": [512, true],
} as const;

export function generateStaticParams() {
  return Object.keys(ARQUIVOS).map((arquivo) => ({ arquivo }));
}

/**
 * Icone do PWA gerado no build: o "B" do logo do AppShell, nas cores dos
 * tokens. O maskable deixa a margem de seguranca de 20% que o Android recorta.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ arquivo: string }> }) {
  const { arquivo } = await ctx.params;
  const def = ARQUIVOS[arquivo as keyof typeof ARQUIVOS];
  if (!def) return new Response(null, { status: 404 });
  const [lado, mascaravel] = def;
  const fundo = valorDoToken("bg");
  const accent = valorDoToken("accent");
  const sobre = valorDoToken("on-accent");
  const quadro = mascaravel ? lado * 0.6 : lado * 0.84;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: fundo,
      }}
    >
      <div
        style={{
          width: quadro,
          height: quadro,
          borderRadius: quadro * 0.27,
          background: accent,
          color: sobre,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: quadro * 0.58,
          fontWeight: 700,
        }}
      >
        B
      </div>
    </div>,
    { width: lado, height: lado },
  );
}
