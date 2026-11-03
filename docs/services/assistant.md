# assistant

"Pergunte ao Bolsiq": assistente em linguagem natural, com a chave do próprio usuário.
Pacote `packages/assistant`, schema `assistant`, usado pelo BFF do `apps/web`. Decisões no
[ADR 0024](../adr/0024-assistente-byok.md).

## Arquitetura

```
Painel (apps/web) --POST /api/assistente/chat--> BFF
  BFF: sessão -> consentimento e limites -> decifra a chave -> conversar()
  conversar(): streamText + ferramentas + orçamento de tokens --> provedor
  ferramentas --> Fontes (BFF: /v1, analytics, painel da carteira, perfil)
```

| Módulo                  | O que faz                                                        |
| ----------------------- | ---------------------------------------------------------------- |
| `src/chaves.ts`         | AES-256-GCM, remoção de segredos, erro seguro                    |
| `src/provedores.ts`     | modelo do AI SDK por provedor, lista de modelos, teste           |
| `src/catalogo.ts`       | provedores e classificação (homologado, experimental, bloqueado) |
| `src/ferramentas.ts`    | as ferramentas, com schema Zod e a interface `Fontes`            |
| `src/diagnostico.ts`    | `avaliar_carteira`: calculado aqui, não pelo modelo              |
| `src/aporte.ts`         | `sugerir_aporte`: determinístico                                 |
| `src/orcamento.ts`      | abaixo de 100 mil tokens por chamada, custo                      |
| `src/conversa.ts`       | a chamada ao provedor, igual no BFF e no eval                    |
| `prompts/sistema-v1.ts` | system prompt versionado                                         |
| `homologacao/`          | modelos testados e resultado do eval de cada um                  |
| `eval/`                 | perguntas, base de teste e medidas                               |

`@bolsiq/assistant/puro` não usa nada de servidor: é o que o navegador importa.

## Provedores

| Provedor   | Como fala             | Preço na lista  | Sabe se tem ferramentas |
| ---------- | --------------------- | --------------- | ----------------------- |
| Anthropic  | `@ai-sdk/anthropic`   | `modelos.json`  | não informa             |
| OpenAI     | `@ai-sdk/openai`      | `modelos.json`  | não informa             |
| Google     | `@ai-sdk/google`      | não informado   | não informa             |
| DeepSeek   | compatível com OpenAI | `modelos.json`  | não informa             |
| OpenRouter | compatível com OpenAI | API (`pricing`) | API                     |
| Ollama     | compatível com OpenAI | zero (local)    | `/api/show`             |

"Testar conexão" lista os modelos, que autentica sem gastar token. A lista da OpenRouter é
pública, então lá a chave é conferida em `/key` antes.

Status do modelo:

- **homologado**: passou no `make eval-assistente`, está em `modelos.json`.
- **experimental**: fora da lista. Funciona, com aviso na tela.
- **bloqueado**: sem chamada de ferramentas, pelo provedor ou por `sem_ferramentas` na
  lista. Não salva, nem pela API.

Os preços em `modelos.json` foram lidos das páginas dos provedores na data em
`precos_conferidos_em`. O custo na tela é estimativa; a cobrança é do provedor. DeepSeek
tem preço de pico e fora de pico: a lista guarda o de pico.

## Ferramentas

Cada uma tem schema Zod, devolve `proveniencia` (fonte, data, atraso) e, quando a fonte
falha, `{ erro: "indisponivel" }`, que o modelo lê como "não tenho o dado".

| Ferramenta         | Lê de                       | Observação                                  |
| ------------------ | --------------------------- | ------------------------------------------- |
| `cotacao`          | `/v1/quotes`                | até 20                                      |
| `historico`        | `/v1/history`               | resumo e até 60 pontos, não a série inteira |
| `proventos`        | `/v1/dividends`             |                                             |
| `fundamentos`      | `/v1/fundamentals`          |                                             |
| `indicadores`      | `analytics.indicators`      | até 10                                      |
| `comparar`         | `montarComparacao`          | sem as séries                               |
| `screener`         | `executarScreener`          | preset ou faixas, até 20 linhas             |
| `cenario_macro`    | `/v1/macro`                 | Selic, IPCA, CDI e IBOV                     |
| `minha_carteira`   | `painel`                    | mesmos números da tela                      |
| `avaliar_carteira` | `painel`, perfil, histórico | exige perfil                                |
| `sugerir_aporte`   | `painel`, perfil, screener  | exige perfil                                |
| `criar_alerta`     | nada                        | só propõe; a tela confirma e grava          |

