import { describe, expect, it } from "vitest";
import {
  AssetSearchQuery,
  CnpjParam,
  HistoryQuery,
  MacroParams,
  ResponseMeta,
  TickerParam,
  TriggerJobBody,
} from "./v1.js";

describe("parametros do /v1", () => {
  it("normaliza ticker para maiusculas", () => {
    expect(TickerParam.parse({ ticker: "petr4" })).toEqual({ ticker: "PETR4" });
    expect(TickerParam.safeParse({ ticker: "pe" }).success).toBe(false);
  });

  it("historico usa 1d ajustado por padrao", () => {
    expect(HistoryQuery.parse({})).toEqual({ interval: "1d", adjusted: true });
  });

  it("adjusted=false desliga o ajuste", () => {
    // z.coerce.boolean trataria "false" como true; por isso o enum.
    expect(HistoryQuery.parse({ adjusted: "false" }).adjusted).toBe(false);
    expect(HistoryQuery.safeParse({ adjusted: "nao" }).success).toBe(false);
  });

  it("rejeita intervalo e data invalidos", () => {
    expect(HistoryQuery.safeParse({ interval: "5m" }).success).toBe(false);
    expect(HistoryQuery.safeParse({ from: "2024-02-31" }).success).toBe(false);
  });

  it("busca exige termo", () => {
    expect(AssetSearchQuery.safeParse({ q: "  " }).success).toBe(false);
    expect(AssetSearchQuery.parse({ q: "petro", type: "stock" })).toEqual({
      q: "petro",
      type: "stock",
    });
  });

  it("serie macro aceita maiusculas", () => {
    expect(MacroParams.parse({ serie: "CDI" })).toEqual({ serie: "cdi" });
    expect(MacroParams.safeParse({ serie: "dolar" }).success).toBe(false);
  });

  it("corpo do disparo de job e opcional", () => {
    expect(TriggerJobBody.parse(undefined)).toEqual({});
    expect(TriggerJobBody.parse({ data: { ano: 2024 } })).toEqual({
      data: { ano: 2024 },
    });
  });

  it("meta exige atraso inteiro nao negativo", () => {
    const meta = {
      source: "brapi",
      fetched_at: "2026-11-02T19:00:00Z",
      license: "x",
      stale: false,
      delay_minutes: 15,
    };
    expect(ResponseMeta.parse(meta)).toEqual(meta);
    expect(ResponseMeta.safeParse({ ...meta, delay_minutes: -1 }).success).toBe(false);
  });

  it("CNPJ de fundo com ou sem pontuacao", () => {
    expect(CnpjParam.parse({ cnpj: "00.017.024/0001-53" })).toEqual({
      cnpj: "00017024000153",
    });
    expect(CnpjParam.safeParse({ cnpj: "123" }).success).toBe(false);
  });
});
