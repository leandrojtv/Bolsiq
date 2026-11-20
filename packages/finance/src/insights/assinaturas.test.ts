import { describe, expect, it } from "vitest";
import { detectarAssinaturas, insightsDeAssinaturas, servicoDe } from "./assinaturas.js";
import { contexto, lanc, serie } from "./fabrica.js";

const MENSAL = ["2026-08-05", "2026-09-05", "2026-10-05", "2026-11-05"];

describe("detectarAssinaturas", () => {
  it("detecta a mensal com valor fixo e intervalo de 28 a 35 dias", () => {
    const ls = serie("Netflix.com", "39.90", MENSAL);
    const [a, ...resto] = detectarAssinaturas(contexto(ls));
    expect(resto).toEqual([]);
    expect(a).toMatchObject({
      chave: "NETFLIX COM",
      frequencia: "mensal",
      valor_atual: "39.90",
      valor_mensal: "39.90",
      valor_anual: "478.80",
      ocorrencias: 4,
      primeira: "2026-08-05",
      ultima: "2026-11-05",
      proxima: "2026-12-05",
      reajuste: null,
      nova: false,
      grupo: "streaming de vídeo",
    });
    expect(a?.evidencias).toEqual(ls.map((l) => l.id));
  });

  it("conta de luz com valor variavel nao e assinatura", () => {
    const ls = [
      lanc({ descricao: "ENEL ENERGIA", valor: "187.40", data: "2026-08-10" }),
      lanc({ descricao: "ENEL ENERGIA", valor: "243.10", data: "2026-09-10" }),
      lanc({ descricao: "ENEL ENERGIA", valor: "162.80", data: "2026-10-10" }),
      lanc({ descricao: "ENEL ENERGIA", valor: "210.55", data: "2026-11-10" }),
    ];
    expect(detectarAssinaturas(contexto(ls))).toEqual([]);
  });

  it("dois cafes no mesmo dia, todo dia, nao sao assinatura nem duplicidade", () => {
    const ls = [
      ...serie("Cafe da Esquina", "8.00", ["2026-11-03", "2026-11-03"]),
      ...serie("Cafe da Esquina", "8.00", ["2026-10-03", "2026-09-03", "2026-08-03"]),
    ];
    expect(detectarAssinaturas(contexto(ls))).toEqual([]);
  });

  it("reajuste: ultimo valor acima da media anterior", () => {
    const ls = [
      ...serie("Spotify", "21.90", MENSAL.slice(0, 3)),
      lanc({ descricao: "Spotify", valor: "23.90", data: MENSAL[3]! }),
    ];
    const [a] = detectarAssinaturas(contexto(ls));
    expect(a?.reajuste).toEqual({ de: "21.90", para: "23.90", percentual: 9.1 });
  });

  it("aceita um degrau de reajuste maior que 10%; o segundo corta a cadeia", () => {
    const um = [
      ...serie("Max", "29.90", MENSAL.slice(0, 2)),
      ...serie("Max", "34.90", MENSAL.slice(2)),
    ];
    expect(detectarAssinaturas(contexto(um))[0]?.ocorrencias).toBe(4);
    const dois = [
      lanc({ descricao: "Max", valor: "20.00", data: MENSAL[0]! }),
      lanc({ descricao: "Max", valor: "25.00", data: MENSAL[1]! }),
      lanc({ descricao: "Max", valor: "31.00", data: MENSAL[2]! }),
      lanc({ descricao: "Max", valor: "31.00", data: MENSAL[3]! }),
    ];
    // O primeiro degrau fica fora: a cadeia comeca depois dele.
    expect(detectarAssinaturas(contexto(dois))[0]).toMatchObject({
      ocorrencias: 3,
      primeira: MENSAL[1],
      reajuste: { de: "28.00", para: "31.00" },
    });
  });

  it("anual: 2 cobrancas entre 360 e 370 dias", () => {
    const ls = serie("Amazon Prime", "166.80", ["2025-11-12", "2026-11-12"]);
    const [a] = detectarAssinaturas(contexto(ls));
    expect(a).toMatchObject({
      frequencia: "anual",
      valor_mensal: "13.90",
      valor_anual: "166.80",
      proxima: "2027-11-12",
    });
  });

  it("menos de 3 mensais, intervalo fora da faixa ou parada ha muito tempo nao entram", () => {
    expect(
      detectarAssinaturas(contexto(serie("Deezer", "19.90", MENSAL.slice(2)))),
    ).toEqual([]);
    const fora = serie("Deezer", "19.90", [
      "2026-06-01",
      "2026-07-11",
      "2026-08-20",
      "2026-09-29",
    ]);
    expect(detectarAssinaturas(contexto(fora))).toEqual([]);
    const parada = serie("Deezer", "19.90", ["2026-05-05", "2026-06-05", "2026-07-05"]);
    expect(detectarAssinaturas(contexto(parada))).toEqual([]);
  });

  it("parcela, tarifa, gasto essencial e previsto ficam de fora", () => {
    const ls = [
      ...serie("Loja Parcelada", "100.00", MENSAL, { parcelado: true }),
      ...serie("Anuidade Cartao", "35.00", MENSAL),
      ...serie("Aluguel", "1900.00", MENSAL, { category_id: "Moradia" }),
      ...serie("Academia", "99.00", MENSAL, { status: "previsto" }),
    ];
    expect(detectarAssinaturas(contexto(ls))).toEqual([]);
  });

  it("duplicidade: duas no mesmo servico ou na mesma categoria nao generica", () => {
    const ls = [
      ...serie("Netflix", "39.90", MENSAL),
      ...serie("Disney Plus", "33.90", MENSAL),
      ...serie("Spotify", "21.90", MENSAL),
      ...serie("Smart Fit", "119.90", MENSAL, { category_id: "Lazer" }),
      ...serie("Bodytech", "149.90", MENSAL, { category_id: "Lazer" }),
      ...serie("Jornal", "9.90", MENSAL, { category_id: "Assinaturas" }),
      ...serie("Revista", "12.90", MENSAL, { category_id: "Assinaturas" }),
    ];
    const as = detectarAssinaturas(contexto(ls));
    const por = (nome: string) => as.find((a) => a.nome === nome)!;
    expect(por("Netflix").duplicidade).toEqual([por("Disney Plus").id]);
    expect(por("Smart Fit").grupo).toBe("Lazer");
    expect(por("Smart Fit").duplicidade).toEqual([por("Bodytech").id]);
    expect(por("Spotify").duplicidade).toEqual([]);
    expect(por("Jornal").grupo).toBeNull();
    expect(por("Jornal").duplicidade).toEqual([]);
    // Maior valor anual primeiro.
    expect(as[0]?.nome).toBe("Bodytech");
  });

  it("nova: atingiu o minimo de cobrancas ha ate 60 dias, sem historico antes", () => {
    const nova = serie("Globoplay", "24.90", ["2026-09-10", "2026-10-08", "2026-11-05"]);
    expect(detectarAssinaturas(contexto(nova))[0]?.nova).toBe(true);
    const comAvulsa = [
      lanc({ descricao: "Globoplay", valor: "5.00", data: "2026-07-01" }),
      ...nova,
    ];
    expect(detectarAssinaturas(contexto(comAvulsa))[0]?.nova).toBe(false);
    expect(
      detectarAssinaturas(contexto(serie("Globoplay", "24.90", MENSAL)))[0]?.nova,
    ).toBe(false);
  });
});

