/**
 * Escreve o openapi.json a partir dos schemas Zod das rotas.
 *
 * Usado pelo check `contract` do CI, que compara o documento desta branch com
 * o da base via `oasdiff` e reprova quebra incompatível em /v1.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildOpenApi } from "@bolsiq/contracts";
import { rotas } from "./routes/specs.js";

const documento = buildOpenApi(
  {
    title: "Bolsiq market-data",
    version: process.env.SERVICE_VERSION ?? "0.0.0",
    description: "API de dados de mercado da B3.",
    servers: [{ url: "https://api.bolsiq.com", description: "produção" }],
  },
  rotas,
);

const destino = resolve(process.cwd(), "openapi.json");
writeFileSync(destino, `${JSON.stringify(documento, null, 2)}\n`, "utf8");
process.stdout.write(`openapi.json escrito em ${destino}\n`);
