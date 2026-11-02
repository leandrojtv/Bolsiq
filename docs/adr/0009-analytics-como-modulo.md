# ADR 0009 - Analytics como modulo, com critario de extracao

- **Status:** aceito
- **Data:** 2026-11-02
- **Decisores:** @leandrojtv

## Contexto

O CLAUDE.md define que o `app` contem `analytics`, `portfolio` e `alerts`, cada
um em pacote proprio com fronteira explicita, "prontos para virar servico". Isto
e um alvo, nao um estado: um pacote pode ter pasta propria e ainda assim estar
preso ao resto por um import.

O analytics e o primeiro dos tres a existir, e e o que mais tenta atravessar a
fronteira. Ele precisa de demonstracao financeira, preco, provento, CDI e o
universo de ativos - tudo do `market-data`. Um `SELECT` no schema
`market_data` resolveria cada uma dessas necessidades em uma linha.

A pergunta nao e se o analytics e modulo ou servico hoje. E: o que impede que
ele deixe de poder ser extraido?

## Decisao

Modulo em `packages/analytics`, com **schema proprio** `analytics` no banco, e
tres restricoes que valem desde agora:

1. **Nunca ler `market_data`.** Dado de mercado entra pela API `/v1` ou por
   evento. O que o analytics precisa consultar rapido ele copia para o proprio
   schema (`assets_mirror`, `daily_returns`).
2. **Nenhum import de `services/market-data`.** O contrato compartilhado e
   `@bolsiq/contracts`, que nao tem acesso a banco.
3. **Nenhum join entre `analytics` e `market_data`.** Mesmo cluster, schemas
   separados, sem excecao.

### Por que schema separado agora

Schema separado e barato hoje e caro depois. Com as duas coisas no mesmo schema,
o primeiro join entre `indicators` e `quotes_daily` nao daria erro, nao apareceria
em revisao, e passaria a ser copiado nos proximos. A extracao deixaria de ser
"mover pacote" e passaria a ser "desfazer N joins que ninguem mapeou".

O custo e real e assumido: `assets_mirror` e `daily_returns` sao copia, e copia
atrasa. O analytics pode calcular com universo de ontem se um evento se perder.
E o preco de poder extrair o modulo, e e menor que o de nao poder.

### Por que nao servico desde ja

Tres razoes, nesta ordem:

- **Latencia por chamada.** O screener filtra o universo inteiro em uma consulta.
  Como servico, cada filtro combinado viraria chamada de rede ou exigiria
  replicar os indicadores no chamador - que e o que o schema proprio ja faz, sem
  processo a mais.
- **O limite ainda nao foi atingido.** Indicador trimestral recalculado por
  evento nao tem carga que justifique escala independente.
- **Nada do analytics e consumido por outro servico.** Hoje so o `apps/web` o
  usa. Servico que tem um unico cliente no mesmo processo e cerimonia.

## Critario de extracao

Extrair quando **duas** das condicoes abaixo valerem ao mesmo tempo. Uma so nao
basta: qualquer uma isolada tem solucao mais barata que um processo novo.

| Condicao                       | Como medir                                                                                     | Por que importa                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Recalculo competindo com a API | p95 de `/v1` sobe durante recalculo                                                            | E o sinal classico de que a carga precisa de isolamento, nao de modulo |
| Segundo consumidor             | Outro servico, ou API publica, lendo indicador                                                 | Dois clientes justificam contrato e versao propria                     |
| Escala assimetrica             | Recalculo precisa de mais CPU ou memoria que a API em um fator que atrapalhe o dimensionamento | Deixa de ser razoavel escalar os dois juntos                           |
| Cadencia de deploy conflitante | Mudanca de formula sendo adiada por causa de release do app, ou o contrario                    | Acoplamento de implantacao cobrando preco                              |
| Time separado                  | Mais de uma pessoa tocando so o analytics                                                      | Fronteira de equipe quer fronteira de artefato                         |

E **nao** extrair por: o pacote ficou grande, o schema tem muitas tabelas, ou
"microservico e mais moderno". Nenhum dos tres e sintoma de problema.

## Consequencias

### Positivas

- Extracao continua sendo mover pacote e apontar para outra URL, nao
  arqueologia de joins.
- Formulas sao funcoes puras sobre DTO, testaveis sem banco: 85 testes, sem
  container, incluindo conferencia contra o DFP real da CVM.
- O screener consulta um schema so, com indices proprios, o que torna a meta de
  300 ms alcancavel.
- A fronteira e verificavel: um import de `services/market-data` ou um
  `market_data.` em SQL do analytics sao detectaveis por grep, e podem virar
  check de CI.

### Negativas

- `assets_mirror` e `daily_returns` sao copia, com atraso e com o risco de
  divergir da fonte se um evento se perder. Precisa de reconciliacao periodica,
  que ainda nao existe.
- Duas migrations a manter (`packages/db-core` e `packages/analytics`), com dois
  journals.
- Dado de mercado chega por API ou evento, o que e mais lento e mais verboso que
  um join. E a troca central desta decisao.
- A regra "nao ler `market_data`" depende de disciplina enquanto nao houver
  check automatico.

## Pendencias

1. **Check de CI da fronteira:** reprovar import de `services/market-data` em
   `packages/analytics`, e reprovar `market_data.` em SQL do analytics. Hoje a
   regra e so disciplina.
2. **Reconciliacao do espelho:** job periodico comparando `assets_mirror` com
   `GET /v1/assets`, para evento perdido nao virar divergencia permanente.
3. **Medir a meta de 300 ms** quando houver universo carregado.
4. **Decidir usuario de banco separado** por schema. Com usuarios distintos, a
   regra 1 deixa de depender de disciplina e passa a ser negada pelo Postgres.
