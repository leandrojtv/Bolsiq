/** Entrada sem servidor, para o navegador: perfil, catalogo e rotulos. */
export * from "./perfil.js";
export * from "./catalogo.js";
export * from "./rotulos.js";
export { AVISO_EDUCACIONAL } from "../prompts/sistema-v1.js";
export * from "./importacao/conciliacao.js";
export type {
  ConciliacaoDaNota,
  LinhaProposta,
  RejeicaoDaIA,
  ResultadoDaValidacao,
  TipoDeLinha,
} from "./importacao/validacao.js";
export type { Confianca, Origem } from "./importacao/esquema.js";
export type { Estimativa, Atalho } from "./importacao/pipeline.js";
export type { Remocoes } from "./importacao/anonimizar.js";
