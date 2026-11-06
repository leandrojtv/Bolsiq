# ADR 0024 - Assistente com a chave do usuário (BYOK)

- **Status:** aceito
- **Data:** 2026-11-03
- **Decisores:** @leandrojtv

O número 0016, pedido originalmente, já está reservado no [índice](README.md) para
`numeric` e `timestamptz`, e 0023 é do PR do informe mensal de FII. Por isso 0024.

## Contexto

O Bolsiq vai ter um assistente em linguagem natural sobre ativos e sobre a carteira do
usuário. Três riscos definem o desenho:

1. O modelo inventa números. Num produto financeiro, um P/L errado escrito com
   segurança é pior que nenhuma resposta.
2. Um token de IA custa dinheiro e o preço muda por provedor. Bancar isso agora não
   cabe no projeto.
3. Recomendação personalizada de investimento a terceiros é atividade regulada.

## Decisão

**Chave do usuário (BYOK), numa camada única.** Vercel AI SDK para Anthropic, OpenAI e
Google; API compatível com OpenAI para DeepSeek, OpenRouter e Ollama. Trocar de
provedor é configuração, não código.

**Pacote, não serviço.** `packages/assistant` não tem banco próprio de conexão nem HTTP
de entrada: o BFF do `apps/web` chama, como `analytics` e `portfolio`. As ferramentas
recebem uma interface `Fontes`, que o BFF implementa com o `/v1`, o analytics e o
`painel` da carteira. O eval implementa a mesma interface em memória.

**Todo número vem de ferramenta, e o cálculo fica no código.** `avaliar_carteira` e
`sugerir_aporte` são determinísticos: o modelo explica o que eles devolvem. O eval mede
se a resposta contém número sem origem nas ferramentas.

**A chave.**

- AES-256-GCM, com `ASSISTANT_MASTER_KEY` fora do banco e o id do usuário como dado
  autenticado: copiar o texto cifrado para outra linha faz a decifragem falhar.
- Descriptografada só no BFF, na hora da chamada. O navegador só vê os 4 últimos
  caracteres.
- Erro de provedor passa por `mensagemSegura`, que lê só `message` e `statusCode` e tira
  a chave e os formatos conhecidos. O `onError` do `streamText` é obrigatório: o padrão
  do AI SDK faz `console.error` do erro inteiro, com o corpo da requisição.
- Sem telemetria do AI SDK: o trace levaria prompt e carteira para fora do processo.

**URL do Ollama com lista de hosts.** Quem chama é o servidor. Sem
`ASSISTANT_OLLAMA_HOSTS`, o campo seria uma porta para a rede interna (SSRF). Toda
chamada usa `redirect: "error"`, para um 302 não tirar a chamada do host permitido.

**O histórico vem do banco, não do navegador.** O cliente manda só o texto novo. Mandar
o histórico deixaria o usuário forjar resultado de ferramenta, e o histórico enviado ao
modelo leva só o texto dos turnos antigos, sem repetir a carteira.

**`criar_alerta` não grava.** A ferramenta devolve uma proposta; o botão da tela chama
`POST /api/alertas/regras`. A escrita está fora do alcance do modelo.

**RLS como no portfolio** (ADR 0011). `assistant.usage` é append-only para o papel da
aplicação: apagar conversa não devolve a cota do dia nem some com o gasto do mês.

**Provedores só depois de consentimento.** A primeira conversa explica que a carteira
vai para o provedor escolhido, e a resposta da API é 409 sem o consentimento gravado.

## Regulação

**Recomendação personalizada de investimento a terceiros é atividade regulada pela CVM
(consultoria e análise de valores mobiliários) e precisa de avaliação jurídica antes de
o app ser aberto.** Este texto não é parecer jurídico.

`ASSISTANT_RECOMMENDATIONS` controla isso:

| Valor               | Uso                | Efeito                                                                                                                                                 |
| ------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `personal` (padrão) | uso próprio        | mostra as sugestões de aporte, com valor por candidato                                                                                                 |
| `educational`       | aberto a terceiros | análise e candidatos que passam nos critérios, sem linguagem de recomendação, sem valor nem quantidade por ativo, com aviso fixo na tela e na resposta |

Abrir para terceiros exige `educational` **e** a avaliação jurídica. A flag reduz o
risco, não o elimina. O padrão `personal` só é aceitável enquanto o único usuário for o
dono do projeto.

## Consequências

- Sem chave, o assistente não funciona, salvo com `ASSISTANT_PLATFORM_KEY`, desligada
  por padrão.
- Trocar `ASSISTANT_MASTER_KEY` invalida as chaves salvas. Cada usuário cola de novo.
- Dados da carteira saem para o provedor escolhido. O consentimento diz isso, e quem não
  quer pode usar Ollama local.
- Modelo muda de comportamento: a lista em `homologacao/modelos.json` diz o que foi
  testado, e mudança de prompt pede rodar o eval de novo.
- O eval não cobre qualidade de redação, só ferramenta, parâmetro, número e lista
  fechada de ativos.

## Alternativas consideradas

- **Serviço separado do assistente.** Isolaria a chave, mas sem ganho hoje: a chave já
  só existe no servidor, e o critério de extração do ADR 0009 não se aplica.
- **Tool approval do AI SDK para `criar_alerta`.** Mais acoplado ao SDK, e a garantia é
  a mesma de não dar à ferramenta o poder de escrever.
- **Chave da plataforma como padrão.** Custo sem teto e, com terceiros, o Bolsiq vira o
  operador do tratamento junto ao provedor.
