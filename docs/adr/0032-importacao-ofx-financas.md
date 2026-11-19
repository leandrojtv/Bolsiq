# ADR 0032 - Bolsiq Finanças: importação de extrato e fatura em OFX

- **Status:** aceito
- **Data:** 2026-11-19
- **Decisores:** @leandrojtv

Complementa o [ADR 0031](0031-bolsiq-financas.md). A importação da carteira
([ADR 0026](0026-importacao-com-ia.md) e [0027](0027-importacao-ia-v2.md)) serviu de
referência para a revisão antes de gravar e para os limites por variável de ambiente.

## Contexto

Lançar à mão cada compra de cartão e cada débito da conta não escala. Todo banco
brasileiro exporta OFX, mas cada um com uma variação: SGML sem tag de fechamento
(Itaú, BB, C6), XML (Inter), latin1 declarado e UTF-8 enviado, vírgula decimal,
data com e sem fuso, FITID ausente ou trocado a cada exportação. O usuário vai
importar o mesmo período mais de uma vez, e às vezes já lançou à mão parte do que
está no arquivo.

A importação precisa de destino cartão, e cartões e faturas ainda não existiam no
módulo.

## Decisão

**Leitor por formato atrás de uma interface.** `LeitorDeExtrato` recebe o texto e
devolve um `ExtratoLido` (tipo conta ou cartão, banco, conta, período, saldo
informado e linhas). Revisão, deduplicação e categorização só conhecem
`ExtratoLido`: CSV e PDF entram como novos leitores em `LEITORES`. O OFX é lido
por um único tokenizador de tags que trata folha (tag seguida de texto) e
agregado (tag sem texto), servindo a 1.x e 2.x. Bytes viram texto por UTF-8
estrito e, se falhar, windows-1252; o cabeçalho do arquivo não é confiável.
Fixtures anonimizadas de Nubank, Itaú, Inter, C6 e Banco do Brasil, conta e
cartão, ficam em `packages/finance/src/importacao/fixtures`.

**Cartões e faturas mínimos.** `cards` com dia de fechamento e de vencimento, e
`statements` identificadas pelo vencimento, criadas sob demanda. Compra antes do
dia do fechamento entra na fatura seguinte; no dia ou depois, na próxima.
Lançamento pertence a uma conta **ou** a um cartão (check no banco), e o de
cartão leva a fatura. Pagamento de fatura é transferência da conta (saída) para o
cartão (entrada). A FK da fatura no lançamento é `(user_id, card_id,
statement_id)`: a fatura tem de ser do mesmo cartão.

**Revisão persistida.** O envio grava `imports` (status `revisao`) e uma
`import_rows` por linha, com o detectado (FITID, valor, descrição original e
normalizada, parcela, situação, categoria sugerida e de onde veio) separado do
que o usuário escolheu (ação, categoria, transferência, divisão). A revisão
sobrevive a recarregar a página. Status: `revisao`, `confirmada`, `cancelada` e
`desfeita` (este além dos três pedidos, para o histórico mostrar o desfazer).

**Deduplicação em duas camadas, por destino.**

1. FITID, com índice único parcial por `(user_id, account_id, fitid)` e
   `(user_id, card_id, fitid)`.
2. Hash SHA-256 de `user_id | destino | data | valor com sinal | descrição
normalizada | ordinal`, para FITID ausente ou trocado. O ordinal é a ocorrência
   da mesma combinação no arquivo: dois cafés iguais no mesmo dia são duas linhas,
   e o mesmo dia exportado de novo dá os mesmos ordinais.

Linha que casa vira `ja_importada` e vem desmarcada. Lançamento sem FITID nem
hash no destino (lançado à mão) com mesma data, valor e descrição parecida, ou
transferência com mesmo valor em até 3 dias, vira `possivel_duplicata` com ação
`conciliar`: a confirmação grava o FITID e o hash nele em vez de criar outro, e a
próxima importação o reconhece.

**Categorização determinística, nesta ordem:** regras do usuário por prioridade
(menor primeiro), regras aprendidas, a categoria que o usuário já deu à mesma
descrição normalizada, e sem categoria. Corrigir a categoria na revisão oferece
"aplicar às iguais" e "criar regra" (do usuário). Na confirmação, cada correção
vira regra aprendida, salvo se uma regra do usuário já casa com a descrição;
regra aprendida nunca sobrescreve regra do usuário (`ON CONFLICT ... WHERE origem
= 'aprendida'`). A regex do usuário roda só sobre os 300 primeiros caracteres da
descrição normalizada, com padrão de até 200.

**Confirmação numa transação.** Lançamentos, conciliações, contagem de uso das
regras, regras aprendidas, status e o evento `finance.importacao.confirmada.v1`
no outbox. A primeira instrução troca o status de `revisao` para `confirmada`
com `WHERE status = 'revisao'`: duas confirmações simultâneas não gravam em dobro.
Desfazer apaga os lançamentos com o `importacao_id` e solta as conciliações,
desde que nenhum esteja `conciliado`.

**Evento sem publicador por enquanto.** O nome segue o padrão `<domínio>.<entidade>.<ação>.vN`
do [ADR 0008](0008-outbox-e-jetstream.md) (o pedido original dizia
`finance.importacao_confirmada`). Fica no outbox do schema `finance` e entra no
catálogo de `packages/contracts` com o stream `FINANCE` e o publicador quando houver
o primeiro consumidor (Painel geral ou insights); o catálogo exige consumidor
declarado. A exclusão da conta apaga do outbox os eventos com o `user_id`.

**Limites por variável de ambiente** (`FINANCE_IMPORT_MAX_MB`,
`FINANCE_IMPORT_MAX_ROWS`, `FINANCE_IMPORT_MAX_FILES`), conferidos no BFF antes de
ler os bytes e de novo no módulo. OFX é pequeno: o processamento é síncrono, sem
fila.

## Consequências

- O mesmo arquivo importado duas vezes grava zero linhas na segunda, e períodos
  sobrepostos só gravam o novo, mesmo com FITID trocado (teste de integração).
- Um lançamento manual com descrição muito diferente da do banco não é achado
  como possível duplicata e entra em dobro; o usuário vê os dois e apaga um.
- Banco que muda a descrição entre exportações (raro) quebra o hash; o FITID
  cobre esse caso quando existe.
- A divisão em duas categorias grava dois lançamentos; só o primeiro leva o
  FITID, e o segundo, o hash com sufixo `:2`.

## Alternativas consideradas

- **Parser OFX de terceiros.** Os pacotes mantidos tratam OFX 2 (XML) e quebram no
  SGML sem fechamento que metade dos bancos exporta; o tokenizador próprio tem
  menos de 200 linhas e cobre os dois com as fixtures.
- **Revisão só no navegador, sem gravar.** Mais simples, mas perde a revisão ao
  recarregar e obriga a refazer a deduplicação no servidor de qualquer jeito.
- **Hash sem ordinal.** Dois lançamentos idênticos no mesmo dia viram um só.