O `id` de usuário nunca é parâmetro: as `Fontes` são criadas presas ao usuário da sessão.

### avaliar_carteira

- Concentração por ativo e setor, de `painel.alocacao`, contra os limites do perfil.
- Desvio por classe contra a alocação-alvo, com o valor em reais até o alvo.
- Volatilidade, drawdown e beta, pelas fórmulas de [analytics](analytics.md), sobre os
  snapshots dos últimos 12 meses. A janela vem junto.
- Correlação entre até 10 posições, pelos retornos diários nas datas em comum. Os 10 pares
  mais fortes.
- DY médio ponderado pelo valor, e margens de Graham e Bazin por posição.

### sugerir_aporte

1. **Rebalanceamento.** Reparte o aporte na proporção do que falta em cada classe, sobre o
   patrimônio depois do aporte. Não vende: classe acima do alvo recebe zero.
2. **Candidatos.** Em cada classe que recebe aporte, roda os métodos do perfil com a
   liquidez mínima. Sai o que está na lista de evitar, acima do limite por ativo ou em
   setor acima do limite. Método que não cobre o tipo do ativo é pulado (Graham em FII).
3. **Score** de 0 a 100 entre os candidatos da classe: 40% o indicador que o método ordena,
   20% liquidez, 20% volatilidade baixa, 20% endividamento baixo. Ficam os 3 melhores.
4. **Riscos**: DL/EBITDA acima de 3, CAGR de lucro negativo, volatilidade acima de 40%,
   drawdown pior que 40%, e passar do limite de concentração com o aporte.

Classe sem candidato devolve `sem_candidatos` com o motivo. Renda fixa sempre: o Bolsiq não
cobre títulos. `tickers_permitidos` é a lista fechada que o prompt e o eval usam.

## Segurança da chave

- `assistant.settings.chave_cifrada`: `v1.<iv>.<tag>.<corpo>`, AES-256-GCM, com o id do
  usuário como dado autenticado.
- `ASSISTANT_MASTER_KEY` só em variável de ambiente. Gere com `openssl rand -base64 32`.
- O navegador recebe só `chave_final`. O `PUT` não devolve a chave, e o erro de validação
  da rota não repete o valor recebido.
- Log: `registrarErro` grava só texto que passou por `mensagemSegura`.
- Testes: `src/vazamento.test.ts` (provedor que devolve a chave no erro, falha de rede,
  console inteiro capturado) e `e2e/assistente.spec.ts` (respostas da API e `docker compose
logs` do web).

Trocar a chave-mestra invalida as chaves salvas: o chat responde erro, e cada usuário cola
de novo. Não há rotação automática.

## Dados

| Tabela              | Chave     | Conteúdo                                              |
| ------------------- | --------- | ----------------------------------------------------- |
| `settings`          | `user_id` | provedor, modelo, chave cifrada, preço, consentimento |
| `investor_profiles` | `user_id` | documento validado por `PerfilDoInvestidor`           |
| `conversations`     | `id`      | título, tokens e custo acumulados                     |
| `messages`          | `id`      | partes da mensagem, com os passos de ferramenta       |
| `usage`             | `id`      | uma linha por turno; append-only para a aplicação     |

RLS forçada em todas, pelo `comoUsuario` do portfolio. Migrations aplicadas pelo
`portfolio-migrate`. Exportação e exclusão LGPD em `/configuracoes/conta` cobrem o schema;
a chave cifrada não entra na exportação.

## Custo e limites

- Orçamento de 80 mil tokens estimados na entrada, com folga para o erro da estimativa e os
  4 mil de saída: abaixo de 100 mil por chamada. Vale a cada passo do laço, porque os
  resultados de ferramenta somam.
- Histórico: até 20 mensagens, só o texto. Resposta de ferramenta acima de 24 mil caracteres
  é cortada.
- Limite de mensagens por dia em `ASSISTANT_DAILY_MESSAGES`. Turno que falhou também conta.
- Consumo do mês em `/configuracoes/assistente`.

## Variáveis

