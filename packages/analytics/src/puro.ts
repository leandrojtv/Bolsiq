/**
 * Entrada sem banco nem NATS, para o navegador: filtro e presets do screener,
 * regras do comparador e formulas. O index tambem exporta o worker, que puxa
 * pg e nats e nao pode entrar no bundle do cliente.
 */
export * from "./tipos.js";
export * from "./screener.js";
export * from "./comparador.js";
export * from "./desempenho.js";
export * from "./sinais.js";
export * from "./tecnicos.js";
// So tipos: o executor fica fora, porque usa o banco.
export type { LinhaDoScreener, ResultadoDoScreener } from "./executarScreener.js";
