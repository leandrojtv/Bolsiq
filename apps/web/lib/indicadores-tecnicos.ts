/** Media movel simples. Entrada e saida alinhadas por indice; antes de `n` pontos, null. */
export function mediaMovel(valores: number[], n: number): (number | null)[] {
  const saida: (number | null)[] = [];
  let soma = 0;
  valores.forEach((v, i) => {
    soma += v;
    if (i >= n) soma -= valores[i - n] as number;
    saida.push(i >= n - 1 ? soma / n : null);
  });
  return saida;
}

/**
 * IFR (RSI) de Wilder: medias de alta e queda suavizadas por 1/n. E o calculo
 * das plataformas de grafico; a media simples daria outro numero.
 */
export function ifr(fechamentos: number[], n = 14): (number | null)[] {
  const saida: (number | null)[] = fechamentos.map(() => null);
  if (fechamentos.length <= n) return saida;
  let alta = 0;
  let queda = 0;
  for (let i = 1; i <= n; i++) {
    const d = (fechamentos[i] as number) - (fechamentos[i - 1] as number);
    if (d > 0) alta += d;
    else queda -= d;
  }
  alta /= n;
  queda /= n;
  const calc = () => (queda === 0 ? 100 : 100 - 100 / (1 + alta / queda));
  saida[n] = calc();
  for (let i = n + 1; i < fechamentos.length; i++) {
    const d = (fechamentos[i] as number) - (fechamentos[i - 1] as number);
    alta = (alta * (n - 1) + Math.max(d, 0)) / n;
    queda = (queda * (n - 1) + Math.max(-d, 0)) / n;
    saida[i] = calc();
  }
  return saida;
}

export type Periodo = "1M" | "6M" | "1A" | "5A" | "Máx";

/** Data inicial do periodo, em YYYY-MM-DD, contada a partir de `hoje`. */
export function inicioDoPeriodo(periodo: Periodo, hoje: string): string {
  const d = new Date(`${hoje}T00:00:00Z`);
  if (periodo === "Máx") return "1990-01-01";
  const meses = { "1M": 1, "6M": 6, "1A": 12, "5A": 60 }[periodo];
  d.setUTCMonth(d.getUTCMonth() - meses);
  return d.toISOString().slice(0, 10);
}

export function hojeEmSp(agora = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(
    agora,
  );
}
