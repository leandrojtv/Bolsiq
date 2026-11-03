import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import {
  AppShell,
  Button,
  Card,
  Change,
  CompactNumber,
  DataTable,
  EmptyState,
  ErrorState,
  Money,
  navegacaoPadrao,
  ordenar,
  Percent,
  Price,
  RangeInput,
  Select,
  Sheet,
  SegmentedControl,
  Skeleton,
  SourceLine,
  StaleBadge,
  StatTile,
  Switch,
  Tabs,
  ToggleChip,
  type Column,
} from "../index.js";

describe("numeros", () => {
  it("usam fonte mono e tabular-nums", () => {
    render(<Price value="37.42" data-testid="p" />);
    expect(screen.getByTestId("p").textContent).toBe("R$ 37,42");
    expect(screen.getByTestId("p").className).toMatch(/font-mono/);
    expect(screen.getByTestId("p").className).toMatch(/tabular-nums/);
  });

  it("Change tem seta, sinal e cor, e rotulo falado", () => {
    render(
      <>
        <Change value="0.86" percent="0.0235" data-testid="a" />
        <Change value="-0.31" percent="-0.0082" data-testid="q" />
        <Change percent="0" data-testid="e" />
      </>,
    );
    const visivel = (id: string) =>
      [...screen.getByTestId(id).querySelectorAll("[aria-hidden='true']")]
        .map((e) => e.textContent)
        .join("");
    expect(visivel("a")).toBe("▲+0,86 (+2,35%)");
    expect(screen.getByTestId("a").className).toMatch(/text-up/);
    expect(screen.getByText("alta de 0,86 (+2,35%)").className).toBe("sr-only");
    expect(visivel("q")).toBe("▼-0,31 (-0,82%)");
    expect(screen.getByTestId("q").className).toMatch(/text-down/);
    expect(visivel("e")).toBe("◆0,00%");
  });

  it("Percent, CompactNumber e Money", () => {
    render(
      <>
        <Percent value="-0.0082" sign colored data-testid="pc" />
        <CompactNumber value={48_200_000} prefix="R$ " data-testid="c" />
        <Money value="1234.5" data-testid="m" />
        <Price value="37.4" currency={false} data-testid="p" />
      </>,
    );
    expect(screen.getByTestId("pc").textContent).toBe("-0,82%");
    expect(screen.getByTestId("pc").className).toMatch(/text-down/);
    expect(screen.getByTestId("c").textContent).toBe("R$ 48,2 mi");
    expect(screen.getByTestId("m").textContent).toBe("R$ 1.234,50");
    expect(screen.getByTestId("p").textContent).toBe("37,40");
  });
});

describe("proveniencia", () => {
  it("StaleBadge some sem atraso e prioriza stale", () => {
    const { container } = render(<StaleBadge delayMinutes={0} />);
    expect(container.textContent).toBe("");
    render(<StaleBadge delayMinutes={15} />);
    expect(screen.getByText("Atraso de 15 min")).toBeTruthy();
    render(<StaleBadge delayMinutes={15} stale />);
    expect(screen.getByText("Dado desatualizado")).toBeTruthy();
  });

  it("SourceLine com hora de Sao Paulo", () => {
    render(
      <SourceLine
        source="B3 via brapi"
        fetchedAt="2026-11-02T17:52:00Z"
        now={new Date("2026-11-02T18:00:00Z")}
      />,
    );
    expect(screen.getByText(/Fonte: B3 via brapi · atualizado/).textContent).toBe(
      "Fonte: B3 via brapi · atualizado 14:52",
    );
  });
});

