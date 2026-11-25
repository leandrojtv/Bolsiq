import type { Importacao } from "../contratos-importacao.js";
import { d, moeda } from "../decimal.js";

export interface LinhaParaConferir {
  id: string;
  tipo: string;
  valor: string;
  marcacao: string | null;
  data: string;
  descricao_normalizada: string;
  aviso: string | null;
}

/** Tolerancia da conferencia do total da fatura: arredondamento de centavos. */
export const TOLERANCIA_DA_FATURA = "0.05";

/**
 * Soma do documento contra o total escrito: compras, IOF e tarifas menos
 * estornos. Pagamento e saldo anterior ficam fora: com a fatura anterior paga
 * inteira, os dois se anulam. Todas as linhas contam, marcadas ou nao: e a
 * conferencia da leitura, nao do que vai ser gravado. Suspeitas: a linha com o
 * valor da diferenca, as repetidas no mesmo dia e as que ja vieram com aviso.
 */
export function conferirFatura(
  totalInformado: string,
  linhas: LinhaParaConferir[],
): NonNullable<Importacao["conferencia_fatura"]> {
  let calculado = d(0);
  for (const l of linhas) {
    if (l.marcacao === "pagamento" || l.marcacao === "saldo_anterior") continue;
    if (l.tipo === "despesa") calculado = calculado.plus(l.valor);
    else if (l.marcacao === "estorno") calculado = calculado.minus(l.valor);
  }
  const diferenca = calculado.minus(totalInformado);
  const confere = diferenca.abs().lte(TOLERANCIA_DA_FATURA);
  const suspeitas: string[] = [];
  if (!confere) {
    const vistas = new Map<string, number>();
    for (const l of linhas) {
      const k = `${l.data}|${l.valor}|${l.descricao_normalizada}`;
      vistas.set(k, (vistas.get(k) ?? 0) + 1);
    }
    for (const l of linhas)
      if (
        d(l.valor).eq(diferenca.abs()) ||
        (vistas.get(`${l.data}|${l.valor}|${l.descricao_normalizada}`) ?? 0) > 1 ||
        l.aviso
      )
        suspeitas.push(l.id);
  }
  return {
    total_informado: moeda(d(totalInformado)),
    total_calculado: moeda(calculado),
    diferenca: moeda(diferenca),
    confere,
    suspeitas,
  };
}
