import type { MetadataRoute } from "next";
import { valorDoToken } from "@/lib/tokens";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Bolsiq",
    short_name: "Bolsiq",
    description: "Análise e comparação de ativos da B3.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    lang: "pt-BR",
    background_color: valorDoToken("bg"),
    theme_color: valorDoToken("bg"),
    icons: [
      { src: "/icones/192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icones/512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icones/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
