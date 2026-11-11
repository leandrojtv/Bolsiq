import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MESES_PARA_TECNICOS, sinaisTecnicos } from "@bolsiq/analytics/puro";
import type { AssetDetail, Candle, Dividend, LiveQuote } from "@bolsiq/contracts";
import { PaginaDoAtivo } from "@/componentes/ativo/PaginaDoAtivo";
import type { Fundamentos } from "@/componentes/ativo/tipos";
import type { GraficoProps } from "@/componentes/ativo/Grafico";
import type { Envelope } from "@/lib/api";
import { indicadoresDe } from "@/lib/analytics";
import { hojeEmSp, inicioDoPeriodo } from "@/lib/indicadores-tecnicos";
import { buscarV1, VALIDADE } from "@/lib/market-data";

interface Props {
  params: Promise<{ ticker: string }>;
}

const VALIDO = /^[A-Za-z0-9]{4,12}$/;

async function ou<T>(p: Promise<{ status: number; corpo: T }>): Promise<T | null> {
  try {
    const r = await p;
    return r.status === 200 ? r.corpo : null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { ticker } = await params;
  return { title: ticker.toUpperCase() };
}

/**
 * HTML completo na primeira resposta, sem streaming.
 *
 * - O cadastro decide o 404. Com loading.tsx ou Suspense em volta, o Next
 *   responderia 200 antes de saber que o ticker nao existe.
 * - O preco e o maior elemento da tela (LCP). Vindo num trecho de streaming,
 *   ele so aparece quando o script inline troca o esqueleto, e o Lighthouse
 *   mobile media 3,8 s de LCP. Com o cache do fetch quente, esperar tudo custa
 *   cerca de 150 ms.
 * Os esqueletos ficam onde o carregamento e no cliente: grafico, troca de
 * periodo e demonstrativos trimestrais.
 */
export default async function Pagina({ params }: Props) {
  const { ticker: bruto } = await params;
  if (!VALIDO.test(bruto)) notFound();
  const ticker = bruto.toUpperCase();
  const ativo = await buscarV1<Envelope<AssetDetail>>(
    `assets/${ticker}`,
    VALIDADE.assets,
  );
  if (ativo.status === 404) notFound();
  if (ativo.status !== 200)
    throw new Error(`market-data respondeu ${ativo.status} para ${ticker}`);

  return <Conteudo ativo={ativo.corpo} />;
}

/**
 * Dados da primeira pintura: tudo em paralelo, com o cache do fetch do
 * Next (VALIDADE). O cliente assume com TanStack Query a partir daqui.
 * Fonte que falha (cotacao, proventos) nao derruba a pagina.
 */
async function Conteudo({ ativo }: { ativo: Envelope<AssetDetail> }) {
  const ticker = ativo.data.ticker;
  const hoje = hojeEmSp();
  const de = inicioDoPeriodo("6M", hoje);
  const deTecnicos = new Date(`${hoje}T00:00:00Z`);
  deTecnicos.setUTCMonth(deTecnicos.getUTCMonth() - MESES_PARA_TECNICOS);

  const [cotacao, historico, proventos, fundamentos, indicadores, longo] =
    await Promise.all([
      ou(buscarV1<Envelope<LiveQuote[]>>(`quotes/${ticker}`, VALIDADE.quotes)),
      ou(
        buscarV1<NonNullable<GraficoProps["inicial"]>>(
          `history/${ticker}?interval=1d&from=${de}&adjusted=true`,
          VALIDADE.history,
        ),
      ),
      ou(buscarV1<Envelope<Dividend[]>>(`dividends/${ticker}`, VALIDADE.dividends)),
      ou(
        buscarV1<Envelope<Fundamentos>>(
          `fundamentals/${ticker}?period=annual`,
          VALIDADE.fundamentals,
        ),
      ),
      indicadoresDe(ticker).catch(() => null),
      // MM 200 pede mais pregoes que os 6M do grafico.
      ou(
        buscarV1<Envelope<{ candles: Candle[] }>>(
          `history/${ticker}?interval=1d&from=${deTecnicos.toISOString().slice(0, 10)}&adjusted=true`,
          VALIDADE.history,
        ),
      ),
    ]);
  const tecnicos = longo
    ? sinaisTecnicos(longo.data.candles.map((c) => Number(c.close)))
    : null;

  return (
    <PaginaDoAtivo
      dados={{ ativo, cotacao, proventos, fundamentos }}
      historico={historico}
      indicadores={indicadores}
      tecnicos={tecnicos}
    />
  );
}
