import { Decimal } from "decimal.js";
import {
  FiltroDeScreener,
  filtroDoPreset,
  INDICADORES,
  type IndicadorFiltravel,
  type LinhaDoScreener,
} from "@bolsiq/analytics/puro";
import {
  CLASSES,
  METODOS,
  NOMES_DE_CLASSE,
  type ClasseDoPerfil,
  type Metodo,
  type PerfilDoInvestidor,
} from "./perfil.js";
import type { CarteiraResumida } from "./tipos.js";

/** `educational` tira valor e quantidade por candidato (ADR 0024). */
export type ModoDeRecomendacao = "personal" | "educational";

/** Candidatos mostrados por classe. */
export const CANDIDATOS_POR_CLASSE = 3;
const LIMITE_DO_SCREENER = 30;

/** A partir daqui o candidato leva um aviso de risco. */
export const LIMITES_DE_RISCO = {
  dl_ebitda: 3,
  cagr_lucro_5a: 0,
  volatilidade_anual: 0.4,
  drawdown_maximo: -0.4,
};

export interface AporteDeClasse {
  classe: ClasseDoPerfil;
  rotulo: string;
  fracao_atual: number;
  fracao_alvo: number;
  valor_atual: string;
  aporte: string;
  fracao_depois: number;
}

/**
 * Quanto aportar por classe para aproximar da alocacao-alvo: reparte o aporte
 * na proporcao do que falta em cada classe, sobre o patrimonio depois do
 * aporte. Nao vende nada, entao classe acima do alvo recebe zero.
 */
export function rebalancear(
  carteira: CarteiraResumida,
  perfil: PerfilDoInvestidor,
  valor: string,
): AporteDeClasse[] {
  const atual = new Map(carteira.alocacao.classe.map((f) => [f.chave, f.valor]));
  const patrimonio = new Decimal(carteira.patrimonio ?? 0);
  const total = patrimonio.plus(valor);
  const linhas = NOMES_DE_CLASSE.map((classe) => {
    const rotulo = CLASSES[classe].rotulo;
    const alvo = perfil.alocacao_alvo[classe] ?? 0;
    const v = new Decimal(atual.get(rotulo) ?? 0);
    return { classe, rotulo, alvo, v, falta: Decimal.max(total.times(alvo).minus(v), 0) };
  });
  const faltaTotal = linhas.reduce((s, l) => s.plus(l.falta), new Decimal(0));
  const aportes = linhas.map((l) =>
    faltaTotal.isZero()
      ? new Decimal(0)
      : l.falta.times(valor).div(faltaTotal).toDecimalPlaces(2, Decimal.ROUND_DOWN),
  );
  // O centavo que o arredondamento deixou vai para a classe que mais falta.
  const sobra = new Decimal(valor).minus(
    aportes.reduce((s, a) => s.plus(a), new Decimal(0)),
  );
  const maior = linhas.reduce(
    (m, l, i) => (l.falta.gt(linhas[m]?.falta ?? 0) ? i : m),
    0,
  );
  if (!faltaTotal.isZero()) aportes[maior] = (aportes[maior] as Decimal).plus(sobra);

  return linhas.flatMap((l, i) => {
    const aporte = aportes[i] as Decimal;
    if (l.alvo === 0 && l.v.isZero()) return [];
    return [
      {
        classe: l.classe,
        rotulo: l.rotulo,
        fracao_atual: patrimonio.isZero()
          ? 0
          : l.v.div(patrimonio).toDecimalPlaces(6).toNumber(),
        fracao_alvo: l.alvo,
        valor_atual: l.v.toFixed(2),
        aporte: aporte.toFixed(2),
        fracao_depois: total.isZero()
          ? 0
          : l.v.plus(aporte).div(total).toDecimalPlaces(6).toNumber(),
      },
    ];
  });
}

export function filtroDoMetodo(
  metodo: Metodo,
  perfil: PerfilDoInvestidor,
): FiltroDeScreener | null {
  if (metodo === "filtro_salvo") return perfil.filtro_salvo;
  return filtroDoPreset(metodo);
}

export function riscosDe(linha: LinhaDoScreener): string[] {
  const i = linha.indicadores;
  const riscos: string[] = [];
  const v = (n: IndicadorFiltravel) => i[n] ?? null;
  const dl = v("dl_ebitda");
  if (dl !== null && dl > LIMITES_DE_RISCO.dl_ebitda)
    riscos.push(`Endividamento: DL/EBITDA de ${dl.toFixed(2)}`);
  const lucro = v("cagr_lucro_5a");
  if (lucro !== null && lucro < LIMITES_DE_RISCO.cagr_lucro_5a)
    riscos.push(`Queda de lucro: CAGR de 5 anos de ${(lucro * 100).toFixed(1)}%`);
  const vol = v("volatilidade_anual");
  if (vol !== null && vol > LIMITES_DE_RISCO.volatilidade_anual)
    riscos.push(`Volatilidade anual de ${(vol * 100).toFixed(1)}%`);
  const dd = v("drawdown_maximo");
  if (dd !== null && dd < LIMITES_DE_RISCO.drawdown_maximo)
    riscos.push(`Drawdown máximo de ${(dd * 100).toFixed(1)}%`);
  return riscos;
}

