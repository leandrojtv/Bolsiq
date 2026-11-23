import { describe, expect, it } from "vitest";
import { modeloDeRoteiro } from "./executar.js";
import {
  executarFixtureDeFinancas,
  medirFinancas,
  resumirFinancas,
} from "./executar-financas.js";
import { FIXTURES_DE_FINANCAS } from "./fixtures-financas.js";

/**
 * Eval da leitura de faturas e extratos no modo roteiro (ADR 0040): o atalho
 * dos layouts conhecidos e as respostas gravadas passam pelo pipeline e pela
 * validacao. Confere o harness e as fixtures; nao homologa modelo.
 */
describe("eval da leitura de faturas (roteiro)", () => {
  it("tem fixtures de pelo menos 4 bancos", () => {
    expect(new Set(FIXTURES_DE_FINANCAS.map((f) => f.banco)).size).toBeGreaterThanOrEqual(
      4,
    );
  });

  it.each(FIXTURES_DE_FINANCAS.map((f) => [f.id, f] as const))(
    "%s pela IA",
    async (_, f) => {
      const m = medirFinancas(
        f,
        await executarFixtureDeFinancas(f, modeloDeRoteiro(f.resposta), {
          sem_atalho: true,
        }),
      );
      expect(m).toMatchObject({
        atalho: false,
        faltantes: [],
        inventadas: [],
        total_conferido: true,
      });
      expect(m.parcelas_certas).toBe(m.parcelas_esperadas);
      expect(m.marcacoes_certas).toBe(m.marcacoes_esperadas);
    },
  );

  it.each(FIXTURES_DE_FINANCAS.filter((f) => f.layout).map((f) => [f.id, f] as const))(
    "%s pelo layout conhecido, sem chamar o modelo",
    async (_, f) => {
      const modelo = modeloDeRoteiro(f.resposta);
      const r = await executarFixtureDeFinancas(f, modelo);
      const m = medirFinancas(f, r);
      expect(modelo.doGenerateCalls).toHaveLength(0);
      expect(r).toMatchObject({
        atalho: true,
        provedor: "atalho",
        custo_estimado: "0.000000",
      });
      expect(m).toMatchObject({ faltantes: [], inventadas: [], total_conferido: true });
      expect(m.parcelas_certas).toBe(m.parcelas_esperadas);
      expect(m.marcacoes_certas).toBe(m.marcacoes_esperadas);
      expect(r.validacao.documento.data_vencimento).toBe(
        f.resposta.documento.financas?.data_vencimento,
      );
    },
  );

  it("aprova o roteiro e reprova quem nao devolve nada", async () => {
    const medidas = await Promise.all(
      FIXTURES_DE_FINANCAS.map(async (f) =>
        medirFinancas(
          f,
          await executarFixtureDeFinancas(f, modeloDeRoteiro(f.resposta), {
            sem_atalho: true,
          }),
        ),
      ),
    );
    expect(resumirFinancas(medidas)).toMatchObject({
      aprovado: true,
      linhas_extraidas: 1,
      total_conferido: 1,
      acerto_de_parcela: 1,
      linhas_inventadas: 0,
    });
    expect(
      resumirFinancas(FIXTURES_DE_FINANCAS.map((f) => medirFinancas(f, null, "falhou")))
        .aprovado,
    ).toBe(false);
  });
});
