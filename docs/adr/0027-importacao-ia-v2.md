# ADR 0027 - Importação com IA v2: qualquer arquivo, em segundo plano, com autocorreção

- **Status:** aceito
- **Data:** 2026-11-09
- **Decisores:** @leandrojtv

Complementa o [ADR 0026](0026-importacao-com-ia.md). O que ele decidiu sobre a IA só
propor linhas, a validação de origem, o cache e a privacidade continua valendo.

## Contexto

A primeira versão falhava em arquivos reais:

- a saída estruturada estrita estourava a gramática compilada do provedor
  ("compiled grammar is too large"), mesmo depois de as linhas irem em CSV;
- `saida_estruturada` e `visao` travavam modelos que só leem texto ("modelo não suporta");
- 10 MB, 30 páginas e 300 mil tokens barravam extratos anuais; a rota síncrona caía por
  tempo em PDF grande;
- XLSX fora do layout tinha linhas recusadas por formato (R$, %, datas por extenso,
  cabeçalho na linha 5, células mescladas), e XLSX já no layout não pegava o atalho;
- campos que o documento não traz (IR zero, quantidade 1 de um CDB, data da posição)
  derrubavam a linha, e o usuário preenchia tudo à mão.

## Decisão

**Processamento em segundo plano.** O web recebe os arquivos, grava um job
(`assistant.import_jobs` e `import_job_files`, com RLS) e enfileira no pg-boss
(`assistant.importacao`); o `portfolio-worker` processa. A tela acompanha por SSE (o web lê
o job a cada segundo) e pode cancelar. Os bytes ficam no banco até a confirmação, o
cancelamento ou 24 horas. Limites por variável de ambiente: 50 MB por arquivo, 500
páginas, 20 arquivos; acima de US$ 0,50 estimados, a tela pede confirmação do custo.

O worker e não um serviço novo: ele já roda pg-boss, já tem a conexão do `portfolio` e
precisa de pouco a mais (a chave mestra para abrir a chave BYOK). Os programas do sistema
(poppler, tesseract, libheif) ficam na imagem dele, não na do web.

**Qualquer modelo de texto importa.** `saida_estruturada` e `visao` são preferências:

- o único schema enviado é o do cabeçalho (sete propriedades; um teste reprova acima de
  10), com fallback para um bloco JSON em texto;
- página escaneada e foto vão por visão quando o modelo vê imagem e por OCR local
  (`tesseract -l por`) quando não vê. O texto de OCR passa pela mesma anonimização e
  validação de origem que o texto do PDF;
- a tela mostra a estratégia de cada arquivo (texto, visão ou OCR).

**Leitura robusta sem IA.** PDF por pdf.js com fallback para `pdftotext`; PDF com senha
decifrado por `qpdf` no envio, sem gravar a senha; planilha com células mescladas
expandidas, linhas e colunas vazias fora e cabeçalho detectado; CSV com codificação e
separador detectados; HEIC convertido. Aba já no layout `posicao_bolsiq` vai para o
validador sem IA.

**Lotes pelo catálogo e falha isolada.** O tamanho do lote sai de `max_saida` e
`contexto` do modelo; três lotes em paralelo; resposta cortada divide o lote; 429 e 5xx
repetem até 5 vezes com espera exponencial e jitter; lote que falha de vez é isolado e
pode ser reprocessado sozinho. Não há mais limite por tokens do documento.

**Normalização determinística e autocorreção.** Antes da validação, o código normaliza
números, percentuais, datas, vazios, tickers e classes. Linha ainda recusada por formato
volta ao modelo com o motivo, até 2 rodadas; a correção só substitui a mesma linha
(página e trecho, ou ativo). Recusa por origem não volta: é invenção.

**Política de preenchimento explícita** (`padroes.ts`). IR e IOF zero, quantidade 1 em
renda fixa, preço pela divisão, valor aplicado igual ao saldo (com aviso), data do
documento, corretora escolhida, liquidez e valorização pela classe. Cada campo
preenchido é marcado e aparece em destaque. **Nunca** se preenche saldo bruto,
ticker/código, quantidade de renda variável, preço ou data de transação.

**Revisão em três grupos**: prontas, preenchidas automaticamente e precisam de ajuste
(editáveis, com o campo problemático destacado). "Aceitar todas as prontas" marca o
primeiro grupo.

**Conciliação em três situações.** Conciliada; sem total declarado ("sem total para
conferir", não bloqueia); divergente (mostra a soma por seção e exige o aceite). Antes,
documento sem total exigia aceite como se divergisse.

**Erros só em português.** O erro do provedor vira uma mensagem que diz o que fazer; o
texto bruto vai só para o log, limpo por `mensagemSegura`.

## Consequências

- A importação deixa de depender de recursos de provedor: qualquer modelo configurado
  importa, e o eval é quem diz se ele é bom o bastante.
- O eval mede o que o usuário sente: pelo menos 95% das linhas em "prontas" ou
  "preenchidas" e nenhum campo de `NUNCA_INVENTAR` preenchido.
- O arquivo passa até 24 horas no banco (antes, só na memória da requisição). Fica sob
  RLS, entra na exportação e na exclusão da conta, e sai na confirmação.
- A imagem do worker cresce com poppler, tesseract e libheif (cerca de 60 MB); a do web
  ganha só o qpdf.
- OCR erra em tabela pequena ou imagem ruim. A validação de origem barra número que não
  está no texto lido, mas não sabe se a leitura estava certa: a revisão continua sendo do
  usuário.
- Linha preenchida pela política parece completa. O destaque e o grupo próprio existem
  para que ela não passe sem ser olhada.
- O SSE lê o banco a cada segundo por tela aberta. Com muitos usuários simultâneos, troca
  por `LISTEN/NOTIFY` ou pelo NATS.

## Alternativas consideradas

- **Manter síncrono com timeout maior.** Não resolve 200 páginas com retry e autocorreção,
  e prende uma conexão do web por minutos.
- **Serviço novo para a importação.** Mais um processo e uma imagem sem dono de dado
  próprio; o worker do portfolio já tem fila e conexão. Pode virar serviço quando o volume
  pedir, já que a fronteira é a fila.
- **Só visão para escaneados.** Era a v1; trava quem usa modelo de texto (Ollama local,
  DeepSeek). OCR local cobre esses e não envia imagem ao provedor.
- **Deixar o modelo preencher os campos que faltam.** Sem regra fixa, o mesmo documento
  dá resultados diferentes, e não há como marcar o que veio do documento e o que foi
  suposto.