/** Fracao dos candidatos com valor pior ou igual: 1 e o melhor. Nulo fica no meio. */
function percentil(
  valores: (number | null)[],
  valor: number | null,
  maiorMelhor: boolean,
) {
  const conhecidos = valores.filter((v): v is number => v !== null);
  if (valor === null || conhecidos.length === 0) return 0.5;
  const piores = conhecidos.filter((v) => (maiorMelhor ? v <= valor : v >= valor));
  return piores.length / conhecidos.length;
}

/**
 * Pontuacao de 0 a 100 entre os candidatos da classe: 40% o indicador que o
 * metodo ordena, 20% liquidez, 20% volatilidade baixa, 20% endividamento baixo.
 */
export function pontuar(
  linha: LinhaDoScreener,
  todas: LinhaDoScreener[],
  ordenarPor: IndicadorFiltravel,
  maiorMelhor: boolean,
): number {
  const de = (n: IndicadorFiltravel) => todas.map((l) => l.indicadores[n] ?? null);
  const p = (n: IndicadorFiltravel, maior: boolean) =>
    percentil(de(n), linha.indicadores[n] ?? null, maior);
  return Number(
    (
      40 * p(ordenarPor, maiorMelhor) +
      20 * p("liquidez_diaria", true) +
      20 * p("volatilidade_anual", false) +
      20 * p("dl_ebitda", false)
    ).toFixed(1),
  );
}

export interface CriterioAtendido {
  metodo: string;
  indicador: string;
  rotulo: string;
  valor: number | null;
  min?: number;
  max?: number;
}

function criteriosDe(
  linha: LinhaDoScreener,
  metodo: Metodo,
  filtro: FiltroDeScreener,
): CriterioAtendido[] {
  return Object.entries(filtro.faixas).map(([nome, faixa]) => ({
    metodo: METODOS[metodo],
    indicador: nome,
    rotulo: INDICADORES[nome as IndicadorFiltravel].rotulo,
    valor: linha.indicadores[nome as IndicadorFiltravel] ?? null,
    ...(faixa.min !== undefined ? { min: faixa.min } : {}),
    ...(faixa.max !== undefined ? { max: faixa.max } : {}),
  }));
}

export interface EntradaDoAporte {
  valor: string;
  carteira: CarteiraResumida;
  perfil: PerfilDoInvestidor;
  modo: ModoDeRecomendacao;
  screener: (filtro: FiltroDeScreener) => Promise<{ linhas: LinhaDoScreener[] }>;
}

/**
 * Candidatos determinísticos de aporte: rebalanceamento por classe e, dentro da
 * classe, ativos que passam nos metodos do perfil, com liquidez minima, sem o
 * que ja esta acima do limite de concentracao. O modelo so apresenta o que sai
 * daqui: `tickers_permitidos` e a lista fechada que o eval confere.
 */
