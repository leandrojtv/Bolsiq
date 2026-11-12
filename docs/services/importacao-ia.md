# Importação com IA

"Importar com IA (qualquer formato)" na tela de importação da carteira. O usuário envia
vários arquivos de uma vez (PDF, CSV, XLSX, XLS, ODS, TXT, foto, inclusive HEIC) ou cola
o texto, de qualquer banco ou corretora. O modelo configurado no [assistente](assistant.md)
converte para os layouts que já existem ([portfolio](portfolio.md#layout-de-posicao)); os
validadores de sempre conferem; o resultado entra numa revisão em três grupos. **A IA
nunca grava: só propõe linhas.** Decisões no [ADR 0026](../adr/0026-importacao-com-ia.md)
e no [ADR 0027](../adr/0027-importacao-ia-v2.md) (v2: segundo plano, qualquer modelo,
OCR, autocorreção e política de preenchimento).

| Onde                                              | O quê                                  |
| ------------------------------------------------- | -------------------------------------- |
| `packages/assistant/src/importacao`               | pipeline, job, validação, política     |
| `services/portfolio-worker/src/importacao.ts`     | fila `assistant.importacao` (pg-boss)  |
| `apps/web/lib/importacao-ia.ts`                   | BFF: cria o job, lê, revisa e confirma |
| `apps/web/componentes/carteira/ImportarComIA.tsx` | tela                                   |

## Fluxo

```
tela        envia N arquivos, corretora por arquivo (sugerida pelo nome) e senha do PDF
web         recebimento (limites, tipo, hash); PDF com senha: qpdf decifra, a senha some
            atalho por arquivo (CSV Bolsiq, extrato B3, posicao_bolsiq): sem IA, sem job
            o resto: grava import_jobs + import_job_files e enfileira
worker      por arquivo, em sequência:
  lendo       texto sem IA por tipo (abaixo); conta páginas; estima o custo
              acima de ASSISTANT_IMPORT_CONFIRM_USD: para em aguardando_confirmacao
  ocr         páginas sem texto, se o modelo não tem visão
  analisando  cabeçalho (1 chamada) e lotes de linhas (3 em paralelo)
  corrigindo  até 2 rodadas de autocorreção das linhas recusadas
  validando   normalização, origem, política de preenchimento, layout, market-data,
              conciliação por seção
  pronto      resultado gravado no arquivo do job
tela        SSE com o progresso; revisão por arquivo; confirmação grava e apaga o arquivo
```

O job é assíncrono: arquivo de 40 MB e 200 páginas não segura requisição HTTP. O web não
chama o provedor; só o worker chama.

## Leitura por tipo de arquivo

| Tipo           | Como                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| PDF            | pdf.js por página; o que ele não abre, `pdftotext` (poppler)                                                                               |
| PDF com senha  | a tela pede a senha; `qpdf --decrypt` no web, na hora do envio; a senha não é gravada                                                      |
| PDF escaneado  | página sem texto: visão, se o modelo vê imagem; senão `pdftoppm` + `tesseract -l por`                                                      |
| XLSX, XLS, ODS | SheetJS; células mescladas expandidas, linhas e colunas vazias fora, cabeçalho na primeira linha com cara de cabeçalho; uma tabela por aba |
| CSV, TXT       | UTF-8, senão windows-1252 (latin1); separador detectado (`detectarSeparador`)                                                              |
| Imagem         | HEIC vira PNG (`heif-convert`); visão se houver, senão OCR                                                                                 |

A estratégia de cada arquivo (texto, visão ou OCR) aparece na tela. Os programas do
sistema ficam na imagem do `portfolio-worker` (poppler-utils, tesseract-ocr-por,
libheif-examples) e, o qpdf, na do web. Cada um é detectado na subida (`command -v`); o
que falta vira mensagem em português, não erro do provedor.

**Atalho por aba.** Aba de planilha já no layout `posicao_bolsiq` vai direto para o
validador, sem IA, mesmo num arquivo que tem outras abas livres.

## Chamadas ao modelo

Nenhuma com ferramentas.

1. **Cabeçalho**, uma vez por arquivo, com as primeiras e as últimas páginas: tipo,
   corretora, data de referência, totais declarados e avisos. `CabecalhoDaIA` tem sete
   propriedades; com `saida_estruturada`, vai como schema; sem ela, ou com o schema
   recusado, o modelo responde um bloco ` ```json ` validado pelo mesmo Zod. Um teste
   (`esquema.test.ts`) falha se qualquer schema enviado passar de 10 propriedades.
2. **Linhas**, por lote, com `generateText` e sem schema: blocos ` ```csv posicoes `,
   ` ```csv transacoes `, ` ```csv proventos ` e ` ```csv notas `, separador `;`.
   Posições vêm num bloco por seção, com o cabeçalho só das colunas que a seção usa
   (obrigatórias: `data_posicao`, `classe`, `ativo`, `saldo_bruto` e a origem): 27
   colunas quase vazias faziam o modelo errar a conta dos separadores (#43). Formato
   em [prompt-normalizacao.md](../importacao/prompt-normalizacao.md#formato-da-resposta-da-importação-com-ia).

### Lotes

O tamanho do lote sai do catálogo do modelo (`max_saida` e `contexto` em `modelos.json`;
fora dele, 8 mil e 32 mil): 25% da saída máxima, sem passar do contexto, no máximo 20 mil
tokens. A saída em CSV dá cerca de 4 tokens por token lido (27 colunas, origem e trecho em
cada linha), e toda chamada de lote pede a saída máxima do modelo.

**Raciocínio desligado** (#43). Converter não pede raciocínio, e o raciocínio adaptativo
dos Claude 5.x gastava a saída inteira do lote sem escrever uma linha (a posição da XP
voltava só com os proventos). `semRaciocinio` em `extracao.ts`: `thinking: disabled` onde
a API aceita, `between_tools` no Sonnet 5.5, esforço `low` no Opus 5.5, Fable e Mythos,
que não desligam. Aba grande é dividida repetindo o cabeçalho da tabela. Páginas em imagem vão de 4
em 4. Três lotes em paralelo por arquivo.

- **Resposta cortada** (`finishReason: "length"`): o lote é dividido ao meio e refeito.
- **429 e 5xx**: até 5 novas tentativas, espera exponencial com jitter (máximo 60 s).
- **Lote que falha de vez** fica isolado: o resto do arquivo segue, e a tela mostra o lote
  com "Reprocessar" (só aquele lote vai de novo ao modelo).
- **Erro do provedor** vira mensagem em português ("O provedor recusou a chave...", "O
  provedor limitou as chamadas agora...", "O provedor recusou o pedido pelo tamanho...").
  O texto bruto vai só para o log do worker, por `mensagemSegura` (sem chave, cortado).

### Autocorreção

Linha recusada por formato, layout ou campo obrigatório volta ao modelo com o motivo, até
2 rodadas (`RODADAS_DE_CORRECAO`). Linha do CSV com colunas a mais ou a menos também volta,
como veio, com o cabeçalho do bloco; a corrigida entra se trouxer o mesmo ativo e a mesma
página (#43). A linha corrigida só substitui a original se for a
mesma (mesma página e trecho, ou mesmo ativo); linha nova que aparece na correção é
descartada. Linha recusada por origem (valor que não está no documento) não volta: é
invenção.

Na Anthropic, o limite de 16 campos com union e o de tamanho da gramática compilada
(issue #37) não se aplicam: o único schema enviado é `CabecalhoDaIA`, sem campos anuláveis
e com sete propriedades, e as linhas vêm em texto. Se o provedor ainda assim recusar o
schema, o cabeçalho é refeito em texto, num bloco `json` validado pelo mesmo Zod.

## Validação

Em `validacao.ts`, nesta ordem:

1. **Normalização** (`normalizar.ts`): `R$`, `%`, separador de milhar (uma vírgula é
   decimal; mais de uma, milhar; um ponto é decimal; mais de um, milhar), datas
   (`15/05/2045`, `2045-05-15`, `15 mai 2045`, `15 de maio de 2045`), `-` e `—` como vazio, ticker
   em maiúsculas e sem sufixo `F`, sinônimos de classe ("Tesouro Direto" é
   `titulo_publico`, "FII" é `fii`), indexador e liquidez.
2. **Origem**, sobre os valores do modelo: o `trecho_original` está no texto anonimizado,
   e cada valor da linha está no trecho ou na linha do documento que o contém. Trecho
   copiado pulando uma coluna vale quando uma única linha do documento tem todos os
   campos dele, na ordem; os valores são conferidos nessa linha. O que não
   aparece é invenção e a linha cai com o motivo. Trecho com cara de instrução também cai.
3. **Política de preenchimento** (abaixo).
4. **Layout**: os validadores de sempre (`importarPosicaoBolsiq`, `importarCsvBolsiq`).
5. **Market-data**: ticker existe, preço de negócio entre a mínima e a máxima do pregão,
   data não futura. Provento com pagamento futuro não é erro: vai para "Proventos a
   receber" (abaixo).
6. **Conciliação por seção** (abaixo).

Linha de total ou subtotal ("Total", "Subtotal Renda Fixa") não vira posição: sai com um
aviso no arquivo.

Posição com coluna vazia a mais antes de `observacao` (erro comum do modelo) é consertada
na leitura, só quando a `valorizacao` cai no lugar certo e o excesso tem no máximo um
texto. Outro desalinhamento vira rejeição com o motivo.

### Política de preenchimento

Em `padroes.ts` (`POLITICA_DE_PREENCHIMENTO`). Cada campo preenchido é marcado
("preenchido automaticamente") e aparece em destaque na revisão.

| Campo                                       | Valor quando o documento não traz                       |
| ------------------------------------------- | ------------------------------------------------------- |
| `ir`, `iof`                                 | 0                                                       |
| `quantidade` (renda fixa, COE, estruturado) | 1                                                       |
| `preco_unitario`                            | `saldo_bruto / quantidade`                              |
| `valor_aplicado`                            | `saldo_bruto`, com aviso "rentabilidade não calculável" |
| `saldo_liquido`                             | `saldo_bruto - ir - iof`                                |
| `data_posicao`                              | data do documento; sem ela, a do envio                  |
| `corretora`                                 | a escolhida no envio; sem ela, o nome do arquivo        |
| `liquidez_diaria`                           | N                                                       |
| `valorizacao`                               | pela classe (cotação B3, curva, Tesouro, cota CVM)      |
| `taxas` (transação)                         | 0                                                       |

**Nunca preenchido** (`NUNCA_INVENTAR`): `saldo_bruto`, `ticker`/`codigo`, quantidade de
renda variável, preço e data de transação. Sem eles, a linha vai para "Precisa de
ajuste" com o campo destacado. O eval reprova qualquer um desses campos marcado como
preenchido.

### Grupos da revisão

| Grupo                       | Quando                                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Prontas                     | tudo do documento, ou só campos menores preenchidos (IR, IOF, liquidez, valorização, saldo líquido, taxas) |
| Preenchidas automaticamente | a política preencheu algo que pesa (quantidade, preço, valor aplicado, data, corretora)                    |
| Precisam de ajuste          | layout, market-data ou data reprovou; campos editáveis, com o problema destacado                           |
| Proventos a receber         | provento provisionado, com pagamento depois de hoje; informativo, não se marca nem vai à autocorreção      |

"Aceitar todas as prontas" marca o primeiro grupo de uma vez.

**Proventos provisionados** (#43). Extrato de posição costuma trazer, na mesma aba ou
página, os proventos anunciados e ainda não pagos (a XP lista em "Sua carteira":
ticker, quantidade, valor bruto e líquido, RENDIMENTO, DIVIDENDO ou JUROS SOBRE CAPITAL
PROPRIO e a data de pagamento). O prompt manda o modelo devolver essas linhas em
`proventos`, nunca como posição, com o líquido no JCP. A validação separa os de data
futura em "Proventos a receber", com o aviso da data prevista: provento só entra na
carteira depois de pago, então essas linhas não são gravadas; importe o extrato depois
do pagamento.

### Conciliação

Soma de `saldo_bruto` por corretora contra o total declarado (tolerância
`ASSISTANT_IMPORT_TOLERANCE`, 0,5%):

- **conciliada**: bate;
- **sem total**: o documento não declara total; aparece "sem total para conferir" e não
  bloqueia;
- **divergente**: não bate; a tela mostra a soma por seção (aba ou página) contra os
  totais de seção do documento, e a confirmação exige o aceite "Conferi os valores".

Nota de corretagem: o código rateia as taxas pelo volume e confere
`compras - vendas + taxas + IRRF = líquido`.

## Job, progresso e cancelamento

Tabelas no schema `assistant`, com RLS por usuário:

- `import_jobs`: carteira, status (`lendo`, `aguardando_confirmacao`, `extraindo`,
  `pronto`, `falhou`, `cancelado`), estimativa, custo, erro.
- `import_job_files`: um por arquivo, com nome, corretora, estado (`pendente`, `lendo`,
  `ocr`, `analisando`, `corrigindo`, `validando`, `pronto`, `falhou`, `cancelado`),
  progresso, estratégia, resultado e os bytes (`dados`).

Os bytes ficam só até a confirmação, o cancelamento ou 24 horas (limpeza de hora em hora
no worker). A fila não repete o job sozinha (`retryLimit` 0): a tela oferece reprocessar.

O progresso chega por SSE (`/eventos`): o web lê o job a cada segundo e manda o estado de
cada arquivo; o resultado de cada arquivo é buscado à parte quando ele fica pronto.
O worker grava o progresso de cada arquivo em fila e só grava o estado final depois que
a fila termina: gravação de progresso atrasada não sobrescreve o `pronto` (#41).
Cancelar marca o job, e o worker interrompe as chamadas em andamento.

## Rotas

Todas em `/api/carteiras/:id/importacoes/ia`:

| Rota                             | O que faz                                                          |
| -------------------------------- | ------------------------------------------------------------------ |
| `POST jobs`                      | recebe os arquivos (multipart) e cria o job; atalhos voltam direto |
| `GET jobs`                       | o último job da carteira (para retomar a tela)                     |
| `GET jobs/:job`                  | estado do job e dos arquivos                                       |
| `GET jobs/:job/eventos`          | SSE com o progresso                                                |
| `GET jobs/:job/arquivos/:indice` | resultado de um arquivo (linhas, grupos, conciliação)              |
| `POST jobs/:job/confirmar`       | aceita o custo estimado acima do limite                            |
| `POST jobs/:job/cancelar`        | cancela                                                            |
| `POST jobs/:job/reprocessar`     | um arquivo, lotes falhos ou com outro modelo                       |
| `POST revisao`                   | `revisarCarga` das linhas marcadas                                 |
| `POST confirmar`                 | grava e apaga os bytes do job; único ponto que escreve             |

Mais `GET`/`POST /api/assistente/importacao` (modelo, consentimento, limites). Schemas em
`apps/web/lib/importacao-ia-modelo.ts`.

## Limites e custo

| Variável                       | Padrão  | Para quê                                      |
| ------------------------------ | ------- | --------------------------------------------- |
| `ASSISTANT_IMPORT_MAX_MB`      | `50`    | tamanho por arquivo                           |
| `ASSISTANT_IMPORT_MAX_PAGES`   | `500`   | páginas ou abas por arquivo                   |
| `ASSISTANT_IMPORT_MAX_FILES`   | `20`    | arquivos por envio                            |
| `ASSISTANT_IMPORT_CONFIRM_USD` | `0.50`  | acima disso, a tela pede confirmação do custo |
| `ASSISTANT_IMPORT_DAILY`       | `20`    | importações com IA por usuário por dia        |
| `ASSISTANT_IMPORT_TOLERANCE`   | `0.005` | tolerância da conciliação, em fração          |

As de limite valem no web (recebimento) e no worker (que também precisa de
`ASSISTANT_MASTER_KEY` para abrir a chave do usuário, e das URLs do Ollama e da
DeepSeek). Não há limite por número de tokens: o documento é dividido em quantos lotes
precisar.

A estimativa conta o cabeçalho, os lotes (entrada pelo texto, saída 4 tokens por token
lido, imagem a 1.600 tokens por página) e uma parte para a autocorreção. O custo real
(tokens devolvidos pelo provedor) vai para `assistant.usage` com `origem = 'importacao'`.
**Cache** por hash do arquivo + versão do prompt + provedor + modelo: o mesmo arquivo
reenviado não vai ao provedor.

## Privacidade e segurança

- Consentimento próprio na primeira importação com IA, separado do chat.
- Anonimização antes do envio (CPF, conta, agência, código de cliente, e-mail, telefone,
  CEP, nome e endereço, nome da saudação da XP), com teste que lê o corpo da requisição ao provedor. O texto de
  OCR passa pela mesma anonimização; imagem enviada por visão não tem como.
- A senha do PDF só existe na requisição do envio: o PDF é decifrado e a senha descartada.
- O arquivo original sai do banco na confirmação, no cancelamento ou em 24 horas. Fica o
  hash, o JSON extraído e o relatório em `assistant.extractions`. Exportação e exclusão
  LGPD cobrem jobs, arquivos e extrações.
- Documento é dado, não instrução: o prompt diz isso, a chamada não tem ferramentas, e a
  validação de origem barra o que não vem do documento.

## Modelos

Qualquer modelo de texto importa. `saida_estruturada` e `visao` em `modelos.json` são
preferências: sem a primeira, o cabeçalho vem em texto; sem a segunda, páginas
escaneadas e fotos passam por OCR no worker. `contexto` e `max_saida` definem o lote.
`importacao: homologado` só depois do `make eval-importacao` com uma chave real; nenhum
modelo está homologado ainda.

## Avaliação

```bash
EVAL_PROVEDOR=anthropic EVAL_MODELO=claude-sonnet-5-5 EVAL_CHAVE=sua-chave make eval-importacao
```

Sem `EVAL_PROVEDOR`, o eval usa as respostas gravadas (roteiro) e roda em `make test`:
confere pipeline, validadores e harness. **Não homologa nada.**

Aprova com:

- pelo menos 95% das linhas esperadas em "Prontas" ou "Preenchidas automaticamente";
- zero campos inventados (campo de `NUNCA_INVENTAR` marcado como preenchido);
- zero ativos inventados, 95% de acerto por campo, até 5% de linhas faltantes;
- conciliação certa em todas as fixtures.

Fixtures em `packages/assistant/eval/importacao/fixtures.ts`, todas inventadas e anônimas:

| Fixture                  | Documento                                                    |
| ------------------------ | ------------------------------------------------------------ |
| `xp-posicao-detalhada`   | XLSX da XP, uma aba por classe, proventos                    |
| `xp-posicao-pdf`         | a mesma posição da XP em PDF                                 |
| `nubank-renda-fixa`      | PDF com texto                                                |
| `nubank-custodia-pdf`    | extrato de custódia da Nubank, duas páginas, total na última |
| `nubank-pdf-com-senha`   | o mesmo, com senha                                           |
| `santander-coe`          | texto colado                                                 |
| `santander-coe-xlsx`     | XLSX com cabeçalho na linha 5 e células mescladas            |
| `b3-negociacao`          | XLSX da Área do Investidor, com fracionário                  |
| `nota-sinacor-pdf`       | nota de corretagem em PDF com texto                          |
| `nota-sinacor-escaneada` | a mesma nota em imagem, com visão                            |
| `nota-sinacor-ocr`       | a mesma nota em imagem, modelo sem visão (OCR)               |
| `csv-baguncado`          | colunas trocadas, R$ e % como texto                          |
| `csv-latin1`             | CSV em windows-1252 com `;`                                  |
| `extrato-110-paginas`    | 110 páginas, vários lotes                                    |
| `injecao-de-prompt`      | extrato com texto de injeção                                 |

O e2e (`apps/web/e2e/importacao-ia.spec.ts`) envia três arquivos de uma vez (XP em XLSX,
Nubank em PDF e Santander em XLSX) contra o provedor falso (`infra/docker/llm-falso.mjs`),
com respostas geradas das fixtures (`pnpm --filter @bolsiq/assistant run e2e:importacao`).

### Como adicionar uma fixture

1. Em `fixtures.ts`, monte o documento com dados inventados: `planilha()` para XLSX,
   `pdfDeTexto(paginas, senha?)` ou `pdfEscaneado()` (`pdf.ts`) para PDF, texto para CSV.
2. Grave a `resposta` que um modelo correto devolveria, com `trecho_original` copiado do
   texto extraído.
3. Escreva o `esperado`: as linhas com os campos que importam e se a carga concilia.
4. Ticker ou pregão novo: inclua em `TICKERS` e `FAIXAS`.
5. `make test` roda a fixture no roteiro; `make eval-importacao` com um modelo real.

## Limitações

- A chave da plataforma (`ASSISTANT_PLATFORM_KEY`) não importa: só a do usuário.
- Linha legítima cujo valor o documento traz de outro jeito (calculado, somado) cai como
  "não aparece no trecho". O motivo aparece, e a linha se lança à mão.
- OCR erra em tabela pequena ou imagem ruim; a origem barra o número que não está no
  texto lido, mas o próprio texto lido pode estar errado: confira os valores na revisão.
- Posição e transações da mesma confirmação gravam em duas transações de banco.
