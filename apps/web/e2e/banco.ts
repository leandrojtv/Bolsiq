import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

/**
 * Consulta ao Postgres do compose, para o e2e conferir a tela contra o banco.
 * Pelo `docker compose exec`: o banco do compose nao publica porta no host.
 */
export function consultar(sql: string): string[][] {
  const compose = resolve(import.meta.dirname, "../../../infra/docker/compose.ci.yml");
  const saida = execFileSync(
    "docker",
    [
      "compose",
      "-f",
      compose,
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      "bolsiq",
      "-d",
      "bolsiq",
      "-tA",
      "-F",
      "|",
      "-c",
      sql,
    ],
    { encoding: "utf8" },
  );
  return saida
    .trim()
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => l.split("|"));
}
