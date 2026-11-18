import { describe, expect, it } from "vitest";
import { executarFixture, medir, modeloDeRoteiro, resumirMedidas } from "./executar.js";
import { FIXTURES } from "./fixtures.js";

/**
 * O eval no modo roteiro: as respostas gravadas passam pelo pipeline inteiro e
 * pelos validadores. Confere o harness e as fixtures; nao homologa modelo.
 */
describe("eval da importacao (roteiro)", () => {
  it.each(FIXTURES.map((f) => [f.id, f] as const))("%s", async (_, f) => {
    const m = medir(f, await executarFixture(f, modeloDeRoteiro(f.resposta)));
    expect(m.faltantes).toEqual([]);
    expect(m.inventados).toEqual([]);
    expect(m.campos_inventados).toEqual([]);
    expect(m.campos_certos).toBe(m.campos_total);
    expect(m.conciliacao_certa).toBe(true);
  });

  it("aprova o roteiro e reprova quem nao devolve nada", async () => {
    const medidas = await Promise.all(
      FIXTURES.map(async (f) =>
        medir(f, await executarFixture(f, modeloDeRoteiro(f.resposta))),
      ),
    );
    expect(resumirMedidas(medidas)).toMatchObject({
      aprovado: true,
      ativos_inventados: 0,
      campos_inventados: 0,
      linhas_faltantes: 0,
    });
    expect(resumirMedidas(medidas).prontas_ou_preenchidas).toBeGreaterThanOrEqual(0.95);
    expect(resumirMedidas(FIXTURES.map((f) => medir(f, null, "falhou"))).aprovado).toBe(
      false,
    );
  });

  it("reprova campo que a politica nunca preenche", async () => {
    const f = FIXTURES[0]!;
    const r = await executarFixture(f, modeloDeRoteiro(f.resposta));
    const [linha] = r.validacao.linhas.filter((l) => l.tipo === "posicao");
    linha!.preenchidos.push("saldo_bruto");
    const m = medir(f, r);
    expect(m.campos_inventados).toHaveLength(1);
    expect(resumirMedidas([m]).aprovado).toBe(false);
  });
});
