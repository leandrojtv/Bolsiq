import { Ticker } from "@bolsiq/contracts";

/** O que o registro precisa de um cliente. Abstraído para poder testar sem socket. */
export interface ClienteStream {
  enviar: (mensagem: string) => void;
}

/**
 * Teto de tickers por conexão.
 *
 * Provisório: o limite real é por plano (`tickers_per_call` em `api_plans`), e
 * depende da autenticação, que ainda não existe — ver ADR 0007. Até lá, um teto
 * único evita que uma conexão assine o universo inteiro e vire amplificador.
 */
export const MAX_TICKERS_POR_CONEXAO = 200;

export interface ResultadoAssinatura {
  aceitos: string[];
  rejeitados: { ticker: string; motivo: string }[];
}

/**
 * Registro de quem escuta o quê.
 *
 * Índice por ticker, não por cliente: o caminho quente é "chegou cotação de
 * PETR4, quem quer saber?". Com índice por cliente isso seria uma varredura de
 * todas as conexões a cada cotação.
 */
export class RegistroDeAssinantes {
  private readonly porTicker = new Map<string, Set<ClienteStream>>();
  private readonly porCliente = new Map<ClienteStream, Set<string>>();

  assinar(cliente: ClienteStream, tickers: string[]): ResultadoAssinatura {
    const resultado: ResultadoAssinatura = { aceitos: [], rejeitados: [] };
    const atuais = this.porCliente.get(cliente) ?? new Set<string>();

    for (const bruto of tickers) {
      const ticker = bruto.trim().toUpperCase();

      const valido = Ticker.safeParse(ticker);
      if (!valido.success) {
        resultado.rejeitados.push({ ticker: bruto, motivo: "ticker inválido" });
        continue;
      }

      if (atuais.has(ticker)) {
        // Reassinar não é erro; é idempotente.
        resultado.aceitos.push(ticker);
        continue;
      }

      if (atuais.size >= MAX_TICKERS_POR_CONEXAO) {
        resultado.rejeitados.push({
          ticker,
          motivo: `limite de ${MAX_TICKERS_POR_CONEXAO} tickers por conexão`,
        });
        continue;
      }

      atuais.add(ticker);
      const ouvintes = this.porTicker.get(ticker) ?? new Set<ClienteStream>();
      ouvintes.add(cliente);
      this.porTicker.set(ticker, ouvintes);
      resultado.aceitos.push(ticker);
    }

    this.porCliente.set(cliente, atuais);
    return resultado;
  }

  cancelar(cliente: ClienteStream, tickers: string[]): void {
    const atuais = this.porCliente.get(cliente);
    if (!atuais) return;

    for (const bruto of tickers) {
      const ticker = bruto.trim().toUpperCase();
      atuais.delete(ticker);

      const ouvintes = this.porTicker.get(ticker);
      if (!ouvintes) continue;
      ouvintes.delete(cliente);
      // Não deixa Set vazio no mapa: a memória vazaria com o tempo, num
      // serviço que roda por semanas.
      if (ouvintes.size === 0) this.porTicker.delete(ticker);
    }
  }

  remover(cliente: ClienteStream): void {
    const atuais = this.porCliente.get(cliente);
    if (atuais) this.cancelar(cliente, [...atuais]);
    this.porCliente.delete(cliente);
  }

  /** Envia a mensagem a quem assina o ticker. Devolve quantos receberam. */
  publicar(ticker: string, mensagem: string): number {
    const ouvintes = this.porTicker.get(ticker.toUpperCase());
    if (!ouvintes) return 0;

    let enviados = 0;
    for (const cliente of [...ouvintes]) {
      try {
        cliente.enviar(mensagem);
        enviados += 1;
      } catch {
        // Socket morto: remove em vez de tentar de novo a cada cotação.
        this.remover(cliente);
      }
    }
    return enviados;
  }

  tickersDe(cliente: ClienteStream): string[] {
    return [...(this.porCliente.get(cliente) ?? [])].sort();
  }

  get totalDeClientes(): number {
    return this.porCliente.size;
  }

  get totalDeTickers(): number {
    return this.porTicker.size;
  }
}
