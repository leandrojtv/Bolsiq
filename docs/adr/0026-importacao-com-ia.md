# ADR 0026 - Importação com IA, em qualquer formato

- **Status:** aceito
- **Data:** 2026-11-08
- **Decisores:** @leandrojtv

O número 0018, pedido originalmente, já é do [processo do analytics](0018-analytics-worker.md),
e 0025 é o último em uso. Por isso 0026.

## Contexto

A importação aceita três layouts: CSV do Bolsiq, extrato da B3 e `posicao_bolsiq`
([ADR 0025](0025-posicoes-sem-ticker.md)). Cada banco e corretora exporta outra coisa:
PDF da XP com várias seções, XLSX com uma aba por classe, nota de corretagem SINACOR,
extrato colado do internet banking. Hoje o usuário converte à mão ou cola o
[prompt de normalização](../importacao/prompt-normalizacao.md) num assistente qualquer.

Converter documento livre para layout é trabalho de modelo de linguagem. Os riscos são
os de sempre num produto financeiro: o modelo inventa linha ou valor, o documento traz
dados pessoais, o documento pode tentar mandar no modelo, e cada chamada custa.

## Decisão

**A IA só propõe linhas nos layouts que já existem.** O modelo devolve `posicao_bolsiq`,
transações e proventos com `generateObject` e um schema Zod cujos campos são os mesmos
de `LinhaDePosicao` e `Transacao`, todos como texto, com vazio para "não informado": nada
anulável, porque a Anthropic recusa schema com mais de 16 uniões de tipo. Cada linha volta ao CSV e passa por
`importarPosicaoBolsiq` e `importarCsvBolsiq`: um validador só para arquivo e para IA.
A gravação é a de sempre (`gravarCargaDePosicao` e o insert de transações), e só na
confirmação do usuário. A chamada não tem ferramentas.

**Módulo em `packages/assistant/src/importacao`, não pacote novo.** A importação usa a
mesma chave BYOK cifrada, o mesmo `criarModelo`, o mesmo orçamento de tokens, o mesmo
catálogo de modelos e o mesmo consumo (`assistant.usage`). Um `packages/portfolio-ia`
dependeria de tudo isso e do `portfolio`, sem dono próprio de dado: o cache é do
assistente (schema `assistant`), e a carteira continua só do `portfolio`. O
`packages/portfolio` não ganha dependência de IA.

**Determinístico antes e depois do modelo.**

- Antes: limite de 10 MB e 30 páginas ou abas, tipo por extensão, MIME e assinatura,
  SHA-256, atalho para os layouts conhecidos (sem IA), texto sem IA (SheetJS para
  planilha, pdf.js para PDF) e anonimização: CPF, conta, agência, código de cliente,
  e-mail, telefone, CEP e as linhas de nome e endereço saem; CNPJ e códigos ficam.
- Depois: cada `trecho_original` tem de estar no texto do documento, e cada valor da
  linha tem de estar no trecho (ou na linha inteira do documento que o contém). Ativo e
  total declarado também. O que não aparece é invenção e a linha é rejeitada. Trecho com
  cara de instrução ("ignore as instruções") é rejeitado. Ticker existe no market-data,
  preço de compra e venda dentro da mínima e máxima do pregão, data não é futura.
- Conciliação: a soma de `saldo_bruto` por corretora contra o total declarado no
  documento (0,5%, configurável). Nota de corretagem: compras - vendas + taxas + IRRF =
  líquido, com as taxas rateadas pelo volume no código, não pelo modelo. Carga não
  conciliada exige aceite explícito na confirmação.

**Visão só quando precisa e com aceite.** Imagem e PDF escaneado vão ao provedor como
arquivo, sem anonimização possível, e só com modelo de capacidade `visao` e aceite a
cada envio. As linhas lidas de imagem vêm com confiança baixa e desmarcadas.

**Capacidades por modelo em `modelos.json`.** `saida_estruturada` é obrigatória para a
opção aparecer; `visao` para imagem; `max_saida` divide o documento. Modelo fora da lista
não importa: não há como saber se respeita o schema. `importacao: homologado` só com o
resultado do `make eval-importacao`.

**Cache por hash, versão do prompt e modelo** em `assistant.extractions`. O mesmo
arquivo não vai ao provedor duas vezes. O arquivo original só é guardado se o usuário
pedir; sai com a exclusão da conta.

**Prompt com fonte única.** As regras de coluna ficam no Markdown
`docs/importacao/prompt-normalizacao.md`; `prompts/importacao-regras.ts` é gerado dele, e
um teste falha se divergirem.

## Consequências

- O validador é o mesmo do CSV: regra nova de layout vale para os dois caminhos.
- O que o modelo escreve fora do documento não chega à revisão. O preço é rejeitar linha
  legítima quando o extrato traz o valor de outro jeito (percentual calculado, valor
  somado de duas linhas). A rejeição aparece com o motivo, e o usuário lança à mão.
- Extrato sem total declarado nunca concilia sozinho: o usuário confere e aceita.
- `generateObject` está marcado como obsoleto no AI SDK 7 em favor de `generateText` com
  `output`. Fica por ora: a troca é de uma chamada e não muda o contrato.
- Posição e transações da mesma confirmação gravam em duas transações de banco (a carga
  de posição e o CSV). Se a segunda falhar, a primeira fica; a tela mostra o erro.
- O provedor recebe o texto anonimizado do extrato. O consentimento da importação é
  separado do consentimento do chat.

## Alternativas consideradas

- **Parser por corretora.** Determinístico e barato, mas é um parser por layout e por
  versão de layout; cada mudança da corretora quebra. Fica como atalho quando o volume
  de um layout justificar (como o extrato da B3).
- **Modelo grava direto com ferramenta.** Descartado: a escrita fica sempre com a tela
  (como `criar_alerta`, ADR 0024).
- **OCR local para PDF escaneado.** Tesseract no container do web pesaria e erraria
  números em tabela pequena. Visão do modelo, com aceite, cobre o caso raro.