describe("insightsDeAssinaturas", () => {
  it("severidade e texto pelos sinais", () => {
    const ls = [
      ...serie("Netflix", "39.90", MENSAL),
      ...serie("Disney Plus", "33.90", MENSAL),
      ...serie("Spotify", "21.90", MENSAL.slice(0, 3)),
      lanc({ descricao: "Spotify", valor: "23.90", data: MENSAL[3]! }),
      ...serie("Globoplay", "24.90", ["2026-09-10", "2026-10-08", "2026-11-05"]),
      ...serie("Antivirus", "99.00", ["2025-11-02", "2026-11-02"]),
      ...serie("Jornal", "9.90", MENSAL),
    ];
    const ctx = contexto(ls);
    const is = insightsDeAssinaturas(detectarAssinaturas(ctx), ctx);
    const por = (nome: string) => is.find((i) => i.titulo === `Assinatura: ${nome}`)!;
    expect(por("Netflix").severidade).toBe("alta");
    expect(por("Netflix").descricao).toContain(
      "Possível duplicidade: você também assina Disney Plus",
    );
    expect(por("Spotify").severidade).toBe("media");
    expect(por("Spotify").descricao).toContain("Subiu de R$ 21,90 para R$ 23,90");
    expect(por("Globoplay").descricao).toContain("Nova: detectada nos últimos 60 dias.");
    expect(por("Antivirus").descricao).toContain("Cobrança anual de R$ 99,00");
    expect(por("Jornal")).toMatchObject({
      severidade: "baixa",
      impacto_mensal: "9.90",
      impacto_anual: "118.80",
      acao_sugerida: "Confirme se ainda usa. Cancelar economiza R$ 118,80 por ano.",
    });
  });
});

describe("servicoDe", () => {
  it("agrupa servicos conhecidos pelo nome", () => {
    expect(servicoDe("NETFLIX COM")).toBe("streaming de vídeo");
    expect(servicoDe("SPOTIFY P1234")).toBe("música");
    expect(servicoDe("APPLE COM BILL ICLOUD")).toBe("armazenamento na nuvem");
    expect(servicoDe("STARBUCKS")).toBeNull();
  });
});
