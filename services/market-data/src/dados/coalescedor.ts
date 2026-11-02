/**
 * Coalescencia de leituras concorrentes da mesma chave.
 *
 * Cem requisicoes simultaneas de PETR4 com o cache vencido fariam cem chamadas
 * a brapi; com isto fazem uma, e as outras noventa e nove esperam o mesmo
 * resultado. A promessa sai do mapa quando termina, com sucesso ou erro: erro
 * nao fica em cache.
 */
export class Coalescedor {
  private readonly emVoo = new Map<string, Promise<unknown>>();

  executar<T>(chave: string, fn: () => Promise<T>): Promise<T> {
    const existente = this.emVoo.get(chave);
    if (existente) return existente as Promise<T>;

    const promessa = fn().finally(() => {
      this.emVoo.delete(chave);
    });
    this.emVoo.set(chave, promessa);
    return promessa;
  }

  get tamanho(): number {
    return this.emVoo.size;
  }
}

/** `true` quando o dado buscado em `fetchedAt` ainda vale. */
export function dentroDoPrazo(
  fetchedAt: string | null,
  ttlMs: number,
  agora: Date,
): boolean {
  if (fetchedAt === null) return false;
  return agora.getTime() - new Date(fetchedAt).getTime() < ttlMs;
}
