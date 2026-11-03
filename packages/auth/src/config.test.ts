import { describe, expect, it } from "vitest";
import { criarAuth, criarPoolDeAuth } from "./config.js";

const opcoes = (google = false) => ({
  pool: criarPoolDeAuth("postgres://x:y@127.0.0.1:1/z"),
  baseURL: "http://localhost:3000",
  secret: "s".repeat(40),
  enviarVerificacao: async () => {},
  enviarRecuperacao: async () => {},
  limiteDeLogin: 7,
  ...(google ? { google: { clientId: "id", clientSecret: "segredo" } } : {}),
});

describe("criarAuth", () => {
  it("pool aponta para o schema app", () => {
    const pool = criarPoolDeAuth("postgres://x:y@127.0.0.1:1/z");
    expect((pool as unknown as { options: { options: string } }).options.options).toBe(
      "-c search_path=app",
    );
  });

  it("e-mail verificado obrigatorio, 2FA e limite de tentativas", () => {
    const o = criarAuth(opcoes()).options;
    expect(o.emailAndPassword?.requireEmailVerification).toBe(true);
    expect(o.emailAndPassword?.minPasswordLength).toBe(10);
    expect(o.plugins?.map((p) => p.id)).toContain("two-factor");
    expect(o.rateLimit?.customRules?.["/sign-in/email"]).toEqual({ window: 60, max: 7 });
    expect(o.socialProviders).toBeUndefined();
  });

  it("Google so com credenciais", () => {
    expect(criarAuth(opcoes(true)).options.socialProviders?.google?.clientId).toBe("id");
  });
});
