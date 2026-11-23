# ADR 0040 - Bolsiq Finanças: faturas e extratos em PDF e CSV

- **Status:** aceito
- **Data:** 2026-11-23
- **Decisores:** @leandrojtv

Complementa o [ADR 0032](0032-importacao-ofx-financas.md) (revisão, dedupe e
categorização), o [ADR 0038](0038-importacao-csv-c6.md) (fatura do C6 em CSV) e a
importação com IA da carteira ([ADR 0026](0026-importacao-com-ia.md) e
[0027](0027-importacao-ia-v2.md)), cujas decisões continuam valendo.

## Contexto

O Finanças lia OFX e a fatura do C6 em CSV. Os outros bancos exportam CSV com outro
cabeçalho, e muita fatura só existe em PDF (às vezes com senha, os dígitos do CPF)
ou como foto. Ler documento livre já é o que o assistente faz para a carteira:
anonimização, validação de origem, job em segundo plano no `portfolio-worker`, SSE,
cancelamento, BYOK, limite de custo e cache. Um segundo pipeline repetiria tudo isso
e divergiria na primeira correção.

## Decisão

**CSV fica no Finanças, sem IA.** Novos `LeitorDeExtrato` por layout (Nubank cartão
e conta, Inter e Itaú conta, além do C6) e um leitor genérico montado com o
mapeamento de colunas que o usuário salva para aquele cabeçalho
(`finance.csv_layouts`, chave `(user_id, assinatura)`, com RLS, exportação e
exclusão da conta). A assinatura é o cabeçalho normalizado: o mesmo banco exporta o
mesmo cabeçalho e a próxima importação lê sem perguntar. CSV sem leitor e sem
mapeamento volta na análise em `para_mapear`, com as colunas e uma amostra; o
mapeamento só fica salvo quando de fato lê um arquivo na criação da revisão.

**PDF e imagem pelo pipeline do assistente, com outro tipo de documento.** Um
`PerfilDeExtracao` troca só o que muda entre carteira e Finanças: o prompt
(`prompts/importacao-financas-v1.ts`, versionado e na chave do cache), o schema do
cabeçalho (`CabecalhoFinancasDaIA`, nove propriedades; o teste de no máximo 10
continua valendo) e o bloco CSV de linhas (`lancamentos`: data, descricao, valor,
sinal, parcela_atual, parcela_total, moeda_original, valor_moeda_original, mais a
origem). Lotes, retry, divisão de lote cortado, visão, OCR, anonimização, cache,
limite diário, autocorreção e consumo são os mesmos. `assistant.import_jobs` ganha
`documento` (`carteira` ou `financas`) e `carteira_id` passa a ser opcional, com
check que exige a carteira no job da carteira.

**Atalho sem IA para layouts conhecidos.** Antes do modelo, o texto já extraído e
anonimizado passa por `lerFaturaConhecida` (Nubank, Itaú, Inter e C6): banco pelo
cabeçalho, vencimento, fechamento e total por expressão regular, e cada linha com
data e valor vira um lançamento cujo trecho é a própria linha. Sem vencimento ou
sem linha, vai para a IA. O atalho grava a extração com provedor `atalho`, não
conta no limite diário nem custa.

**Validação do Finanças** (`validacao-financas.ts`), além da origem de sempre
(trecho no documento, valor e descrição no trecho, trecho com cara de instrução
recusado): data válida e não futura, sinal `debito` ou `credito`, linha de total ou
limite recusada sem voltar ao modelo, parcela sem sentido descartada com aviso. Em
seguida:

- pagamento da fatura anterior, estorno, saldo anterior e IOF são marcados
  (`marcacao`, também em `import_rows`). Saldo anterior chega desmarcado e nunca vira
  lançamento; pagamento segue a regra do ADR 0038 (conciliar ou transferência);
  estorno é crédito;
