# ADR 0035 - Bolsiq Finanças: insights determinísticos de gastos

- **Status:** aceito
- **Data:** 2026-11-20
- **Decisores:** @leandrojtv

Complementa os ADRs [0031](0031-bolsiq-financas.md) a
[0034](0034-parcelamentos-dividas-fluxo-metas.md).

## Contexto

O usuário vê os números do mês, mas não onde mais gasta, o que é desnecessário e
onde dá para economizar. A IA (Prompt 7) vai explicar e priorizar, mas não pode
inventar número: precisa de achados calculados, reproduzíveis e que apontem os
lançamentos que os geraram.

## Decisão

**Insights são funções puras.** `packages/finance/src/insights` tem um detector por
tipo, sem banco e sem relógio (o `hoje` e o mês entram como parâmetro). Todos
devolvem o mesmo formato: `id, tipo, titulo, descricao, impacto_mensal,
impacto_anual, severidade, evidencias (transaction_ids), acao_sugerida, periodo` e
`dados` com os números do detector. A lista sai ordenada por impacto anual, depois
severidade, depois id. O id é determinístico (FNV-1a da chave do achado): o mesmo
achado tem o mesmo id em todo recálculo, e é isso que permite guardar a resposta do
usuário.

- **Ranking.** Categorias e estabelecimentos do mês por valor, % do gasto e da renda, e quantos itens somam 80%. Informativo: impacto zero.
- **Assinaturas.** Mesma descrição normalizada, intervalo de 28 a 35 dias (3 cobranças ou mais) ou de 360 a 370 (2 ou mais), variação de até 10% entre cobranças seguidas e um único degrau de até 30% (o reajuste). Qualquer cobrança fora do ritmo quebra a cadeia: dois cafés no mesmo dia não viram assinatura. Fora: tarifa, parcela, categoria essencial (aluguel, escola) e assinatura parada além do ciclo + folga. Sinais: reajuste (último valor acima da média anterior), possível duplicidade (2 ou mais no mesmo serviço conhecido, como streaming, ou na mesma categoria não genérica) e nova (só o mínimo de cobranças, nenhuma antes, e a que completou o mínimo nos últimos 60 dias).
- **Tarifas e juros.** 12 meses de categorias de sistema (Tarifas bancárias, Juros e encargos, IOF) e de descrições com ANUIDADE, TARIFA, PACOTE, JUROS, ENCARGO, MULTA, MORA, ROTATIVO ou IOF. Rotativo e multa em destaque e severidade alta. Tarifa nova: descrição que aparece pela primeira vez nos últimos 60 dias.
- **Efeito formiga.** Despesas variáveis abaixo do limite (padrão R$ 50) nos últimos 90 dias, por estabelecimento; entram os hábitos (3 vezes ou mais), sem assinatura nem tarifa. Frequência mensal e projeção anual pela média.
- **Fora do padrão.** Categoria do mês acima da mediana dos 6 meses anteriores por mais de 1,5 MAD e pelo menos R$ 100 (mês sem lançamento conta zero; exige 3 meses com dados). Compra maior que 3x a mediana das anteriores no mesmo estabelecimento (pelo menos 3). O excesso é pontual: impacto anual igual ao mensal.
- **Essencial x supérfluo.** % da renda do mês em essenciais (marca da categoria), não essenciais e poupança (categoria de investimento ou entrada em poupança e corretora), contra 50/30/20 (configurável). Impacto: o que passa da referência nos não essenciais.
- **Custo de oportunidade.** Valor futuro de aportes mensais em 5 e 10 anos a 100% do CDI do último ponto de `/v1/macro/cdi` (BCB SGS 12, % ao dia útil, anualizado por 252 dias). A tela mostra a premissa, a data e a fonte.
- **Simulador de cortes.** Assinaturas, categorias com redução % (sobre a média dos 3 meses completos anteriores) e efeito formiga. Economia mensal e anual, fluxo projetado (ADR 0034) com a economia a partir do mês seguinte e meses de antecipação de cada meta, supondo que o usuário guarde o valor mensal que a meta pede mais a economia. Roda no navegador sobre a base que o BFF calcula.

**O finance não acessa fonte externa.** O CDI vem do `/v1/macro/cdi` do market-data,
que já tinha a série com proveniência; o web busca e passa a taxa ao módulo.

**Cache por usuário e mês** (`finance.insights`). Guarda a lista, as assinaturas
detectadas, as chaves já anunciadas e uma marca dos dados (dia do cálculo,
quantidade e última mudança dos lançamentos). Ler com a marca diferente recalcula:
lançar, editar, apagar ou virar o dia invalida sem gatilho espalhado pelo módulo.
Mudar os ajustes apaga o cache do usuário.

**Resposta do usuário** (`insight_feedback`, única por insight): `dispensado`,
`ainda_uso`, `vou_cancelar` e `ja_cancelei`, com a data e o impacto anual do momento.
Dispensado e "ainda uso" somem por 90 dias, a não ser que o impacto anual suba mais
de 20%. "Já cancelei" some até aparecer cobrança depois da resposta. "Vou cancelar"
continua visível com a marca. "Transformar em recorrente" cria a recorrência a
partir da próxima cobrança e marca "ainda uso". Ajustes por usuário em
`insight_settings` (limite do efeito formiga e referência, que soma 100).

**Recálculo.** Job `finance.insights` no `portfolio-worker` (pg-boss): com
`{ user_id }`, enfileirado pelo BFF logo depois de gravar
`finance.importacao.confirmada.v1`; sem usuário, pelo cron diário
`FINANCE_INSIGHTS_CRON` (padrão 03h40, depois da rotina das recorrências). O outbox
do finance ainda não tem publicador (ADR 0032), então o gatilho da importação é o
envio direto para a fila, na mesma requisição que confirma.

**Evento `finance.insight.novo.v1`** no outbox do finance, só no mês corrente, para
assinatura nova, reajuste e tarifa nova. A chave do anúncio (`reajuste:<id>:<valor>`,
`tarifa_nova:<descrição>:<data>`) fica no cache: o mesmo fato não vira dois eventos,
e um novo reajuste da mesma assinatura vira outro. O Prompt 8 transforma em alerta;
o catálogo de `packages/contracts` e o stream `FINANCE` entram com o publicador.

## Consequências

- O mesmo dado dá o mesmo insight, com os lançamentos que o geraram: a IA explica
  e prioriza, não calcula.
- A primeira leitura do dia ou depois de uma mudança custa um recálculo (13 meses de
  lançamentos de um usuário, em memória). Se pesar, o job passa a ser o único
  caminho e a leitura aceita o cache velho.
- Regras com limiares fixos erram nas bordas: assinatura com reajuste acima de 30%
  reinicia a cadeia, e a conta de luz estável (variação até 10%) seria tratada como
  assinatura se não estivesse numa categoria essencial.
- A exclusão da conta (LGPD) apaga cache, respostas e ajustes; os eventos saem do
  outbox pelo `user_id` do payload, como os da importação.

## Alternativas consideradas

- **IA calculando os insights.** Resultado não reproduzível, sem evidência confiável
  e caro a cada abertura de tela.
- **Insight como linha por achado no banco.** Mais fácil de consultar, mas cada
  recálculo viraria diff de linhas; a lista inteira em `jsonb` por mês é o que a
  tela e a IA leem, e a resposta do usuário fica à parte, pelo id determinístico.
- **Gatilho pelo NATS.** Esperaria o publicador do outbox do finance, que ainda não
  existe; a fila do pg-boss já está no worker.
