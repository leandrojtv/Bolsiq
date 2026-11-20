# ADR 0036 - Assistente no Bolsiq Finanças: ferramentas próprias e contexto por módulo

- **Status:** aceito
- **Data:** 2026-11-20
- **Decisores:** @leandrojtv

Complementa o [ADR 0024](0024-assistente-byok.md) (assistente com a chave do usuário) e
usa o motor de insights do [ADR 0035](0035-insights-financas.md).

## Contexto

O assistente só conhecia ativos e carteira. No Bolsiq Finanças o usuário quer perguntar
quanto gastou num lugar, onde cortar, se uma compra parcelada cabe e quanto sobra para
investir. Os princípios do ADR 0024 continuam: chave do usuário, todo número vem de
ferramenta, o cálculo fica no código e o modelo só explica.

## Decisão

**Mesmo assistente, ferramentas por módulo.** A conversa grava o módulo
(`investimentos`, `financas` ou `painel`) na primeira mensagem e segue com ele:

| Módulo        | Prompt                                                       | Ferramentas       |
| ------------- | ------------------------------------------------------------ | ----------------- |
| investimentos | `sistema-v1`                                                 | as de antes       |
| financas      | `sistema-financas-v1`                                        | só as financeiras |
| painel        | os dois, mais a ponte `capacidade_aporte` → `sugerir_aporte` | as duas listas    |

O BFF tira o módulo da rota da tela (o mesmo critério do `AppShell`) para conversa nova.
Trocar de módulo com uma conversa aberta abre outra: prompt e ferramentas não mudam no
meio da conversa.

**`FontesFinanceiras`** é a interface das ferramentas financeiras, como `Fontes` nas de
investimento. A implementação sobre `packages/finance` (`fontesFinanceirasDoBanco`) fica em
`packages/assistant`, pela RLS do usuário, e serve ao BFF e ao worker do relatório; o eval
tem a sua, em memória. O `finance` não depende do `assistant`.

**Cálculo no código.** `src/financas/calculos.ts` faz o que o modelo faria de cabeça:

- `gastos_por_categoria` e `comparar_meses`: gasto é despesa realizada, sem aporte e sem
  pagamento de fatura (a compra já está no cartão).
- `listar_lancamentos`: busca sem acento e sem caixa; a soma é de tudo o que casou, não
  só das linhas mostradas (até 50).
- `sugerir_cortes`: entre os insights, assinatura (cancelar, 100%), efeito formiga
  (metade) e tarifas (100%). Primeiro os não essenciais, do que mais economiza para o que
  menos; os essenciais só se faltar. Gasto pontual (fora do padrão, compra atípica) não
  entra: não se repete. Essencial é o insight com mais da metade do valor das evidências em
  categoria essencial.
- `simular_compra`: parcelas a partir do mês seguinte (próxima fatura), o centavo do
  arredondamento na primeira. Veredito `nao_cabe` se o saldo projetado fica negativo;
  `apertado` se estoura o orçamento do mês, se as parcelas passam de 30% da renda prevista
  ou se o saldo já ficaria negativo sem a compra; senão `cabe`.
- `capacidade_aporte`: sobra média dos 3 meses completos anteriores, menos o aumento das
  parcelas dos próximos 3 meses sobre as já pagas, menos 1/12 do que falta para a reserva
  de emergência (6 meses de despesas essenciais, contra o saldo em conta).

**Consentimento por escopo.** `settings.consentimento_financas_em`, separado do de
investimentos: o texto antigo não cobria lançamentos e saldos. O Finanças pede o seu, o
Painel pede os dois. O texto diz o que vai: lançamentos (data, descrição, valor,
categoria, conta ou cartão), resumo do mês, orçamento, saldos e fluxo, parcelas,
assinaturas e insights.

**Nome de pessoa não vai ao provedor.** Descrição com PIX, TED, DOC, TEF ou
transferência: o que não é palavra do banco, número ou empresa (LTDA, S/A, ME...) vira
`[pessoa]`, e CPF vira `[documento]`. Vale para lançamentos, parcelas, assinaturas e o
texto dos insights (que repetem a descrição). Erra para o lado da privacidade: PIX para
loja sem sufixo de empresa também perde o nome.

**Relatório mensal, opt-in.** `settings.relatorio_mensal`, desligado por padrão. A tela de
configuração mostra o custo estimado (3.500 tokens de entrada e 600 de saída, ao preço do
modelo) antes de ligar, e ligar exige provedor próprio e o consentimento do Finanças. No
dia 1 (`ASSISTANT_REPORT_CRON`, padrão 08h00 em São Paulo), o `portfolio-worker`
enfileira um job por usuário (`assistant.relatorio_mensal`, uma nova tentativa só). O job
calcula o resumo do mês anterior, os 3 primeiros cortes de `sugerir_cortes` e a economia,
pede ao modelo um texto curto e confere os números com o mesmo `numerosInventados` do
eval: texto com número sem origem é descartado e vira o texto padrão, sem modelo. Mês sem
lançamento não chama o modelo. O consumo entra em `assistant.usage` com `origem =
relatorio`, e `relatorio_ultimo_mes` impede gerar duas vezes.

**O sino é do `alerts`.** O relatório entra por `avisarNoSino`, do pacote `alerts`: grava a
notificação (`rule_id = sistema:<origem>`, `event_id = <usuario>:<mes>`, única) e a
entrega in-app; o `alerts-worker` envia como as demais.

## Consequências

- O eval cobre as perguntas do Finanças (gasto, comparação, compra parcelada, onde
  cortar) com o mesmo critério: ferramenta certa e nenhum número sem origem. Mudar
  `sistema-financas-v1` pede nova rodada de `make eval-assistente`.
- Regras com limiar fixo (30% da renda, 6 meses de reserva, metade do efeito formiga)
  erram nas bordas; ficam no código, testadas e citadas na resposta.
- Conversas antigas são de investimentos (padrão da coluna).
- Os dados do Finanças saem para o provedor escolhido, com o consentimento próprio; quem
  não quer pode usar Ollama local.

## Alternativas consideradas

- **Um assistente separado para finanças.** Duplicaria chave, limites, consumo e
  histórico; o módulo na conversa resolve com uma coluna.
- **Todas as ferramentas em todo módulo.** Mais tokens por chamada e mais chance de o
  modelo escolher a ferramenta errada; o Painel é o único lugar que precisa das duas.
- **Relatório escrito só pelo código.** Barato, mas é o que o usuário pediu ao ligar o
  assistente; o texto padrão fica como rede quando o modelo falha.
- **Anonimizar com o modelo.** Mandaria o nome justamente para quem não deve recebê-lo.
