# ADR 0038 - Bolsiq Finanças: fatura do C6 em CSV

- **Status:** aceito
- **Data:** 2026-11-20
- **Decisores:** @leandrojtv

Complementa o [ADR 0032](0032-importacao-ofx-financas.md) (importação OFX) e o
[ADR 0034](0034-parcelamentos-dividas-fluxo-metas.md) (parcela importada).

## Contexto

O C6 Bank exporta a fatura do cartão só em CSV:

```
Data de Compra;Nome no Cartão;Final do Cartão;Categoria;Descrição;Parcela;Valor (em US$);Cotação (em R$);Valor (em R$)
30/05/2026;TITULAR EXEMPLO;1111;Assistência médica e odontológica;CLINICA SORRISO;6/7;0;0;155.71
11/10/2026;TITULAR EXEMPLO;2222;-;"Inclusao de Pagamento    ";Única;0;0;-6661.61
```

O arquivo não tem FITID nem saldo, a data da parcela é a da compra original, o
pagamento da fatura anterior vem como valor negativo, o IOF de compra
internacional é uma linha à parte com o mesmo nome, e a mesma fatura mistura o
cartão principal, os adicionais e o virtual. O nome do arquivo traz o vencimento
(`Fatura_2026-11-10.csv`).

## Decisão

**Mais um `LeitorDeExtrato`**, `csv-c6`, reconhecido pelo cabeçalho (colunas
achadas pelo nome, sem acento). A revisão, a deduplicação e a confirmação são as
do ADR 0032. `LinhaLida` ganha dois campos opcionais, que o OFX não preenche:
`parcela` (da coluna, e então a descrição não é procurada) e
`categoria_sugerida` (nome de categoria padrão). `ExtratoLido` ganha
`vencimento`, e o leitor recebe o nome do arquivo.

**Parcela no mês dela.** A parcela `n/N` recebe a data da compra mais `n - 1`
meses, a mesma convenção do OFX, de que dependem o hash, a busca da parcela
prevista no plano e a `primeira_data` do plano criado. Se a data movida passa do
vencimento, o banco já mandou a data da cobrança (a anuidade `5/12` vem com a
data do mês) e ela fica como está.

**Pagamento nunca vira receita.** Crédito de cartão com descrição de pagamento
(`INCLUSAO DE PAGAMENTO` entrou em `pareceTransferencia`) segue esta ordem:

1. transferência já lançada para o cartão, com o mesmo valor e até 3 dias de
   diferença: `conciliar` (regra que já existia);
2. senão, transferência da conta que paga o cartão ou, sem ela, da única conta
   ativa do mesmo banco;
3. senão, a linha chega desmarcada, e confirmar com ela marcada e sem conta é
   recusado (422).

Vale também para o OFX de cartão.

**Categoria do banco como sugestão.** O rótulo do C6 (o da bandeira) é mapeado
para uma categoria padrão por palavras; rótulo vago (`Empresa para empresa`,
`Serviços Profissionais`, `-`) fica sem. Entra depois de regra e histórico, com
`origem_categoria = "banco"`, e só se o usuário tem uma categoria com aquele
nome. IOF vai para `IOF` e anuidade para `Tarifas bancárias`.

**IOF.** Linha em reais com o mesmo nome e data de uma compra em dólar, pareada
uma a uma, ganha o prefixo `IOF` na descrição: separa as duas no hash e na
categorização.

**Vários finais, um cartão.** A fatura é uma só no banco: tudo entra no cartão e
na fatura escolhidos. A análise sugere o cartão cujo final é qualquer um dos do
arquivo e avisa quantos finais há. O vencimento do nome do arquivo, ajustado ao
dia de vencimento do cartão, é a fatura sugerida.

## Consequências

- Sem FITID, a deduplicação é só pelo hash; reimportar a mesma fatura grava zero
  linhas (teste de integração).
- A parcela seguinte, na próxima fatura, concilia com a prevista pelo plano.
- Uma compra feita depois do fechamento pode ficar com a data da parcela um mês
  antes da cobrança real; a fatura, que é a escolhida, não muda.
- O total da fatura não vem no arquivo: a revisão mostra compras e créditos para
  conferir com o app do banco, e `total_informado` fica vazio.
- Banco que mude o cabeçalho deixa de ser reconhecido e o envio falha com
  "Formato não suportado", em vez de ler colunas trocadas.

## Alternativas consideradas

- **Leitor genérico de CSV com mapeamento de colunas pelo usuário.** Atende
  qualquer banco, mas pede uma tela de mapeamento e não resolve parcela, IOF e
  pagamento, que são do formato de cada banco.
- **Manter a data da compra original na parcela.** Fiel ao arquivo, mas joga a
  parcela no mês da compra (orçamento e competência errados) e erra a
  `primeira_data` do plano criado, que supõe a data da parcela.
- **Uma fatura por final de cartão.** O banco cobra uma fatura só; separar exigiria
  cadastrar cada adicional e o virtual, que muda.
