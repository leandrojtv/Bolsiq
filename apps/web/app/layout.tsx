import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { inter, jetbrainsMono } from "@bolsiq/ui/fonts";
import { Casca } from "@/componentes/Casca";
import { Providers } from "@/componentes/Providers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Bolsiq", template: "%s · Bolsiq" },
  description: "Análise e comparação de ativos da B3: ações, FIIs, BDRs, ETFs e fundos.",
  applicationName: "Bolsiq",
  appleWebApp: { capable: true, title: "Bolsiq", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "dark",
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="pt-BR"
      data-theme="dark"
      className={`${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body>
        <Providers>
          <Casca>{children}</Casca>
        </Providers>
      </body>
    </html>
  );
}
