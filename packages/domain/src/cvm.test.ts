import { describe, expect, it } from "vitest";
import { applyCvmScale, normalizeCnpj, parseCvmDate, pickLatestVersion } from "./cvm.js";

describe("parseCvmDate", () => {
  it("aceita ISO e formato brasileiro", () => {
    expect(parseCvmDate("2023-12-31")).toBe("2023-12-31");
    expect(parseCvmDate("31/12/2023")).toBe("2023-12-31");
    expect(parseCvmDate("  2023-12-31  ")).toBe("2023-12-31");
  });

  it("recusa formato desconhecido", () => {
    expect(() => parseCvmDate("31-12-2023")).toThrow();
    expect(() => parseCvmDate("")).toThrow();
  });
});

describe("applyCvmScale", () => {
  it("multiplica por mil quando a escala é MIL", () => {
    expect(applyCvmScale("1234", "MIL")).toBe("1234000");
    expect(applyCvmScale("1234", "mil")).toBe("1234000");
    expect(applyCvmScale("-500.5", "MIL")).toBe("-500500");
  });

  it("mantém o valor quando a escala é UNIDADE", () => {
    expect(applyCvmScale("1234", "UNIDADE")).toBe("1234");
    expect(applyCvmScale("1234.00", " unidade ")).toBe("1234");
  });

  it("falha alto em escala desconhecida, em vez de assumir UNIDADE", () => {
    // Assumir silenciosamente erraria a demonstração por mil.
    expect(() => applyCvmScale("1234", "MILHAO")).toThrow(/ESCALA_MOEDA/);
  });
});

describe("normalizeCnpj", () => {
  it("remove pontuação", () => {
    expect(normalizeCnpj("33.000.167/0001-01")).toBe("33000167000101");
    expect(normalizeCnpj("33000167000101")).toBe("33000167000101");
  });

  it("recusa tamanho errado", () => {
    expect(() => normalizeCnpj("330001670001")).toThrow(/14/);
  });
});

describe("pickLatestVersion", () => {
  const base = {
    cvmCode: "9512",
    referenceDate: "2023-12-31",
    accountCode: "3.01",
    isConsolidated: true,
  };

  it("descarta PENÚLTIMO", () => {
    const linhas = [
      { ...base, version: 1, ordemExerc: "ÚLTIMO" },
      { ...base, version: 1, ordemExerc: "PENÚLTIMO" },
    ];
    expect(pickLatestVersion(linhas)).toEqual([
      { ...base, version: 1, ordemExerc: "ÚLTIMO" },
    ]);
  });

  it("mantém só a maior versão de cada conta", () => {
    const linhas = [
      { ...base, version: 1, ordemExerc: "ÚLTIMO" },
      { ...base, version: 3, ordemExerc: "ÚLTIMO" },
      { ...base, version: 2, ordemExerc: "ÚLTIMO" },
    ];
    const resultado = pickLatestVersion(linhas);
    expect(resultado).toHaveLength(1);
    expect(resultado[0]?.version).toBe(3);
  });

  it("trata individual e consolidado como contas distintas", () => {
    const linhas = [
      { ...base, isConsolidated: true, version: 2, ordemExerc: "ÚLTIMO" },
      { ...base, isConsolidated: false, version: 1, ordemExerc: "ÚLTIMO" },
    ];
    expect(pickLatestVersion(linhas)).toHaveLength(2);
  });

  it("separa por empresa, data e conta", () => {
    const linhas = [
      { ...base, version: 1, ordemExerc: "ÚLTIMO" },
      { ...base, cvmCode: "1023", version: 1, ordemExerc: "ÚLTIMO" },
      { ...base, referenceDate: "2022-12-31", version: 1, ordemExerc: "ÚLTIMO" },
      { ...base, accountCode: "3.02", version: 1, ordemExerc: "ÚLTIMO" },
    ];
    expect(pickLatestVersion(linhas)).toHaveLength(4);
  });

  it("devolve vazio quando nada é ÚLTIMO", () => {
    expect(pickLatestVersion([{ ...base, version: 1, ordemExerc: "PENÚLTIMO" }])).toEqual(
      [],
    );
    expect(pickLatestVersion([])).toEqual([]);
  });
});
