import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/db/schema.ts"],
  out: "./migrations",
  schemaFilter: ["portfolio"],
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://bolsiq:bolsiq@localhost:5432/bolsiq",
  },
  strict: true,
  verbose: true,
});
