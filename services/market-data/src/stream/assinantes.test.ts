import { describe, expect, it, vi } from "vitest";
import {
  MAX_TICKERS_POR_CONEXAO,
  RegistroDeAssinantes,
  type ClienteStream,
} from "./assinantes.js";

function cliente(): ClienteStream & { recebidas: string[] } {
  const recebidas: string[] = [];
  return {
    recebidas,
    enviar: (m) => {
      recebidas.push(m);
    },
  };
}

describe("RegistroDeAssinantes", () => {
  it("entrega só a quem assina o ticker", () => {
    const registro = new RegistroDeAssinantes();
    const a = cliente();
    const b = cliente();

    registro.assinar(a, ["PETR4"]);
    registro.assinar(b, ["VALE3"]);

    expect(registro.publicar("PETR4", "cotacao-petr4")).toBe(1);
    expect(a.recebidas).toEqual(["cotacao-petr4"]);
    expect(b.recebidas).toEqual([]);
  });

  it("entrega a vários assinantes do mesmo ticker", () => {
    const registro = new RegistroDeAssinantes();
    const a = cliente();
    const b = cliente();
    registro.assinar(a, ["PETR4"]);
    registro.assinar(b, ["PETR4"]);

    expect(registro.publicar("PETR4", "x")).toBe(2);
  });

  it("não falha ao publicar ticker sem assinante", () => {
    const registro = new RegistroDeAssinantes();
    expect(registro.publicar("PETR4", "x")).toBe(0);
  });

  it("normaliza o ticker para maiúsculas", () => {
    const registro = new RegistroDeAssinantes();
    const a = cliente();
    registro.assinar(a, ["petr4", "  vale3  "]);

    expect(registro.tickersDe(a)).toEqual(["PETR4", "VALE3"]);
    expect(registro.publicar("petr4", "x")).toBe(1);
  });

  it("rejeita ticker inválido e aceita o resto do lote", () => {
    const registro = new RegistroDeAssinantes();
    const a = cliente();
    const r = registro.assinar(a, ["PETR4", "não é ticker", "AB"]);

    expect(r.aceitos).toEqual(["PETR4"]);
    expect(r.rejeitados).toHaveLength(2);
    expect(r.rejeitados[0]?.motivo).toBe("ticker inválido");
  });

  it("reassinar é idempotente", () => {
    const registro = new RegistroDeAssinantes();
    const a = cliente();
    registro.assinar(a, ["PETR4"]);
    const r = registro.assinar(a, ["PETR4"]);

    expect(r.aceitos).toEqual(["PETR4"]);
    expect(registro.tickersDe(a)).toEqual(["PETR4"]);
    expect(registro.publicar("PETR4", "x")).toBe(1);
  });

  it("aplica o teto de tickers por conexão", () => {
    const registro = new RegistroDeAssinantes();
    const a = cliente();
    const muitos = Array.from(
      { length: MAX_TICKERS_POR_CONEXAO + 5 },
      (_, i) => `TICK${String(i).padStart(4, "0")}`,
    );

    const r = registro.assinar(a, muitos);
    expect(r.aceitos).toHaveLength(MAX_TICKERS_POR_CONEXAO);
    expect(r.rejeitados).toHaveLength(5);
    expect(r.rejeitados[0]?.motivo).toMatch(/limite/);
  });

  it("cancelar para de entregar e limpa o índice", () => {
    const registro = new RegistroDeAssinantes();
    const a = cliente();
    registro.assinar(a, ["PETR4", "VALE3"]);
    registro.cancelar(a, ["PETR4"]);

    expect(registro.publicar("PETR4", "x")).toBe(0);
    expect(registro.publicar("VALE3", "y")).toBe(1);
    // Sem assinante, o ticker sai do índice: com o tempo isso seria vazamento.
    expect(registro.totalDeTickers).toBe(1);
  });

  it("cancelar cliente desconhecido não quebra", () => {
    const registro = new RegistroDeAssinantes();
    expect(() => registro.cancelar(cliente(), ["PETR4"])).not.toThrow();
  });

  it("remover limpa tudo do cliente", () => {
    const registro = new RegistroDeAssinantes();
    const a = cliente();
    const b = cliente();
    registro.assinar(a, ["PETR4", "VALE3"]);
    registro.assinar(b, ["PETR4"]);

    registro.remover(a);

    expect(registro.totalDeClientes).toBe(1);
    expect(registro.totalDeTickers).toBe(1);
    expect(registro.publicar("PETR4", "x")).toBe(1);
    expect(registro.tickersDe(a)).toEqual([]);
  });

  it("remove o cliente cujo envio lança, em vez de tentar a cada cotação", () => {
    const registro = new RegistroDeAssinantes();
    const morto: ClienteStream = {
      enviar: vi.fn(() => {
        throw new Error("socket fechado");
      }),
    };
    const vivo = cliente();

    registro.assinar(morto, ["PETR4"]);
    registro.assinar(vivo, ["PETR4"]);

    expect(registro.publicar("PETR4", "x")).toBe(1);
    expect(vivo.recebidas).toEqual(["x"]);

    // Segunda cotação não tenta mais o socket morto.
    expect(registro.publicar("PETR4", "y")).toBe(1);
    expect(registro.totalDeClientes).toBe(1);
  });
});
