/**
 * Demonstrativos consolidados reais, extraidos do DFP 2024 da CVM
 * (dfp_cia_aberta_2024.zip, exercicio 2024-12-31), aplicando as tres regras:
 * ORDEM_EXERC = ULTIMO, maior VERSAO por conta, e ESCALA_MOEDA = MIL
 * multiplicando por 1000.
 *
 * Valores em reais. Contas usadas: 3.01 receita, 3.03 resultado bruto,
 * 3.05 EBIT, 3.11 lucro liquido, 1 ativo total, 1.01 ativo circulante,
 * 1.01.01 caixa, 2.01 passivo circulante, 2.03 PL, 2.01.04 + 2.02.01 divida
 * bruta, e "Depreciacao..." no DFC indireto.
 *
 * Numero de acoes de dfp_cia_aberta_composicao_capital_2024.csv, descontada a
 * tesouraria. A Vale fica sem acoes de proposito: naquele arquivo ela aparece
 * com 4.539.008 acoes, valor em milhares, enquanto Petrobras e WEG aparecem em
 * unidades. Preencher ali um numero ajustado por palpite transformaria uma
 * inconsistencia da fonte em verdade dentro do teste.
 */
export const DFP_2024 = {
  PETR4: {
    cvm_code: "009512",
    denominacao: "PETROLEO BRASILEIRO S.A. PETROBRAS",
    demonstrativo: {
      reference_date: "2024-12-31",
      receita: "490829000000",
      resultado_bruto: "246462000000",
      ebit: "137201000000",
      lucro_liquido: "37009000000",
      depreciacao_amortizacao: "67033000000",
      ativo_total: "1124797000000",
      ativo_circulante: "135212000000",
      caixa_equivalentes: "20254000000",
      passivo_circulante: "194808000000",
      patrimonio_liquido: "367514000000",
      divida_bruta: "373467000000",
    },
    acoes: 12_888_732_761,
  },
  VALE3: {
    cvm_code: "004170",
    denominacao: "VALE S.A.",
    demonstrativo: {
      reference_date: "2024-12-31",
      receita: "206005000000",
      resultado_bruto: "74687000000",
      ebit: "55459000000",
      lucro_liquido: "30431000000",
      depreciacao_amortizacao: "16525000000",
      ativo_total: "496325000000",
      ativo_circulante: "83476000000",
      caixa_equivalentes: "30671000000",
      passivo_circulante: "81055000000",
      patrimonio_liquido: "213720000000",
      divida_bruta: "96012000000",
    },
    acoes: null,
  },
  WEGE3: {
    cvm_code: "005410",
    denominacao: "WEG S.A.",
    demonstrativo: {
      reference_date: "2024-12-31",
      receita: "37986941000",
      resultado_bruto: "12813845000",
      ebit: "7690528000",
      lucro_liquido: "6318763000",
      depreciacao_amortizacao: "812485000",
      ativo_total: "41489701000",
      ativo_circulante: "27221359000",
      caixa_equivalentes: "7347599000",
      passivo_circulante: "15454265000",
      patrimonio_liquido: "23125217000",
      divida_bruta: "3595237000",
    },
    acoes: 4_195_537_378,
  },
} as const;
