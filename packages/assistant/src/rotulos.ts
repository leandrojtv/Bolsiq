const lista = (v: unknown) =>
  Array.isArray(v) ? v.filter((x) => typeof x === "string").join(", ") : "";

const texto = (v: unknown) => (typeof v === "string" ? v : "");

interface Saida {
  nome?: string;
  carteira?: { nome?: string };
  erro?: string;
}

/** Texto do passo recolhivel: "Consultando carteira Principal...". */
export function rotuloDoPasso(
  nome: string,
  entrada: Record<string, unknown> | undefined,
  saida?: unknown,
): string {
  const e = entrada ?? {};
  const s = (saida ?? {}) as Saida;
  const carteira = s.carteira?.nome ?? s.nome;
  const daCarteira = carteira ? `carteira ${carteira}` : "carteira";
  switch (nome) {
    case "cotacao":
      return `Consultando cotação de ${lista(e.tickers)}`;
    case "historico":
      return `Consultando histórico de ${texto(e.ticker)}`;
    case "proventos":
      return `Consultando proventos de ${texto(e.ticker)}`;
    case "fundamentos":
      return `Consultando fundamentos de ${texto(e.ticker)}`;
    case "indicadores":
      return `Consultando indicadores de ${lista(e.tickers)}`;
    case "analise_tecnica":
      return `Calculando médias móveis e IFR de ${texto(e.ticker)}`;
    case "comparar":
      return `Comparando ${lista(e.tickers)}`;
    case "screener":
      return e.preset ? `Filtrando pelo critério ${texto(e.preset)}` : "Filtrando ativos";
    case "cenario_macro":
      return "Consultando Selic, IPCA, CDI e IBOV";
    case "minha_carteira":
      return `Consultando ${daCarteira}`;
    case "avaliar_carteira":
      return `Avaliando ${daCarteira}`;
    case "sugerir_aporte":
      return `Gerando candidatos de aporte na ${daCarteira}`;
    case "criar_alerta":
      return `Preparando alerta de ${texto(e.ticker)}`;
    default:
      return `Consultando ${nome}`;
  }
}
