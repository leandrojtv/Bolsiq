import type { NextConfig } from "next";

const config: NextConfig = {
  // Imagem enxuta: o build copia so o que o servidor usa (Dockerfile).
  output: "standalone",
  // Raiz do monorepo, para o standalone incluir os pacotes do workspace.
  outputFileTracingRoot: new URL("../..", import.meta.url).pathname,
  transpilePackages: ["@bolsiq/ui"],
  // pdf.js carrega o proprio worker em tempo de execucao: empacotado, quebra.
  serverExternalPackages: ["pdfjs-dist"],
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default config;
