# Importação com IA

"Importar com IA (qualquer formato)" na tela de importação da carteira. O usuário envia
PDF, CSV, XLSX, XLS, TXT, imagem ou texto colado, de qualquer banco ou corretora. O modelo
configurado no [assistente](assistant.md) converte para os layouts que já existem
([portfolio](portfolio.md#layout-de-posicao)); os validadores de sempre conferem; o
resultado entra na revisão de sempre. **A IA nunca grava: só propõe linhas.** Decisão no
[ADR 0026](../adr/0026-importacao-com-ia.md).

Código em `packages/assistant/src/importacao`, BFF em `apps/web/lib/importacao-ia.ts`,
tela em `apps/web/componentes/carteira/ImportarComIA.tsx`.

## Pipeline

```
arquivo ou texto
  1 recebimento     10 MB, 30 páginas/abas, extensão + MIME + assinatura, SHA-256
  2 atalho          CSV Bolsiq, extrato B3 ou posicao_bolsiq: importador atual, sem IA
  3 texto, sem IA   CSV/TXT direto; XLSX/XLS uma tabela por aba (SheetJS);
                    PDF texto por página (pdf.js); página sem texto e imagem: visão
  4 anonimização    CPF, conta, agência, código de cliente, e-mail, telefone, CEP,
                    linhas de nome e endereço; CNPJ e códigos ficam
  5 IA              generateObject, sem ferramentas, schema Zod, uma chamada por lote
  6 lotes           por página/aba, aba grande dividida repetindo o cabeçalho;
                    juntar e tirar repetidas (origem, ou ativo com os mesmos valores)
  7 validação       origem, layout, market-data, conciliação, nota de corretagem
  8 revisão         a tela de sempre, com o que é da IA a mais
  9 confirmação     gravarCargaDePosicao e o CSV de transações, como hoje
```

| Módulo                     | O que faz                                                         |
| -------------------------- | ----------------------------------------------------------------- |
| `recebimento.ts`           | limites, tipo e hash                                              |
| `texto.ts`                 | texto por tipo, sem IA                                            |
| `anonimizar.ts`            | o que identifica o titular sai                                    |
| `esquema.ts`               | o schema de saída do modelo                                       |
| `lotes.ts`                 | divisão em chamadas abaixo de 100 mil tokens                      |
| `extracao.ts`              | a chamada ao provedor e a junção das partes                       |
| `validacao.ts`             | origem, validadores do layout, market-data, conciliação, rateio   |
| `conciliacao.ts`           | soma contra total declarado e o CSV de volta; também no navegador |
| `pipeline.ts`              | recebimento, atalho, texto, anonimização, estimativa              |
| `servico.ts`               | cache, limite diário, consumo e validação em sequência            |
| `prompts/importacao-v1.ts` | prompt de sistema versionado                                      |

### Divisão em partes

Cada lote tem até 60% da saída máxima do modelo (`max_saida` em `modelos.json`, padrão
8 mil), no máximo 20 mil tokens. Entrada, prompt e saída ficam abaixo de 100 mil por
chamada (teste em `lotes.test.ts`). Documento acima de 300 mil tokens estimados é
recusado: melhor dividir o arquivo por período ou conta.

## Schema da saída

```
documento   { tipo: posicao | transacoes | nota_corretagem | proventos | misto,
              corretora, data_referencia, totais_declarados: [{ descricao, valor }] }
posicoes    as 24 colunas do posicao_bolsiq, como texto ou nulo
transacoes  as 7 colunas do CSV Bolsiq, mais ativo_no_documento e nota
proventos   data_pagamento, ticker, tipo, quantidade, valor_por_cota, valor_total
notas       numero, data_pregao, taxas_total, irrf, valor_liquido, sentido_liquido
avisos      o que o modelo não conseguiu interpretar
```

Toda linha leva `origem: { pagina_ou_aba, trecho_original }` e `confianca: alta | media |
baixa`. Os campos são texto de propósito: tipo errado rejeita a linha, não a resposta
inteira. O tipo de verdade é o de `LinhaDePosicao` e `Transacao`: cada linha volta ao CSV e
passa por `importarPosicaoBolsiq` e `importarCsvBolsiq`. Provento vira transação
`provento` (quantidade e valor por cota; sem quantidade, valor total com quantidade 1).

## Validação

O ponto mais importante. Tudo determinístico, em `validacao.ts`:

1. **Origem.** O `trecho_original` tem de estar no texto anonimizado do documento
   (comparado só por letras e dígitos, sem acento). Os valores da linha (quantidade,
   preços, saldos, IR, IOF; taxa e percentual como percentual) e o ativo (ticker, código
   ou uma palavra do nome) têm de estar no trecho ou na linha inteira do documento que o
   contém. Total declarado tem de estar no documento. **O que não aparece é invenção, e
   a linha cai** com o motivo.
2. **Instrução no documento.** Trecho com cara de instrução ("ignore", "adicione",
   "responda", "prompt"...) é rejeitado.
3. **Layout.** Os validadores de sempre: classe, CNPJ, ticker, data, ativo repetido.
4. **Market-data.** Ticker existe (`/v1/assets/:t`); preço de compra e venda entre a
   mínima e a máxima do pregão (`/v1/history`, sem ajuste); data não é futura. Sem candle
   do dia, aviso; market-data fora do ar, aviso geral.
5. **Conciliação.** Soma de `saldo_bruto` por corretora contra o total declarado: o total
   geral ("total", "patrimônio") que bate dentro da tolerância, ou o maior. Sem total
   declarado, não concilia. Tolerância em `ASSISTANT_IMPORT_TOLERANCE` (0,5%).
6. **Nota de corretagem.** O modelo não rateia: copia `taxas_total`, `irrf` e o líquido.
   O código rateia as taxas pelo volume de cada negócio (o último leva o centavo) e
   confere `compras - vendas + taxas + IRRF = líquido`, com o sentido (débito ou crédito)
   e o líquido escrito no documento.

Linha de confiança baixa, de carga não conciliada ou de nota que não confere vem
desmarcada. Linha lida de imagem tem confiança baixa: não há texto para conferir.

Na confirmação, as linhas editadas passam de novo pelo layout, pela data e pelo
market-data (`validarLinhasEditadas`). O trecho não é conferido de novo: a edição é
decisão do usuário.

## Revisão

A mesma tela e a mesma rota de revisão (`revisarCarga`), com:

- selo "extraído por IA", modelo e custo da chamada ("do cache, sem custo" no cache);
- totais por corretora, refeitos no navegador a cada linha marcada ou editada, contra
  o total do documento; resumo de cada nota;
- por linha: confiança, campos editáveis, avisos e o trecho; clicar no trecho mostra a
  página ou aba de origem (o texto anonimizado que foi ao modelo);
- rejeitadas com o motivo;
- "Reprocessar" com o mesmo modelo (ignora o cache) ou outro do mesmo provedor.

Carga não conciliada só grava com o aceite "Conferi os valores", que vai para o servidor
(`aceitar_nao_conciliada`) e é exigido lá.

## Rotas

| Rota                                                | O que faz                                  |
| --------------------------------------------------- | ------------------------------------------ |
| `GET /api/assistente/importacao`                    | modelo, capacidades, consentimento, limite |
| `POST /api/assistente/importacao`                   | consentimento e `guardar_original`         |
| `POST /api/carteiras/:id/importacoes/ia/estimativa` | tokens e custo estimados; não chama a IA   |
| `POST /api/carteiras/:id/importacoes/ia`            | processa; NDJSON com etapa e resultado     |
| `POST /api/carteiras/:id/importacoes/ia/revisao`    | `revisarCarga` das linhas marcadas         |
| `POST /api/carteiras/:id/importacoes/ia/confirmar`  | grava; único ponto que escreve             |

Schemas em `apps/web/lib/importacao-ia-modelo.ts`.

## Privacidade e segurança

- **Consentimento próprio** na primeira importação com IA, separado do chat.
- **Anonimização antes do envio**, com teste que lê o corpo da requisição ao provedor
  (`integracao.test.ts`): CPF, conta e nome do titular não saem; CNPJ sai.
- **Imagem e PDF escaneado** não têm como ser anonimizados: vão como arquivo, só com
  modelo de visão e aceite a cada envio.
- **Arquivo original não é guardado** por padrão. Fica o hash, o JSON extraído e o
  relatório em `assistant.extractions`, com RLS. O usuário pode pedir para guardar o
  original no consentimento. Exportação e exclusão LGPD cobrem a tabela; o original não
  entra na exportação.
- **Documento é dado, não instrução.** O prompt diz isso e põe o texto entre
  `<documento>` e `</documento>` (o texto não fecha o bloco sozinho); a chamada não tem
  ferramentas; a validação barra o que não vem do documento. Fixture `injecao-de-prompt`:
  um modelo que obedecesse à injeção teria a linha e o total falsos rejeitados.
- **Chave** pelo mesmo caminho do chat: `mensagemSegura` em todo erro, sem telemetria.

## Custos e limites

- Antes de processar, a tela mostra tokens e custo estimados por arquivo
  (`estimarImportacao`): entrada pelo tamanho do texto, saída 1,2 token por token lido.
- O custo real (tokens que o provedor devolve) vai para `assistant.usage` com
  `origem = 'importacao'`, e entra no consumo do mês. Chamada que falha também conta.
- Limite por usuário por dia em `ASSISTANT_IMPORT_DAILY` (20). O cache não conta. O
  limite de mensagens do chat conta só `origem = 'chat'`.
- **Cache** por hash do arquivo + versão do prompt + provedor + modelo. O mesmo arquivo
  reenviado não vai ao provedor e não custa nada.

## Modelos

Em `packages/assistant/homologacao/modelos.json`, por modelo:

| Campo         | Para quê                                                     |
| ------------- | ------------------------------------------------------------ |
| `capacidades` | `saida_estruturada` (obrigatória para importar) e `visao`    |
| `max_saida`   | tokens de saída por chamada; define o tamanho do lote        |
| `importacao`  | `homologado` depois do `make eval-importacao`; `nao_testado` |

Modelo fora da lista ou sem `saida_estruturada` não aparece como opção de importação.
As capacidades foram declaradas pela documentação dos provedores em
`capacidades_conferidas_em`; nenhum modelo está homologado para importar ainda.

## Avaliação

```bash
EVAL_PROVEDOR=anthropic EVAL_MODELO=claude-sonnet-5-5 EVAL_CHAVE=sua-chave make eval-importacao
```

Fixtures em `packages/assistant/eval/importacao/fixtures.ts`, todas inventadas e anônimas:

| Fixture                  | Documento                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------ |
| `xp-posicao-detalhada`   | XLSX, abas de renda fixa, ações, FIIs, fundos, previdência, Tesouro, COE e proventos |
| `nubank-renda-fixa`      | PDF com texto                                                                        |
| `santander-coe`          | texto colado                                                                         |
| `b3-negociacao`          | XLSX da Área do Investidor, com fracionário                                          |
| `nota-sinacor-pdf`       | nota de corretagem em PDF com texto                                                  |
| `nota-sinacor-escaneada` | a mesma nota só com imagem; exige visão                                              |
| `csv-baguncado`          | colunas trocadas, R$ e % como texto, datas DD/MM/AAAA                                |
| `injecao-de-prompt`      | extrato com texto de injeção                                                         |

Medidas: acerto por campo, conciliação de totais, ativos inventados e linhas faltantes.
Aprova com 95% de acerto por campo, conciliação certa em todas, nenhum ativo inventado e
até 5% de linhas faltantes. O resultado vai para
`homologacao/importacao-<provedor>-<modelo>.json`, e o modelo aprovado ganha
`importacao: homologado` em `modelos.json`. Modelo sem visão pula a fixture escaneada.

Sem `EVAL_PROVEDOR`, o eval usa as respostas gravadas em cada fixture (roteiro): confere
o pipeline, os validadores e o harness, e roda em `make test`. **Não homologa nada.**

### Como adicionar uma fixture

1. Em `fixtures.ts`, monte o documento com dados inventados: `planilha()` para XLSX,
   `pdfDeTexto()` ou `pdfEscaneado()` (`pdf.ts`) para PDF, texto para CSV e colado.
2. Grave a `resposta` que um modelo correto devolveria, com `trecho_original` copiado
   do texto extraído (`celulas()` para planilha, `colunas()` para PDF).
3. Escreva o `esperado`: as linhas com os campos que importam e se a carga concilia.
4. Se usar ticker ou pregão novo, inclua em `TICKERS` e `FAIXAS`.
5. `make test` roda a fixture no roteiro; `make eval-importacao` com um modelo real.

## Variáveis

| Variável                     | Padrão  | Para quê                               |
| ---------------------------- | ------- | -------------------------------------- |
| `ASSISTANT_IMPORT_DAILY`     | `20`    | importações com IA por usuário por dia |
| `ASSISTANT_IMPORT_TOLERANCE` | `0.005` | tolerância da conciliação, em fração   |

A chave e o modelo são os do assistente (`/configuracoes/assistente`).

## Limitações

- A chave da plataforma (`ASSISTANT_PLATFORM_KEY`) não importa: só a do usuário.
- Linha legítima cujo valor o documento traz de outro jeito (calculado, somado) cai como
  "não aparece no trecho". O motivo aparece, e a linha se lança à mão.
- Página escaneada vai inteira (o PDF), não só a página sem texto.
- Posição e transações da mesma confirmação gravam em duas transações de banco.
