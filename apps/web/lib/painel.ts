import "server-only";
import { capacidadeDoUsuario } from "@bolsiq/assistant";
import {
  comoUsuario as comoUsuarioNoFinance,
  evolucaoDoPatrimonio,
  partesDoFinance,
} from "@bolsiq/finance";
import {
  carteirasParaOPatrimonio,
  comoUsuario as comoUsuarioNoPortfolio,
  patrimonioDasCarteiras,
  tickersAbertos,
} from "@bolsiq/portfolio";
import type { PainelGeral } from "@bolsiq/finance/puro";
import { banco } from "./analytics";
import { fontesFinanceirasDoUsuario } from "./assistente";
import { cotacoes } from "./carteira";
import { metas } from "./financas";
import { hojeEmSp } from "./indicadores-tecnicos";
import { montarPainel } from "./painel-modelo";

/**
 * GET /api/financas/painel-geral (ADR 0037). Cada parte pelo modulo dono, cada
 * um com a sua RLS: o portfolio da as carteiras (avaliadas pela cotacao ao
 * vivo do /v1), o finance da contas, faturas, dividas, fotos e metas, e o
 * assistente da a capacidade de aporte (a mesma conta da ferramenta, sem IA).
 * Nenhuma consulta junta os dois schemas.
 */
export async function painelGeral(uid: string): Promise<PainelGeral> {
  const hoje = hojeEmSp();
  const carteiras = await comoUsuarioNoPortfolio(banco(), uid, (tx) =>
    carteirasParaOPatrimonio(tx, uid),
  );
  const precos = await cotacoes(tickersAbertos(carteiras));
  const portfolio = patrimonioDasCarteiras(
    carteiras,
    Object.fromEntries([...precos].map(([t, q]) => [t, q.price])),
  );
  const { financas, fotos } = await comoUsuarioNoFinance(banco(), uid, async (tx) => ({
    financas: await partesDoFinance(tx, uid, hoje),
    fotos: await evolucaoDoPatrimonio(tx, uid),
  }));
  const fontes = fontesFinanceirasDoUsuario(uid);
  const [doMes, capacidade, listaDeMetas] = await Promise.all([
    fontes.lancamentos(`${hoje.slice(0, 7)}-01`, hoje),
    capacidadeDoUsuario(fontes, hoje).catch(() => null),
    metas(uid),
  ]);
  return montarPainel({
    hoje,
    financas,
    portfolio: {
      ...portfolio,
      avaliadas_em: carteiras.length ? new Date().toISOString() : null,
    },
    fotos,
    lancamentosDoMes: doMes.dados,
    capacidade,
    metas: listaDeMetas
      .filter((m) => m.ativa)
      .map((m) => ({
        id: m.id,
        nome: m.nome,
        valor_alvo: m.valor_alvo,
        valor_atual: m.valor_atual,
        progresso: m.progresso,
        data_alvo: m.data_alvo,
        fonte: m.fonte,
        valor_mensal_necessario: m.valor_mensal_necessario,
      })),
  });
}
