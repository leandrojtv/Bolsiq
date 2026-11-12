# ADR 0028 - Sinais verde, amarelo e vermelho dos indicadores

- **Status:** aceito
- **Data:** 2026-11-11
- **Decisores:** @leandrojtv

## Contexto

A plataforma calcula P/L, P/VP, EV/EBITDA, ROE, margens, dívida, Graham, Bazin e, no
gráfico, médias móveis e IFR. A tela mostrava os números sem leitura, e o assistente
recebia os indicadores soltos: sem MM e IFR (que só existiam no navegador) e sem faixa.
Cada resposta do modelo podia usar uma faixa diferente de "barato" e "caro", e o
usuário não tinha como saber se um P/L de 12 é bom.

## Decisão

**A classificação é código do analytics, não texto do modelo.** `@bolsiq/analytics/puro`
ganha:

- `sinais.ts`: uma regra por indicador (sentido, limite do verde, limite do amarelo,
  leitura de cada faixa e tratamento de valor negativo). `avaliarIndicador` devolve
  `{ nivel, leitura }`; `ajudaDoIndicador` devolve a descrição e as três faixas, que
  são o helper da tela.
- `tecnicos.ts`: `mediaMovel` e `ifr` saem de `apps/web/lib` e passam a ser a fonte única;
  `sinaisTecnicos` dá MM 20/50/200 e IFR 14 do último pregão, com sinal de tendência
  (MM 50 x MM 200), curto prazo (MM 20 x MM 50) e IFR (abaixo de 30 sobrevendido,
  acima de 70 sobrecomprado).

A tela do ativo e o assistente usam as mesmas funções:

- Tela: ponto colorido em cada indicador, botão "?" com o helper, veredito em Graham e
  Bazin ("Indica compra", "Desconto pequeno", "Acima do justo") e card "Sinais técnicos".
- Assistente: `indicadores` devolve `sinais`; nova ferramenta `analise_tecnica`; o prompt
  v2 manda usar o nível e a leitura devolvidos, sem criar faixa própria.

As faixas são referências gerais de mercado: Graham (P/L até 15, P/VP até 1,5, margem
de segurança de 20%), Bazin (DY de 6%, preço até o teto) e as faixas usuais de análise
fundamentalista na B3. Não há regra por setor.

## Consequências

- Mudar uma faixa é mudar `sinais.ts` e o teste; tela e assistente mudam juntos.
- Banco, seguradora e elétrica têm faixas próprias (ROA baixo, dívida alta por natureza).
  A tela avisa na legenda e o prompt manda avisar. Faixa por setor fica para depois, se
  houver demanda.
- IFR sobrevendido aparece verde (possível entrada) e sobrecomprado vermelho. É a
  leitura clássica; não considera tendência. O card mostra os três sinais lado a lado
  para o usuário ver quando divergem.
- A página do ativo busca 14 meses de histórico para a MM 200, além dos 6 meses do
  gráfico; o `fetch` do Next guarda os dois em cache.
- Prompt v1 vira v2: a homologação dos modelos precisa de nova rodada de
  `make eval-assistente`.
- Os sinais continuam com "Não é recomendação"; no modo educacional o prompt segue
  proibindo linguagem de recomendação.
