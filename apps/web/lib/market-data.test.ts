import { describe, expect, it } from "vitest";
import { validadeDe, VALIDADE } from "./market-data";

describe("lista do BFF", () => {
  it.each([
    ["assets", VALIDADE.assets],
    ["assets/PETR4", VALIDADE.assets],
    ["quotes/PETR4,VALE3", VALIDADE.quotes],
    ["history/PETR4", VALIDADE.history],
    ["dividends/PETR4", VALIDADE.dividends],
    ["fundamentals/PETR4", VALIDADE.fundamentals],
    ["macro/cdi", VALIDADE.macro],
    ["funds", VALIDADE.assets],
    ["funds/00017024000153/history", VALIDADE.history],
  ])("repassa %s", (caminho, validade) => {
    expect(validadeDe(caminho)).toBe(validade);
  });

  it.each([
    "admin/jobs",
    "health",
    "assets/PETR4/../admin",
    "quotes/",
    "stream",
    "history/PE",
  ])("recusa %s", (caminho) => {
    expect(validadeDe(caminho)).toBeNull();
  });
});

describe("chamada ao /v1", () => {
  it("manda a chave interna no header e devolve status e corpo", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    vi.stubEnv("MARKET_DATA_URL", "http://md:3001");
    vi.stubEnv("MARKET_DATA_API_KEY", "mdk_test_x");
    const chamadas: [string, RequestInit | undefined][] = [];
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      chamadas.push([url, init]);
      return Promise.resolve(Response.json({ data: 1 }, { status: 200 }));
    });
    const m = await import("./market-data");
    const r = await m.buscarV1<{ data: number }>("assets/PETR4", 60);
    expect(r).toEqual({ status: 200, corpo: { data: 1 } });
    expect(chamadas[0]?.[0]).toBe("http://md:3001/v1/assets/PETR4");
    expect(new Headers(chamadas[0]?.[1]?.headers).get("x-api-key")).toBe("mdk_test_x");
    expect(m.urlDoStream()).toBe("ws://md:3001/v1/stream");
    expect(m.chaveInterna()).toBe("mdk_test_x");
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
});
