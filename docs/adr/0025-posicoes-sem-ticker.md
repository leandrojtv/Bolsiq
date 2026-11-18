# 0025. Posições sem ticker e carga por fotografia

- Status: aceito
- Data: 2026-11-05

## Contexto e problema

A carteira nasce de transações: preço médio, resultado e TWR saem delas. Renda
fixa, Tesouro, fundos, previdência e COE não têm cotação nem histórico de
transações disponível: o que o investidor tem é o extrato da corretora, uma
fotografia numa data. Sem esses ativos, o patrimônio e a alocação ficam
incompletos. O mesmo extrato traz renda variável, que já tem modelo próprio.

## Decisão

Um terceiro formato de importação, `posicao_bolsiq`, com dois destinos:

- **Renda variável com ticker** (`acao`, `fii`, `bdr`, `etf`) continua sendo
  transação. Sem transação do ticker na corretora, a carga gera `saldo_inicial`,
  um aporte de capital na data do extrato ao preço médio. Com transação, nada é
  gerado sozinho: a divergência de quantidade vai para a revisão, e o usuário
  escolhe gerar ajuste ou ignorar.
- **Demais classes** vão para `portfolio.posicoes`, sem transação. A carga mais
  recente de uma corretora desliga (`vigente = false`) as linhas anteriores dela
  e nunca apaga: o histórico fica para o módulo de valorização.

Três escolhas que não são óbvias:

1. **Transação sem corretora conta como desta corretora.** O extrato da B3 não
   traz corretora, e `apurar` soma por ticker. Se "sem transação nessa corretora"
   ignorasse essas linhas, quem importou o extrato da B3 e depois a posição da XP
   teria a quantidade dobrada por um saldo inicial indevido. O custo é uma
   divergência falsa quando o ticker está em duas corretoras, e divergência é
   visível e ignorável; quantidade dobrada não.
2. **`cargas_de_posicao` guarda a última data por corretora.** `posicoes` não
   basta para recusar carga repetida: uma corretora só com renda variável não
   deixa linha nenhuma lá.
3. **A revisão não guarda estado.** O navegador envia o arquivo duas vezes, e o
   servidor refaz a comparação na confirmação: entre a revisão e o clique, a
   carteira pode ter mudado.

## Alternativas consideradas

- **Tudo em transações, com "compra" na data do extrato.** Daria um único caminho,
  mas renda fixa não tem preço de mercado para o snapshot, e o TWR registraria
  saltos sem sentido a cada recarga.
- **Gravar a renda variável também em `posicoes`.** Criaria duas verdades para a
  quantidade do mesmo ativo.
- **Substituir sem `vigente`, apagando a carga anterior.** Mais simples, mas perde
  a série que a valorização por curva vai precisar para conferir o cálculo.

## Consequências

- O patrimônio soma cotação (renda variável) e saldo do extrato (demais), com datas
  diferentes. A tela marca cada linha com "valor do extrato de DD/MM".
- O TWR segue só na renda variável: posição sem fluxo não tem retorno a medir. A
  tela diz isso. O "não realizado" também fica só na renda variável.
- `saldo_inicial` entra no custo e é fluxo no TWR, então não vira retorno.
- Transações anteriores à `data_posicao`, importadas depois do saldo inicial,
  dobram a quantidade. A divergência aparece na carga seguinte.
- Posições não são dado de mercado da regra 4: vêm do usuário, e a proveniência é
  a `importacao_id`.
- Valorização por curva, Tesouro e cota da CVM substituirá o saldo do extrato como
  valor atual, sem mudar a tabela.
