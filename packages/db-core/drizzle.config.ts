import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  // Arquivos listados um a um, e não o index: o index reexporta com sufixo
  // `.js`, que o drizzle-kit não resolve ao carregar em CJS.
  schema: ["./src/schema/market.ts", "./src/schema/api.ts", "./src/schema/events.ts"],
  out: "./migrations",
  schemaFilter: ["market_data"],
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://bolsiq:bolsiq@localhost:5432/bolsiq",
  },
  strict: true,
  verbose: true,
});
