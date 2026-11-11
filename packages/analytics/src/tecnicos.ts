import type { AjudaDoIndicador, Sinal } from "./sinais.js";

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

/** Pregoes que a MM 200 precisa, com folga: e o que o chamador deve buscar. */
export const MESES_PARA_TECNICOS = 14;

export interface SinaisTecnicos {
  preco: number | null;
  mm20: number | null;
  mm50: number | null;
  mm200: number | null;
  ifr14: number | null;
  sinais: {
    tendencia: Sinal | null;
    curto_prazo: Sinal | null;
    ifr: Sinal | null;
  };
}

export const AJUDA_TECNICA: Record<keyof SinaisTecnicos["sinais"], AjudaDoIndicador> = {
  tendencia: {
    descricao:
      "Tendência de longo prazo pelas médias móveis de 50 e 200 pregões, as mesmas do gráfico.",
    faixas: {
      verde: "preço e MM 50 acima da MM 200: tendência de alta",
      amarelo: "sinais mistos: tendência em transição",
      vermelho: "preço e MM 50 abaixo da MM 200: tendência de baixa",
    },
  },
  curto_prazo: {
    descricao: "Movimento de curto prazo pelas médias de 20 e 50 pregões.",
    faixas: {
      verde: "preço acima da MM 20 e MM 20 acima da MM 50: alta de curto prazo",
      amarelo: "sinais mistos: lateral ou virando",
      vermelho: "preço abaixo da MM 20 e MM 20 abaixo da MM 50: queda de curto prazo",
    },
  },
  ifr: {
    descricao:
      "Índice de Força Relativa de 14 pregões (Wilder), de 0 a 100: mede a força das altas contra as quedas recentes.",
    faixas: {
      verde: "abaixo de 30: sobrevendido, queda forte recente; possível ponto de entrada",
      amarelo: "de 30 a 70: neutro",
      vermelho: "acima de 70: sobrecomprado, alta forte recente; risco de correção",
    },
  },
};

const arredondar = (v: number | null | undefined, casas: number) =>
  v === null || v === undefined ? null : Number(v.toFixed(casas));

function sinal(
  regra: keyof typeof AJUDA_TECNICA,
  nivel: "verde" | "amarelo" | "vermelho",
): Sinal {
  return { nivel, leitura: AJUDA_TECNICA[regra].faixas[nivel] };
}

function cruzamento(preco: number, rapida: number, lenta: number) {
  if (preco > lenta && rapida > lenta) return "verde" as const;
  if (preco < lenta && rapida < lenta) return "vermelho" as const;
  return "amarelo" as const;
}

/** MM 20/50/200 e IFR 14 do ultimo pregao, com a leitura de cada um. */
export function sinaisTecnicos(fechamentos: number[]): SinaisTecnicos {
  const preco = fechamentos.at(-1) ?? null;
  const mm20 = mediaMovel(fechamentos, 20).at(-1) ?? null;
  const mm50 = mediaMovel(fechamentos, 50).at(-1) ?? null;
  const mm200 = mediaMovel(fechamentos, 200).at(-1) ?? null;
  const ifr14 = ifr(fechamentos, 14).at(-1) ?? null;

  return {
    preco: arredondar(preco, 2),
    mm20: arredondar(mm20, 2),
    mm50: arredondar(mm50, 2),
    mm200: arredondar(mm200, 2),
    ifr14: arredondar(ifr14, 1),
    sinais: {
      tendencia:
        preco !== null && mm50 !== null && mm200 !== null
          ? sinal("tendencia", cruzamento(preco, mm50, mm200))
          : null,
      // Curto prazo: preco contra a MM 20 e MM 20 contra a MM 50.
      curto_prazo:
        preco !== null && mm20 !== null && mm50 !== null
          ? sinal(
              "curto_prazo",
              preco > mm20 && mm20 > mm50
                ? "verde"
                : preco < mm20 && mm20 < mm50
                  ? "vermelho"
                  : "amarelo",
            )
          : null,
      ifr:
        ifr14 !== null
          ? sinal("ifr", ifr14 < 30 ? "verde" : ifr14 > 70 ? "vermelho" : "amarelo")
          : null,
    },
  };
}