export async function sugerirAporte({
  valor,
  carteira,
  perfil,
  modo,
  screener,
}: EntradaDoAporte) {
  const plano = rebalancear(carteira, perfil, valor);
  const totalDepois = new Decimal(carteira.patrimonio ?? 0).plus(valor);
  const fracaoAtivo = new Map(
    carteira.alocacao.ativo.map((f) => [f.chave, f.fracao ?? 0]),
  );
  const fracaoSetor = new Map(
    carteira.alocacao.setor.map((f) => [f.chave, f.fracao ?? 0]),
  );
  const valorAtivo = new Map(carteira.alocacao.ativo.map((f) => [f.chave, f.valor]));
  const valorSetor = new Map(carteira.alocacao.setor.map((f) => [f.chave, f.valor]));
  const datas = new Set<string>();

  const classes = [];
  for (const linha of plano.filter((l) => new Decimal(l.aporte).gt(0))) {
    const kind = CLASSES[linha.classe].kind;
    if (kind === null) {
      classes.push({
        ...linha,
        candidatos: [],
        excluidos: [],
        sem_candidatos:
          "O Bolsiq não cobre títulos de renda fixa; não há candidatos nesta classe.",
      });
      continue;
    }

    // Um ativo que passa em mais de um metodo entra uma vez, com os criterios de todos.
    const achados = new Map<
      string,
      { linha: LinhaDoScreener; criterios: CriterioAtendido[]; metodos: string[] }
    >();
    let primeiroFiltro: FiltroDeScreener | null = null;
    for (const metodo of perfil.metodos) {
      const base = filtroDoMetodo(metodo, perfil);
      if (!base || (base.tipos && !base.tipos.includes(kind))) continue;
      primeiroFiltro ??= base;
      const filtro = FiltroDeScreener.parse({
        ...base,
        tipos: [kind],
        liquidez_minima: Math.max(perfil.liquidez_minima, base.liquidez_minima ?? 0),
        limite: LIMITE_DO_SCREENER,
        deslocamento: 0,
      });
      for (const l of (await screener(filtro)).linhas) {
        const a = achados.get(l.ticker) ?? { linha: l, criterios: [], metodos: [] };
        a.criterios.push(...criteriosDe(l, metodo, filtro));
        a.metodos.push(METODOS[metodo]);
        achados.set(l.ticker, a);
      }
    }

    const excluidos: { ticker: string; motivo: string }[] = [];
    const aceitos = [...achados.values()].filter(({ linha: l }) => {
      const setor = l.sector ?? "Sem setor";
      let motivo: string | null = null;
      if (perfil.evitar.includes(l.ticker)) motivo = "na lista de ativos a evitar";
      else if ((fracaoAtivo.get(l.ticker) ?? 0) > perfil.limite_ativo)
        motivo = "já acima do limite de concentração por ativo";
      else if ((fracaoSetor.get(setor) ?? 0) > perfil.limite_setor)
        motivo = `setor ${setor} já acima do limite de concentração`;
      if (motivo) excluidos.push({ ticker: l.ticker, motivo });
      return motivo === null;
    });

    const linhas = aceitos.map((a) => a.linha);
    const ordem = primeiroFiltro?.ordenar_por ?? "liquidez_diaria";
    const maiorMelhor = primeiroFiltro?.ordem !== "asc";
    const pontuados = aceitos
      .map((a) => ({ ...a, score: pontuar(a.linha, linhas, ordem, maiorMelhor) }))
      .sort((a, b) => b.score - a.score || a.linha.ticker.localeCompare(b.linha.ticker))
      .slice(0, CANDIDATOS_POR_CLASSE);

    const porCandidato = pontuados.length
      ? new Decimal(linha.aporte)
          .div(pontuados.length)
          .toDecimalPlaces(2, Decimal.ROUND_DOWN)
      : new Decimal(0);

    const candidatos = pontuados.map(({ linha: l, criterios, metodos, score }) => {
      datas.add(l.reference_date);
      const setor = l.sector ?? "Sem setor";
      const depoisAtivo = new Decimal(valorAtivo.get(l.ticker) ?? 0)
        .plus(porCandidato)
        .div(totalDepois)
        .toDecimalPlaces(6)
        .toNumber();
      const depoisSetor = new Decimal(valorSetor.get(setor) ?? 0)
        .plus(porCandidato)
        .div(totalDepois)
        .toDecimalPlaces(6)
        .toNumber();
      const riscos = riscosDe(l);
      if (depoisAtivo > perfil.limite_ativo)
        riscos.push("Passaria do limite de concentração por ativo");
      if (depoisSetor > perfil.limite_setor)
        riscos.push(`Setor ${setor} passaria do limite de concentração`);
      return {
        ticker: l.ticker,
        nome: l.name,
        setor,
        preco: l.preco,
        score,
        metodos,
        criterios,
        riscos,
        concentracao_antes: fracaoAtivo.get(l.ticker) ?? 0,
        concentracao_depois: depoisAtivo,
        setor_antes: fracaoSetor.get(setor) ?? 0,
        setor_depois: depoisSetor,
        data_dos_indicadores: l.reference_date,
        link: `/ativo/${l.ticker}`,
        ...(modo === "personal"
          ? {
              valor_sugerido: porCandidato.toFixed(2),
              cotas_estimadas: l.preco
                ? porCandidato.div(l.preco).floor().toNumber()
                : null,
            }
          : {}),
      };
    });

    classes.push({
      ...linha,
      candidatos,
      excluidos: excluidos.slice(0, 10),
      ...(candidatos.length === 0
        ? {
            sem_candidatos: `Nenhum ativo de ${linha.rotulo} passou nos critérios do perfil hoje.`,
          }
        : {}),
    });
  }

  return {
    modo,
    valor,
    carteira: { id: carteira.id, nome: carteira.nome },
    criterios_do_perfil: {
      metodos: perfil.metodos.map((m) => METODOS[m]),
      liquidez_minima: perfil.liquidez_minima,
      limite_ativo: perfil.limite_ativo,
      limite_setor: perfil.limite_setor,
    },
    nova_alocacao: plano.map((l) => ({
      classe: l.rotulo,
      antes: l.fracao_atual,
      depois: l.fracao_depois,
      alvo: l.fracao_alvo,
    })),
    classes,
    tickers_permitidos: classes.flatMap((c) => c.candidatos.map((x) => x.ticker)),
    datas_dos_indicadores: [...datas].sort(),
  };
}
