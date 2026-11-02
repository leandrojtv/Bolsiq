import { EVENTO_DO_TIPO, type Regra } from "./regras.js";

/**
 * Indice de regras por (evento, ticker).
 *
 * O caminho quente e "chegou cotacao de PETR4": o custo tem de ser o numero de
 * regras de PETR4 para aquele evento, nao o numero total de regras. Varrer dez
 * mil regras a cada tick e o que degradaria a latencia com o crescimento.
 */
export class IndiceDeRegras {
  private readonly porChave = new Map<string, Map<string, Regra>>();
  private readonly chaveDaRegra = new Map<string, string>();

  carregar(regras: Regra[]): void {
    for (const r of regras) this.inserir(r);
  }

  inserir(regra: Regra): void {
    this.remover(regra.id);
    if (!regra.ativo) return;

    const chave = chaveDe(EVENTO_DO_TIPO[regra.tipo], regra.ticker);
    const grupo = this.porChave.get(chave) ?? new Map<string, Regra>();
    grupo.set(regra.id, regra);
    this.porChave.set(chave, grupo);
    this.chaveDaRegra.set(regra.id, chave);
  }

  remover(id: string): void {
    const chave = this.chaveDaRegra.get(id);
    if (chave === undefined) return;
    const grupo = this.porChave.get(chave);
    grupo?.delete(id);
    if (grupo?.size === 0) this.porChave.delete(chave);
    this.chaveDaRegra.delete(id);
  }

  obter(id: string): Regra | undefined {
    const chave = this.chaveDaRegra.get(id);
    return chave === undefined ? undefined : this.porChave.get(chave)?.get(id);
  }

  candidatas(evento: string, ticker: string): Regra[] {
    return [...(this.porChave.get(chaveDe(evento, ticker))?.values() ?? [])];
  }

  get tamanho(): number {
    return this.chaveDaRegra.size;
  }
}

function chaveDe(evento: string, ticker: string): string {
  return `${evento}\u0000${ticker}`;
}
