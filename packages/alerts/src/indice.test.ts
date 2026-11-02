import { describe, expect, it } from "vitest";
import { performance } from "node:perf_hooks";
import { IndiceDeRegras } from "./indice.js";
import { avaliarCotacao } from "./avaliador.js";
import { Regra } from "./regras.js";

function r(id: string, ticker: string, tipo = "preco_acima", ativo = true): Regra {
  return Regra.parse({
    id,
    user_id: "u",
    canais: ["inapp"],
    ticker,
    tipo,
    params: { valor: "40" },
    ativo,
  });
}

const COTACAO = "marketdata.quote.updated.v1";

describe("IndiceDeRegras", () => {
  it("devolve so as regras do ticker e do evento", () => {
    const i = new IndiceDeRegras();
    i.carregar([r("1", "PETR4"), r("2", "VALE3"), r("3", "PETR4")]);
    expect(
      i
        .candidatas(COTACAO, "PETR4")
        .map((x) => x.id)
        .sort(),
    ).toEqual(["1", "3"]);
    expect(i.candidatas("marketdata.dividend.announced.v1", "PETR4")).toEqual([]);
    expect(i.tamanho).toBe(3);
  });

  it("reinserir substitui, nao duplica", () => {
    const i = new IndiceDeRegras();
    i.inserir(r("1", "PETR4"));
    i.inserir(r("1", "VALE3"));
    expect(i.candidatas(COTACAO, "PETR4")).toEqual([]);
    expect(i.candidatas(COTACAO, "VALE3")).toHaveLength(1);
    expect(i.tamanho).toBe(1);
  });

  it("regra desativada sai do indice", () => {
    const i = new IndiceDeRegras();
    i.inserir(r("1", "PETR4"));
    i.inserir(r("1", "PETR4", "preco_acima", false));
    expect(i.tamanho).toBe(0);
    expect(i.obter("1")).toBeUndefined();
  });

  it("remover id desconhecido nao quebra", () => {
    expect(() => new IndiceDeRegras().remover("x")).not.toThrow();
  });

  it("obter por id", () => {
    const i = new IndiceDeRegras();
    i.inserir(r("1", "PETR4"));
    expect(i.obter("1")?.ticker).toBe("PETR4");
  });
});

describe("10 mil regras ativas", () => {
  it("avaliar uma cotacao custa o numero de regras do ticker, nao o total", () => {
    const i = new IndiceDeRegras();
    const regras: Regra[] = [];
    // 10 mil regras em 2 mil tickers: 5 por ticker.
    for (let k = 0; k < 10_000; k++) {
      regras.push(r(`r${k}`, `TK${String(k % 2000).padStart(4, "0")}`));
    }
    i.carregar(regras);
    expect(i.tamanho).toBe(10_000);

    const agora = new Date();
    const tempos: number[] = [];
    for (let q = 0; q < 5000; q++) {
      const ticker = `TK${String(q % 2000).padStart(4, "0")}`;
      const t0 = performance.now();
      avaliarCotacao(
        i.candidatas(COTACAO, ticker),
        { ticker, price: "41.00", change: "1.00" },
        agora,
      );
      tempos.push(performance.now() - t0);
    }

    tempos.sort((a, b) => a - b);
    const p99 = tempos[Math.floor(tempos.length * 0.99)] ?? Infinity;
    // Meta generosa para CI lento; o valor medido localmente fica muito abaixo.
    expect(p99).toBeLessThan(5);
  });
});
