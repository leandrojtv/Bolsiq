import { janelasDeConsulta, parseBcbDate, shiftDecimal } from "@bolsiq/domain";
import { BolsiqError } from "@bolsiq/contracts";
import { obter, type Buscar } from "./http.js";

export const BCB_SOURCE = "bcb-sgs";
export const BCB_LICENSE = "dados abertos do Banco Central do Brasil, com atribuicao";

export interface PontoBcb {
  date: string;
  value: string;
}

function paraBr(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

export class BcbAdapter {
  constructor(
    private readonly buscar: Buscar,
    private readonly base = "https://api.bcb.gov.br/dados/serie",
  ) {}

  /**
   * Pontos de uma serie do SGS no intervalo, em janelas de ate 3 anos: o SGS
   * devolve 406 para janela longa em serie diaria.
   */
  async serie(codigo: string, de: string, ate: string): Promise<PontoBcb[]> {
    const pontos: PontoBcb[] = [];
    for (const janela of janelasDeConsulta(de, ate)) {
      const url =
        `${this.base}/bcdata.sgs.${codigo}/dados?formato=json` +
        `&dataInicial=${paraBr(janela.from)}&dataFinal=${paraBr(janela.to)}`;
      const res = await obter(this.buscar, url, { timeoutMs: 30_000 });
      // Janela sem ponto (feriado longo, serie mensal no meio do mes) vem 404.
      if (res.status === 404) continue;
      if (!res.ok)
        throw new BolsiqError("source_unavailable", `SGS respondeu ${res.status}`);
      const corpo = (await res.json()) as { data: string; valor: string }[];
      for (const p of corpo) {
        pontos.push({ date: parseBcbDate(p.data), value: shiftDecimal(p.valor, 0) });
      }
    }
    return pontos;
  }
}
