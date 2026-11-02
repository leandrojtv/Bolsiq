import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useWatchlist } from "./watchlist";

beforeEach(() => localStorage.clear());

describe("useWatchlist", () => {
  it("comeca com a lista padrao e alterna", () => {
    const { result } = renderHook(() => useWatchlist());
    expect(result.current.lista).toEqual(["PETR4", "VALE3", "ITUB4"]);
    act(() => result.current.alternar("WEGE3"));
    expect(result.current.contem("WEGE3")).toBe(true);
    act(() => result.current.alternar("PETR4"));
    expect(result.current.lista).toEqual(["VALE3", "ITUB4", "WEGE3"]);
    expect(JSON.parse(localStorage.getItem("bolsiq:watchlist") ?? "[]")).toEqual([
      "VALE3",
      "ITUB4",
      "WEGE3",
    ]);
  });

  it("ignora conteudo invalido no storage", () => {
    const { result } = renderHook(() => useWatchlist());
    act(() => {
      localStorage.setItem("bolsiq:watchlist", "{nao e json");
      window.dispatchEvent(new Event("bolsiq:watchlist"));
    });
    expect(result.current.lista).toEqual(["PETR4", "VALE3", "ITUB4"]);
    // Outra aba mudou a lista: o evento storage atualiza esta.
    act(() => {
      localStorage.setItem("bolsiq:watchlist", JSON.stringify(["BBAS3"]));
      window.dispatchEvent(new Event("storage"));
    });
    expect(result.current.lista).toEqual(["BBAS3"]);
  });
});
