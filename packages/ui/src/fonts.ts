/**
 * Fontes do app via next/font/local, a partir dos arquivos do @fontsource
 * (os mesmos do Storybook). O build nao baixa nada do Google: com
 * next/font/google, uma falha de rede no build derrubava a imagem do web.
 *
 * Uso no layout raiz do apps/web:
 *   <html className={`${inter.variable} ${jetbrainsMono.variable}`}>
 *
 * As variaveis --font-inter e --font-jetbrains sao as que tokens.css le.
 * Fica fora do index de proposito: so o app Next importa isto. Os caminhos
 * sao relativos a dist/fonts.js, que e o arquivo que o Next importa.
 */
import localFont from "next/font/local";

export const inter = localFont({
  src: "../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  weight: "400 700",
  variable: "--font-inter",
  display: "swap",
});

export const jetbrainsMono = localFont({
  src: "../node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2",
  weight: "400 600",
  variable: "--font-jetbrains",
  display: "swap",
});
