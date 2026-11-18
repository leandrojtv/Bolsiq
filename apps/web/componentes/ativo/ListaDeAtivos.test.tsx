import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { TopoMobile } from "./Cabecalho";
import { ListaDeAtivos } from "./ListaDeAtivos";

const comQuery = (ui: React.ReactNode) =>
  render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

beforeEach(() => localStorage.clear());

describe("navegacao de ativos no celular", () => {
  it("voltar leva a /ativo, onde fica a busca, e nao a outro ativo", () => {
    comQuery(<TopoMobile ticker="VALE3" />);
    expect(screen.getByRole("link", { name: "Voltar" }).getAttribute("href")).toBe(
      "/ativo",
    );
  });

  it("lista a watchlist com link para cada ativo", () => {
    comQuery(<ListaDeAtivos />);
    // A watchlist guarda cache no modulo; o evento invalida, como em outra aba.
    act(() => {
      localStorage.setItem("bolsiq:watchlist", JSON.stringify(["WEGE3", "BBAS3"]));
      window.dispatchEvent(new Event("bolsiq:watchlist"));
    });
    expect(screen.getByRole("link", { name: "WEGE3" }).getAttribute("href")).toBe(
      "/ativo/WEGE3",
    );
    expect(screen.getByRole("link", { name: "BBAS3" }).getAttribute("href")).toBe(
      "/ativo/BBAS3",
    );
  });
});
