import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  // Arquivo listado um a um, nao o index: o drizzle-kit carrega o schema em
  // CJS e nao resolve o sufixo `.js` que o NodeNext exige.
  schema: ["./src/db/schema.ts"],
  out: "./migrations",
  schemaFilter: ["analytics"],
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://bolsiq:bolsiq@localhost:5432/bolsiq",
  },
  strict: true,
  verbose: true,
});
