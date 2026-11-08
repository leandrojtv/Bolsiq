import { describe, expect, it } from "vitest";
import { capacidadesDoModelo, modelosParaImportar } from "../catalogo.js";

describe("capacidades por modelo", () => {
  it("vem de modelos.json; fora da lista nao importa", () => {
    expect(capacidadesDoModelo("anthropic", "claude-sonnet-5-5")).toMatchObject({
      saida_estruturada: true,
      visao: true,
    });
    expect(capacidadesDoModelo("deepseek", "deepseek-flash")).toMatchObject({
      saida_estruturada: true,
      visao: false,
      max_saida: 8000,
    });
    expect(
      capacidadesDoModelo("ollama", "deepseek-coder-v2:latest").saida_estruturada,
    ).toBe(false);
    expect(capacidadesDoModelo("openai", "desconhecido")).toEqual({
      saida_estruturada: false,
      visao: false,
      max_saida: 8000,
      homologado_para_importar: false,
    });
  });

  it("lista so os modelos do provedor com saida estruturada", () => {
    expect(modelosParaImportar("deepseek").map((m) => m.modelo)).toEqual([
      "deepseek-flash",
      "deepseek-v4-pro",
    ]);
    expect(modelosParaImportar("ollama")).toEqual([]);
  });
});
