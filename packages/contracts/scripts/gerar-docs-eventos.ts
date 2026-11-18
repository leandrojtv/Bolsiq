/**
 * Gera docs/events.md a partir do catálogo de eventos.
 *
 * Documentação de evento escrita à mão envelhece em silêncio: o schema muda, o
 * markdown fica. Gerando daqui, o documento não pode discordar do código — e o
 * modo `--check` faz o CI reprovar se alguém mudar o schema sem regerar.
 *
 * Uso:
 *   tsx scripts/gerar-docs-eventos.ts            # escreve
 *   tsx scripts/gerar-docs-eventos.ts --check    # só confere
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  eventos,
  nomesDeEventos,
  STREAM_MARKETDATA,
  SUBJECT_MARKETDATA,
} from "../src/events/catalog.js";
import { streamDoc } from "./stream-doc.js";

interface PropriedadeJson {
  type?: string | string[];
  format?: string;
  enum?: unknown[];
  anyOf?: { type?: string }[];
  items?: { type?: string };
  pattern?: string;
}

function tipoLegivel(prop: PropriedadeJson): string {
  if (prop.enum) return prop.enum.map((v) => `\`${String(v)}\``).join(" \\| ");

  if (prop.anyOf) {
    const tipos = prop.anyOf.map((a) => a.type ?? "null").filter(Boolean);
    return tipos.join(" ou ");
  }

  if (prop.type === "array") {
    return `array de ${prop.items?.type ?? "?"}`;
  }

  if (prop.format === "date-time") return "string (ISO 8601)";
  if (prop.pattern === "^\\d{4}-\\d{2}-\\d{2}$") return "string (YYYY-MM-DD)";
  if (prop.pattern?.includes("\\d+(\\.\\d+)?")) return "string decimal";

  return Array.isArray(prop.type) ? prop.type.join(" ou ") : (prop.type ?? "?");
}

function tabelaDePayload(nome: string): string {
  const definicao = eventos[nome as keyof typeof eventos];
  const json = zodToJsonSchema(definicao.payload, { target: "openApi3" }) as {
    properties?: Record<string, PropriedadeJson>;
    required?: string[];
  };

  if (!json.properties) return "_Payload sem campos nomeados._\n";

  const obrigatorios = new Set(json.required ?? []);
  const linhas = Object.entries(json.properties).map(([campo, prop]) => {
    const obrigatorio = obrigatorios.has(campo) ? "sim" : "não";
    return `| \`${campo}\` | ${tipoLegivel(prop)} | ${obrigatorio} |`;
  });

  return ["| Campo | Tipo | Obrigatório |", "| --- | --- | --- |", ...linhas].join("\n");
}

function gerar(): string {
  const partes: string[] = [streamDoc(STREAM_MARKETDATA, SUBJECT_MARKETDATA)];

  partes.push("## Catálogo\n");
  partes.push("| Evento | Produtor | Consumidores |");
  partes.push("| --- | --- | --- |");
  for (const nome of nomesDeEventos) {
    const d = eventos[nome];
    partes.push(
      `| [\`${nome}\`](#${nome.replace(/\./g, "")}) | \`${d.producer}\` | ${d.consumers
        .map((c) => `\`${c}\``)
        .join(", ")} |`,
    );
  }
  partes.push("");

  for (const nome of nomesDeEventos) {
    const d = eventos[nome];
    partes.push(`## ${nome}\n`);
    partes.push(`${d.description}\n`);
    partes.push(`- **Subject:** \`${nome}\``);
    partes.push(`- **Produtor:** \`${d.producer}\``);
    partes.push(`- **Consumidores:** ${d.consumers.map((c) => `\`${c}\``).join(", ")}\n`);
    partes.push("### Payload\n");
    partes.push(`${tabelaDePayload(nome)}\n`);
    partes.push("### Exemplo\n");
    partes.push("```json");
    partes.push(
      JSON.stringify(
        {
          id: "0193a1f0-4f7c-7000-8000-000000000001",
          name: nome,
          occurred_at: "2026-10-31T21:05:00.000Z",
          producer: d.producer,
          payload: d.example,
        },
        null,
        2,
      ),
    );
    partes.push("```\n");
  }

  return `${partes.join("\n").trimEnd()}\n`;
}

const destino = resolve(import.meta.dirname, "../../../docs/events.md");
const conteudo = gerar();

if (process.argv.includes("--check")) {
  let atual = "";
  try {
    atual = readFileSync(destino, "utf8");
  } catch {
    process.stderr.write("docs/events.md não existe. Rode `make docs-events`.\n");
    process.exit(1);
  }

  if (atual !== conteudo) {
    process.stderr.write(
      "docs/events.md está desatualizado em relação aos schemas.\n" +
        "Rode `make docs-events` e commite o resultado.\n",
    );
    process.exit(1);
  }

  process.stdout.write("docs/events.md está em dia com os schemas.\n");
} else {
  writeFileSync(destino, conteudo, "utf8");
  process.stdout.write(`docs/events.md escrito (${conteudo.length} bytes)\n`);
}
