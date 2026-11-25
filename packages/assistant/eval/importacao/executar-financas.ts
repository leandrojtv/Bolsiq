import type { LanguageModel } from "ai";
import { Decimal } from "decimal.js";
import {
  SenhaIncorreta,
  type FerramentasDoSistema,
} from "../../src/importacao/ferramentas.js";
import { prepararArquivo, type Capacidades } from "../../src/importacao/pipeline.js";
import type { ArmazemDeImportacao } from "../../src/importacao/servico.js";
import {
  importarFinancasComIA,
  type ResultadoDaLeituraFinancas,
} from "../../src/importacao/servico-financas.js";
import {
  armazemEmMemoria,
  CAPACIDADES_COMPLETAS,
  verificadorDasFixtures,
} from "./executar.js";
import { HOJE } from "./fixtures.js";
import type { FixtureDeFinancas } from "./fixtures-financas.js";

/** qpdf de mentira: a senha certa devolve o mesmo PDF sem cifra. */
export function ferramentasDeFinancas(f: FixtureDeFinancas): FerramentasDoSistema {
  return {
    decifrarPdf: (pdf, senha) => {
      if (!f.senha || !f.decifrado) return Promise.resolve(pdf);
      if (senha !== f.senha) return Promise.reject(new SenhaIncorreta());
      return Promise.resolve(f.decifrado());
    },
  };
}

export async function executarFixtureDeFinancas(
  f: FixtureDeFinancas,
  modelo: LanguageModel,
  o: {
    /** Forca a IA mesmo com layout conhecido. */
    sem_atalho?: boolean;
    capacidades?: Capacidades;
    armazem?: ArmazemDeImportacao;
    provedor?: string;
    nome?: string;
  } = {},
): Promise<ResultadoDaLeituraFinancas> {
  const capacidades = o.capacidades ?? CAPACIDADES_COMPLETAS;
  const ferramentas = ferramentasDeFinancas(f);
  let entrada = f.arquivo();
  // Fatura com senha: o envio decifra com a senha do usuario antes de ler.
  if (f.senha && "bytes" in entrada && ferramentas.decifrarPdf)
    entrada = {
      ...entrada,
      bytes: await ferramentas.decifrarPdf(entrada.bytes, f.senha),
    };
  const arquivo = await prepararArquivo(entrada, {
    limites: { contexto: capacidades.contexto, max_saida: capacidades.max_saida },
    visao: capacidades.visao,
    ferramentas,
  });
  return importarFinancasComIA({
    arquivo,
    original: null,
    modelo,
    provedor: o.provedor ?? "roteiro",
    nome_do_modelo: o.nome ?? "roteiro",
    preco: { entrada: 1, saida: 2 },
    capacidades,
    armazem: o.armazem ?? armazemEmMemoria().armazem,
    verificador: verificadorDasFixtures(),
    hoje: HOJE,
    limite_diario: 100,
    aceitou_enviar_imagem: true,
    espera_base_ms: 1,
    segredos: [],
    ...(o.sem_atalho ? { sem_atalho: true } : {}),
  });
}

export interface MedidaDeFinancas {
  id: string;
  /** Lida pelo layout conhecido, sem IA. */
  atalho: boolean;
  linhas_esperadas: number;
  linhas_extraidas: number;
  faltantes: string[];
  inventadas: string[];
  /** A conferencia do total deu o que a fixture espera (null: extrato). */
  total_conferido: boolean;
  parcelas_esperadas: number;
  parcelas_certas: number;
  marcacoes_certas: number;
  marcacoes_esperadas: number;
  erro: string | null;
}

const chave = (l: { data: string; valor: string; sentido: string }) =>
  `${l.data}|${new Decimal(l.valor).toFixed(2)}|${l.sentido}`;

export function medirFinancas(
  f: FixtureDeFinancas,
  r: ResultadoDaLeituraFinancas | null,
  erro: string | null = null,
): MedidaDeFinancas {
  const esperadas = f.esperado.linhas;
  const parcelas = esperadas.filter((e) => e.parcela).length;
  const marcacoes = esperadas.filter((e) => e.marcacao).length;
  if (!r)
    return {
      id: f.id,
      atalho: false,
      linhas_esperadas: esperadas.length,
      linhas_extraidas: 0,
      faltantes: esperadas.map(chave),
      inventadas: [],
      total_conferido: false,
      parcelas_esperadas: parcelas,
      parcelas_certas: 0,
      marcacoes_certas: 0,
      marcacoes_esperadas: marcacoes,
      erro,
    };
  const obtidas = [...r.validacao.linhas];
  const faltantes: string[] = [];
  let extraidas = 0;
  let parcelasCertas = 0;
  let marcacoesCertas = 0;
  for (const e of esperadas) {
    const i = obtidas.findIndex((o) => chave(o) === chave(e));
    if (i === -1) {
      faltantes.push(chave(e));
      continue;
    }
    const [o] = obtidas.splice(i, 1);
    extraidas++;
    if (
      e.parcela &&
      o?.parcela?.atual === e.parcela[0] &&
      o.parcela.total === e.parcela[1]
    )
      parcelasCertas++;
    if (e.marcacao && o?.marcacao === e.marcacao) marcacoesCertas++;
  }
  const confere = r.validacao.conferencia?.confere ?? null;
  return {
    id: f.id,
    atalho: r.atalho,
    linhas_esperadas: esperadas.length,
    linhas_extraidas: extraidas,
    faltantes,
    inventadas: obtidas.map(chave),
    total_conferido: confere === f.esperado.total_confere,
    parcelas_esperadas: parcelas,
    parcelas_certas: parcelasCertas,
    marcacoes_certas: marcacoesCertas,
    marcacoes_esperadas: marcacoes,
    erro,
  };
}

/**
 * Aprovado: pelo menos 95% das linhas e das parcelas, nenhuma linha inventada,
 * todo total conferido como o esperado e toda marcacao certa (pagamento, estorno
 * e saldo anterior que viram despesa estragam o orcamento).
 */
export function resumirFinancas(medidas: MedidaDeFinancas[]) {
  const soma = (k: keyof MedidaDeFinancas) =>
    medidas.reduce((s, m) => s + (m[k] as number), 0);
  const linhas = soma("linhas_extraidas") / Math.max(1, soma("linhas_esperadas"));
  const parcelas = soma("parcelas_certas") / Math.max(1, soma("parcelas_esperadas"));
  const inventadas = medidas.reduce((s, m) => s + m.inventadas.length, 0);
  const totais =
    medidas.filter((m) => m.total_conferido).length / Math.max(1, medidas.length);
  const marcacoes = soma("marcacoes_certas") / Math.max(1, soma("marcacoes_esperadas"));
  return {
    fixtures: medidas.length,
    linhas_extraidas: Number(linhas.toFixed(4)),
    total_conferido: Number(totais.toFixed(4)),
    acerto_de_parcela: Number(parcelas.toFixed(4)),
    acerto_de_marcacao: Number(marcacoes.toFixed(4)),
    linhas_inventadas: inventadas,
    aprovado:
      medidas.length > 0 &&
      linhas >= 0.95 &&
      parcelas >= 0.95 &&
      inventadas === 0 &&
      totais === 1 &&
      marcacoes === 1,
  };
}