- compra internacional guarda moeda e valor de origem; o IOF fica em lançamento
  próprio com a categoria IOF, e quando o banco repete o nome da compra na linha do
  IOF ela ganha o prefixo `IOF`, como no CSV do C6;
- conferência do total da fatura: compras, IOF e tarifas menos estornos, sem
  pagamento e saldo anterior (que se anulam quando a anterior foi paga inteira),
  contra o total escrito. Diferença acima de R$ 0,05 vira aviso, e as linhas
  suspeitas (a do valor da diferença, as repetidas no mesmo dia e as que já vieram
  com aviso) aparecem destacadas na revisão. A mesma conta roda no Finanças
  (`conferirFatura`) sobre as `import_rows` de qualquer extrato que traga o total
  escrito (`total_informado`); o LEDGERBAL do OFX não entra, porque inclui saldo
  em aberto.

Lançamento não é deduplicado na junção dos lotes: dois cafés iguais têm o mesmo
trecho. A linha repetida pelo modelo aparece como suspeita na conferência.

**A mesma revisão.** O resultado vira um `ExtratoLido` (`extratoDaLeitura`) e entra
em `criarImportacaoDeExtratos`, a mesma função do OFX e do CSV: dedupe por hash,
parcela, vínculo com o plano de parcelas, categorização por regra, histórico e
banco. A linha de confiança baixa (lida de imagem) chega desmarcada com aviso.
`imports` guarda o `extracao_id` (proveniência) e o `total_informado`. A
categorização com IA, quando existir, entra no mesmo ponto e vale para essas
linhas; hoje a categorização é a determinística do ADR 0032.

**Senha do PDF só em memória, no envio.** O pedido dizia "no worker", mas levar a
senha ao worker exigiria passá-la pela fila do pg-boss ou pelo banco, que
persistem. Fica como o ADR 0027 já decidia: o BFF abre o PDF com `qpdf`
(`abrirArquivosDoEnvio`, senha por arquivo temporário com permissão 600, apagado ao
fim) e o job recebe só o PDF decifrado. O objeto que sai do envio não tem o campo
`senha` e nenhuma mensagem de erro a repete. Testes conferem que a senha não chega
ao job, ao banco (jobs, arquivos, extrações e consumo) nem ao log.

**Rotas** em `/api/financas/importacoes/ia` (envio, último job, estado, SSE,
confirmar custo, cancelar, leitura do arquivo e criação da revisão), no OpenAPI do
BFF do Finanças.

## Consequências

- Formato novo de CSV não exige código: o usuário mapeia uma vez. Layout de PDF
  novo começa pela IA e vira atalho quando o volume justificar.
- O mapeamento genérico não resolve IOF pareado nem a data da parcela movida, que
  são do formato de cada banco; o leitor próprio continua sendo o caminho para um
  banco popular.
- A fatura em PDF precisa do assistente configurado e do consentimento da
  importação, mesmo quando o atalho resolve sem chamar o modelo.
- A conferência do total supõe a fatura anterior paga inteira. Pagamento parcial,
  juros e saldo rotativo dão diferença legítima: o aviso explica e não bloqueia.
- O eval da importação (`make eval-importacao`) passa a medir também seis faturas e
  extratos (Nubank, Itaú, Inter com senha, C6, Santander e Bradesco): linhas
  extraídas, total conferido, acerto de parcela e de marcação. O modelo só é
  homologado se passar nos dois.

## Alternativas consideradas

- **Pipeline próprio no `packages/finance`.** Repetiria job, anonimização, retry,
  cache e validação de origem, e o `finance` passaria a depender de IA.
- **Senha na mensagem da fila.** O pg-boss grava o payload no Postgres; a senha
  ficaria em disco e em backup.
- **Deduplicar lançamento por trecho na junção dos lotes.** Apagaria compras
  legítimas repetidas no mesmo dia.
- **Mapeamento de CSV só no navegador.** Mais simples, mas o usuário mapearia o
  mesmo banco todo mês.
