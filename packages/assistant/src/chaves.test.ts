import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  cifrarChave,
  decifrarChave,
  finalDaChave,
  lerChaveMestra,
  mensagemSegura,
  removerSegredos,
} from "./chaves.js";

const mestra = randomBytes(32);
const CHAVE = "sk-teste-abcdefghijklmnop-1234";

describe("cifragem da chave", () => {
  it("ida e volta, com texto cifrado diferente a cada vez", () => {
    const a = cifrarChave(CHAVE, mestra, "u1");
    expect(a).not.toContain(CHAVE);
    expect(a).not.toBe(cifrarChave(CHAVE, mestra, "u1"));
    expect(decifrarChave(a, mestra, "u1")).toBe(CHAVE);
  });

  it("linha copiada para outro usuario nao decifra", () => {
    expect(() => decifrarChave(cifrarChave(CHAVE, mestra, "u1"), mestra, "u2")).toThrow();
  });

  it("outra chave-mestra e texto adulterado nao decifram", () => {
    const c = cifrarChave(CHAVE, mestra, "u1");
    expect(() => decifrarChave(c, randomBytes(32), "u1")).toThrow();
    const partes = c.split(".");
    partes[3] = Buffer.from("adulterado").toString("base64");
    expect(() => decifrarChave(partes.join("."), mestra, "u1")).toThrow();
    expect(() => decifrarChave("v0.a.b.c", mestra, "u1")).toThrow(/formato/);
  });

  it("chave-mestra precisa de 32 bytes, e o erro nao mostra o valor", () => {
    expect(lerChaveMestra(mestra.toString("base64"))).toHaveLength(32);
    expect(() => lerChaveMestra(undefined)).toThrow(/32 bytes/);
    expect(() => lerChaveMestra("c2VncmVkby1jdXJ0bw==")).toThrow(/^(?!.*c2VncmVkby).*$/);
  });

  it("so os 4 ultimos saem", () => {
    expect(finalDaChave(CHAVE)).toBe("1234");
  });
});

describe("remocao de segredos", () => {
  it("tira a chave informada e os formatos conhecidos", () => {
    const t = removerSegredos(
      `minha-chave-opaca sk-ant-api03-abcdefgh AIzaSyA1234567890abcdefgh Bearer abc.def.ghi-123 "x-api-key": "qualquer-coisa-longa"`,
      ["minha-chave-opaca"],
    );
    expect(t).not.toMatch(/minha-chave|sk-ant|AIza|abc\.def|qualquer-coisa/);
  });

  it("erro de provedor nao leva corpo nem cabecalho", () => {
    const erro = Object.assign(new Error(`Incorrect API key provided: ${CHAVE}`), {
      statusCode: 401,
      requestBodyValues: { messages: ["carteira"] },
      responseHeaders: { authorization: `Bearer ${CHAVE}` },
    });
    const m = mensagemSegura(erro, [CHAVE]);
    expect(m).toContain("HTTP 401");
    expect(m).not.toContain(CHAVE);
    expect(m).not.toContain("carteira");
    expect(mensagemSegura(null)).toBe("erro desconhecido");
  });
});