describe("superficies e estados", () => {
  it("Card com titulo e acao, StatTile com subtitulo", () => {
    render(
      <Card title="Indicadores" action={<Button>Limpar</Button>}>
        <StatTile label="ROE" value="10,07%" subtitle="DFP 2024" />
      </Card>,
    );
    expect(screen.getByRole("heading", { name: "Indicadores" })).toBeTruthy();
    expect(screen.getByText("DFP 2024")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Limpar" }).getAttribute("type")).toBe(
      "button",
    );
  });

  it("Button asChild usa o filho", () => {
    render(
      <Button asChild variant="primary">
        <a href="/alertas">Criar alerta</a>
      </Button>,
    );
    expect(screen.getByRole("link", { name: "Criar alerta" }).className).toMatch(
      /bg-accent/,
    );
  });

  it("ErrorState anuncia com role=alert e oferece nova tentativa", () => {
    const tentar = vi.fn();
    render(<ErrorState correlationId="abc" description="Fonte fora" onRetry={tentar} />);
    expect(screen.getByRole("alert").textContent).toContain("Não foi possível carregar");
    expect(screen.getByText("Código: abc")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(tentar).toHaveBeenCalledOnce();
  });

  it("EmptyState e Skeleton", () => {
    const { container } = render(
      <>
        <EmptyState
          title="Nada aqui"
          description="d"
          action={<button>a</button>}
          icon={<span>i</span>}
        />
        <Skeleton className="h-4" />
      </>,
    );
    expect(screen.getByText("Nada aqui")).toBeTruthy();
    expect(container.querySelector("[aria-hidden='true'].animate-pulse")).toBeTruthy();
  });
});

describe("controles", () => {
  it("SegmentedControl marca a opcao com aria-pressed", () => {
    function Teste() {
      const [v, setV] = useState("6M");
      return (
        <SegmentedControl
          label="Período"
          value={v}
          onChange={setV}
          options={["1M", "6M", "1A"].map((p) => ({ value: p, label: p }))}
        />
      );
    }
    render(<Teste />);
    const grupo = screen.getByRole("group", { name: "Período" });
    expect(
      within(grupo).getByRole("button", { name: "6M" }).getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(within(grupo).getByRole("button", { name: "1A" }));
    expect(
      within(grupo).getByRole("button", { name: "1A" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      within(grupo).getByRole("button", { name: "6M" }).getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("ToggleChip com icone proprio", () => {
    render(
      <ToggleChip
        pressed
        onPressedChange={() => undefined}
        icon={<svg data-testid="icone" />}
      >
        CDI
      </ToggleChip>,
    );
    expect(screen.getByTestId("icone")).toBeTruthy();
  });

  it("ToggleChip alterna aria-pressed", () => {
    const mudar = vi.fn();
    render(
      <ToggleChip pressed={false} onPressedChange={mudar} swatch="series-2">
        MM 50
      </ToggleChip>,
    );
    const chip = screen.getByRole("button", { name: "MM 50" });
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(chip);
    expect(mudar).toHaveBeenCalledWith(true);
  });

  it("Switch tem role=switch e rotulo", () => {
    const mudar = vi.fn();
    render(
      <Switch checked={false} onCheckedChange={mudar} label="Ajustado por proventos" />,
    );
    const s = screen.getByRole("switch", { name: "Ajustado por proventos" });
    expect(s.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(s);
    expect(mudar).toHaveBeenCalledWith(true);
  });

  it("RangeInput edita minimo e maximo e remove", () => {
    const mudar = vi.fn();
    const remover = vi.fn();
    render(
      <RangeInput
        label="P/L"
        min="0"
        max="15"
        onChange={mudar}
        onRemove={remover}
        removeLabel="Remover filtro P/L"
      />,
    );
    fireEvent.change(screen.getByLabelText("máx"), { target: { value: "20" } });
    expect(mudar).toHaveBeenCalledWith({ min: "0", max: "20" });
    fireEvent.change(screen.getByLabelText("mín"), { target: { value: "5" } });
    expect(mudar).toHaveBeenCalledWith({ min: "5", max: "15" });
    fireEvent.click(screen.getByRole("button", { name: "Remover filtro P/L" }));
    expect(remover).toHaveBeenCalledOnce();
  });

  it("Select mostra o valor e tem rotulo", () => {
    render(
      <Select
        label="Ordenar por"
        value="dy"
        onValueChange={() => undefined}
        options={[
          { value: "pl", label: "P/L" },
          { value: "dy", label: "Dividend yield" },
        ]}
      />,
    );
    const gatilho = screen.getByRole("combobox", { name: "Ordenar por" });
    expect(gatilho.textContent).toContain("Dividend yield");
  });

  it("Tabs com roles de aba", () => {
    render(
      <Tabs
        label="Detalhes"
        items={[
          { value: "a", label: "Proventos", content: "conteudo a" },
          { value: "b", label: "Sobre", content: "conteudo b" },
        ]}
      />,
    );
    expect(screen.getByRole("tablist", { name: "Detalhes" })).toBeTruthy();
    expect(
      screen.getByRole("tab", { name: "Proventos" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByRole("tabpanel").textContent).toBe("conteudo a");
  });
});

describe("DataTable", () => {
  interface L {
    t: string;
    pl: number | null;
  }
  const colunas: Column<L>[] = [
    { key: "t", header: "Ativo", cell: (l) => l.t, sortValue: (l) => l.t },
    {
      key: "pl",
      header: "P/L",
      numeric: true,
      cell: (l) => String(l.pl),
      sortValue: (l) => l.pl,
    },
    { key: "x", header: "Fixo", cell: () => "-" },
  ];
  const linhas: L[] = [
    { t: "B", pl: 10 },
    { t: "A", pl: null },
    { t: "C", pl: 5 },
  ];

  it("ordena com nulo sempre no fim", () => {
    expect(
      ordenar(linhas, colunas, { key: "pl", direction: "asc" }).map((l) => l.t),
    ).toEqual(["C", "B", "A"]);
    expect(
      ordenar(linhas, colunas, { key: "pl", direction: "desc" }).map((l) => l.t),
    ).toEqual(["B", "C", "A"]);
    expect(ordenar(linhas, colunas, { key: "x", direction: "asc" })).toBe(linhas);
    expect(ordenar(linhas, colunas, null)).toBe(linhas);
  });

  it("cabecalho ordena e informa aria-sort; primeira coluna fixa", () => {
    render(
      <DataTable caption="Teste" columns={colunas} rows={linhas} rowKey={(l) => l.t} />,
    );
    const th = screen.getByRole("columnheader", { name: /P\/L/ });
    expect(th.getAttribute("aria-sort")).toBeNull();
    fireEvent.click(within(th).getByRole("button"));
    expect(th.getAttribute("aria-sort")).toBe("descending");
    fireEvent.click(within(th).getByRole("button"));
    expect(th.getAttribute("aria-sort")).toBe("ascending");
    expect(screen.getAllByRole("cell")[0]?.className).toMatch(/sticky/);
  });

  it("ordenacao controlada nao reordena e avisa o clique", () => {
    const mudar = vi.fn();
    render(
      <DataTable
        caption="Controlada"
        columns={colunas}
        rows={linhas}
        rowKey={(l) => l.t}
        sort={{ key: "pl", direction: "asc" }}
        onSortChange={mudar}
      />,
    );
    expect(
      screen
        .getAllByRole("row")
        .slice(1)
        .map((r) => r.firstChild?.textContent),
    ).toEqual(["B", "A", "C"]);
    fireEvent.click(
      within(screen.getByRole("columnheader", { name: /P\/L/ })).getByRole("button"),
    );
    expect(mudar).toHaveBeenCalledWith({ key: "pl", direction: "desc" });
    fireEvent.click(
      within(screen.getByRole("columnheader", { name: /Ativo/ })).getByRole("button"),
    );
    expect(mudar).toHaveBeenCalledWith({ key: "t", direction: "desc" });
  });

  it("vazia mostra a mensagem", () => {
    render(
      <DataTable
        caption="Vazia"
        columns={colunas}
        rows={[]}
        rowKey={(l) => l.t}
        empty="Sem ativos"
      />,
    );
    expect(screen.getByText("Sem ativos")).toBeTruthy();
  });
});

describe("AppShell", () => {
  it("menu, watchlist, contador e Ctrl+K na busca", () => {
    const buscar = vi.fn();
    render(
      <AppShell
        nav={navegacaoPadrao("/screener")}
        watchlist={[
          { ticker: "PETR4", href: "#p", changePercent: 0.0235 },
          { ticker: "VALE3", href: "#v", changePercent: -0.0082 },
          { ticker: "BOVA11", href: "#b", changePercent: 0 },
        ]}
        notifications={3}
        userInitials="LB"
        onSearch={buscar}
      >
        conteudo
      </AppShell>,
    );
    const menus = screen.getAllByRole("navigation", { name: "Navegação principal" });
    expect(menus).toHaveLength(2);
    const atual = within(menus[0] as HTMLElement).getByRole("link", { name: "Screener" });
    expect(atual.getAttribute("aria-current")).toBe("page");
    expect(
      within(menus[1] as HTMLElement).getByRole("link", { name: "Carteira" }),
    ).toBeTruthy();
    expect(screen.getByText("+2,35%").className).toMatch(/text-up/);
    expect(screen.getByText("-0,82%").className).toMatch(/text-down/);
    expect(
      screen.getByRole("button", { name: "Notificações, 3 não lidas" }),
    ).toBeTruthy();

    const campo = screen.getByRole("searchbox", { name: "Buscar ativo" });
    act(() => {
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    });
    expect(document.activeElement).toBe(campo);
    fireEvent.change(campo, { target: { value: "petr" } });
    fireEvent.submit(screen.getByRole("search"));
    expect(buscar).toHaveBeenCalledWith("petr");
  });

  it("contador acima de 99 e sem notificacao", () => {
    const { rerender } = render(
      <AppShell nav={navegacaoPadrao("/ativo")} notifications={120}>
        x
      </AppShell>,
    );
    expect(screen.getByText("99+")).toBeTruthy();
    rerender(<AppShell nav={navegacaoPadrao("/ativo")}>x</AppShell>);
    expect(screen.getByRole("button", { name: "Notificações" })).toBeTruthy();
  });

  it("area da conta substitui as iniciais", () => {
    render(
      <AppShell
        nav={navegacaoPadrao("/ativo")}
        userInitials="LB"
        account={<a href="/entrar">Entrar</a>}
      >
        x
      </AppShell>,
    );
    expect(screen.getByRole("link", { name: "Entrar" })).toBeTruthy();
    expect(screen.queryByText("LB")).toBeNull();
  });
});

describe("AppShell com busca propria", () => {
  it("Ctrl+K foca o campo indicado e o topo some no celular", () => {
    const { container } = render(
      <AppShell
        nav={navegacaoPadrao("/ativo")}
        search={<input id="minha-busca" aria-label="Busca" />}
        searchInputId="minha-busca"
        hideHeaderOnMobile
      >
        x
      </AppShell>,
    );
    act(() => {
      fireEvent.keyDown(window, { key: "K", metaKey: true });
    });
    expect(document.activeElement?.id).toBe("minha-busca");
    expect(container.querySelector("header")?.className).toMatch(/\bhidden\b/);
    expect(screen.queryByRole("search")).toBeNull();
  });
});

describe("Sheet", () => {
  it("abre com titulo e fecha pelo botao", () => {
    const mudar = vi.fn();
    render(
      <Sheet open onOpenChange={mudar} title="Novo alerta" description="d">
        <p>corpo</p>
      </Sheet>,
    );
    expect(screen.getByRole("dialog", { name: "Novo alerta" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(mudar).toHaveBeenCalledWith(false);
  });
});