| Variável                      | Padrão                              | Para quê                                  |
| ----------------------------- | ----------------------------------- | ----------------------------------------- |
| `ASSISTANT_MASTER_KEY`        | vazia                               | cifra as chaves; sem ela, só Ollama salva |
| `ASSISTANT_RECOMMENDATIONS`   | `personal`                          | `educational` ao abrir para terceiros     |
| `ASSISTANT_DAILY_MESSAGES`    | `100`                               | limite por usuário por dia                |
| `ASSISTANT_OLLAMA_URL`        | `http://host.docker.internal:11434` | URL padrão do Ollama                      |
| `ASSISTANT_OLLAMA_HOSTS`      | `host.docker.internal,ollama`       | hosts aceitos no campo da tela            |
| `ASSISTANT_DEEPSEEK_URL`      | vazia                               | outro endereço, proxy ou o falso do e2e   |
| `ASSISTANT_PLATFORM_KEY`      | vazia                               | chave da plataforma; vazia é desligada    |
| `ASSISTANT_PLATFORM_PROVIDER` | `deepseek`                          | provedor da chave da plataforma           |
| `ASSISTANT_PLATFORM_MODEL`    | `deepseek-flash`                    | modelo da chave da plataforma             |
| `ASSISTANT_PLATFORM_LIMITS`   | `gratis:20`                         | mensagens por dia por plano               |

Ainda não há tabela de planos: todo usuário é `gratis`.

## Como homologar um modelo

```bash
EVAL_PROVEDOR=deepseek EVAL_MODELO=deepseek-flash EVAL_CHAVE=sua-chave make eval-assistente
```

Ollama, com o servidor rodando na máquina:

```bash
EVAL_PROVEDOR=ollama EVAL_MODELO=llama3.2:latest EVAL_URL=http://host.docker.internal:11434 make eval-assistente
```

O eval roda as perguntas de `eval/casos.ts` sobre `eval/base.ts`, que traz a carteira de
conferência de [portfolio](portfolio.md) e um universo fixo. Mede por pergunta:

- **ferramenta certa** e **parâmetros certos**;
- **números certos**: os esperados aparecem, e nenhum número da resposta fica sem origem nas
  ferramentas ou na pergunta;
- **texto certo**: expressões que a resposta precisa ter;
- **ativos fora da lista**: ticker citado em pergunta de aporte fora de `tickers_permitidos`
  ou da carteira. Tolerância zero.

Aprova com 85% em cada medida e nenhum ativo fora da lista. O resultado vai para
`homologacao/<provedor>-<modelo>.json`, e o modelo aprovado vira `homologado` em
`modelos.json`. Commite os dois. Mudou o prompt, rode de novo.

Sem `EVAL_PROVEDOR`, o eval usa um roteiro: um modelo de mentira que chama as ferramentas
esperadas e responde os valores esperados. Isso confere o harness e as ferramentas (se o
valor esperado não bate com a saída real, reprova) e roda em `make test`. **Não homologa
nada.**

Resultados até aqui:

| Modelo                   | Ferramenta | Parâmetros | Números | Texto | Resultado |
| ------------------------ | ---------- | ---------- | ------- | ----- | --------- |
| `ollama/llama3.2:latest` | 70,4%      | 74,1%      | 51,9%   | 66,7% | reprovado |

Modelo pequeno em Ollama precisa de memória livre: um modelo maior que a RAM da máquina
trava o host.

## Como adicionar uma ferramenta

1. Em `src/ferramentas.ts`: entrada em `NOMES_DAS_FERRAMENTAS` e a `tool()`, com schema Zod,
   `seguro()` e `proveniencia`. Sem id de usuário nos parâmetros. Corte série longa.
2. O que ela lê entra em `Fontes`, implementado no BFF (`apps/web/lib/assistente.ts`) e em
   `eval/base.ts`.
3. Texto do passo em `src/rotulos.ts`.
4. Se muda o comportamento, nova versão do prompt.
5. Teste em `src/ferramentas.test.ts` e ao menos um caso em `eval/casos.ts`.

Escrita não é ferramenta: proponha, e deixe a tela confirmar, como `criar_alerta`.

## Limitações

- Sem notícias nem fatos relevantes, e o assistente diz isso.
- Renda fixa e caixa não existem na carteira: alvo de renda fixa sempre aparece com desvio.
- Volatilidade, drawdown e beta dependem de snapshot: carteira recém-importada pode vir com
  `recalculando` e a janela curta.
- Sem resumo de histórico por modelo: o que sai do orçamento é descartado.
