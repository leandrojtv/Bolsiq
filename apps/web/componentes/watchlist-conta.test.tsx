import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./conta/Conta", () => ({ useConta: () => ({ uid: "u1", nome: "Ana" }) }));
const { useWatchlist } = await import("./watchlist");

afterEach(() => vi.unstubAllGlobals());

describe("useWatchlist com conta", () => {
  it("le e grava no servidor, nao no localStorage", async () => {
    const chamadas: { metodo: string; corpo: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        const corpo = init?.body
          ? (JSON.parse(init.body as string) as { tickers: string[] })
          : null;
        chamadas.push({ metodo: init?.method ?? "GET", corpo });
        return Promise.resolve(
          new Response(JSON.stringify({ data: corpo ? corpo.tickers : ["BBAS3"] })),
        );
      }),
    );
    const { result } = renderHook(() => useWatchlist(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
      ),
    });
    await waitFor(() => expect(result.current.lista).toEqual(["BBAS3"]));
    act(() => result.current.alternar("WEGE3"));
    await waitFor(() => expect(result.current.contem("WEGE3")).toBe(true));
    act(() => result.current.alternar("BBAS3"));
    await waitFor(() => expect(result.current.lista).toEqual(["WEGE3"]));
    expect(chamadas.filter((c) => c.metodo === "PUT").map((c) => c.corpo)).toEqual([
      { tickers: ["BBAS3", "WEGE3"] },
      { tickers: ["WEGE3"] },
    ]);
    expect(localStorage.getItem("bolsiq:watchlist")).toBeNull();
  });
});
