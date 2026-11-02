/**
 * Fontes do app via next/font: o Next baixa no build e serve do proprio
 * dominio, sem requisicao ao Google em tempo de execucao.
 *
 * Uso no layout raiz do apps/web:
 *   <html className={`${inter.variable} ${jetbrainsMono.variable}`}>
 *
 * As variaveis --font-inter e --font-jetbrains sao as que tokens.css le.
 * Fica fora do index de proposito: so o app Next importa isto.
 */
import { Inter, JetBrains_Mono } from "next/font/google";

export const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

export const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-jetbrains",
  display: "swap",
});
