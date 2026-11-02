# portfolio

Carteiras, transacoes e rentabilidade. Pacote `packages/portfolio`, schema
`portfolio` no banco.

Nao le `market_data` nem `analytics`: preco e evento corporativo entram pela API
`/v1` ou por evento, pelo mesmo motivo do ADR 0009, do analytics: copia local em vez de join
entre schemas de servicos diferentes.

## Estado atual

| Parte                                                               | Estado                                                   |
| ------------------------------------------------------------------- | -------------------------------------------------------- |
| Apuracao: preco medio, posicao, resultado realizado e nao realizado | pronto, conferido contra calculo independente            |
| TWR diario e comparacao com benchmark                               | pronto                                                   |
| Eventos corporativos aplicados a carteira                           | pronto                                                   |
| Importacao de CSV e do extrato da B3                                | pronto, 500 linhas em menos de 5 s                       |
| Alocacao e proventos por mes                                        | pronto                                                   |
| Schema com RLS forcada                                              | pronto, 12 testes contra Postgres real                   |
| Autenticacao (Better Auth)                                          | **nao implementada**, depende de `apps/web`              |
| Telas `/carteiras`                                                  | **nao implementadas**, dependem de `apps/web`            |
| Snapshot diario gravado                                             | **nao implementado**, a tabela existe e o calculo tambem |
| Exportacao e exclusao LGPD                                          | **nao implementadas**                                    |

## Modelo de dados

| Tabela         | Chave                             | Hypertable        |
| -------------- | --------------------------------- | ----------------- |
| `portfolios`   | `id`, unico por `(user_id, nome)` | nao               |
| `transactions` | `id`                              | nao               |
| `snapshots`    | `(portfolio_id, data)`            | sim, chunk mensal |
| `imports`      | `id`                              | nao               |
| `audit_log`    | `id`                              | nao               |

`transactions.user_id` e redundante com `portfolios.user_id` de proposito: sem
ele, a politica de RLS da tabela precisaria de subconsulta no `portfolios` a
cada linha, e o planejador nao usa indice nisso. Duplicar o dono e o preco de a
RLS ser barata.

`transactions` tem indice unico em `(portfolio_id, origem_evento_id)`. E o que
torna o reprocessamento de evento corporativo idempotente: a entrega e
at-least-once ([ADR 0008](../adr/0008-outbox-e-jetstream.md)), e sem isso um
desdobramento reprocessado dobraria a posicao do usuario.

## Apuracao

Regras do mercado brasileiro que mudam o numero:

1. **Taxa de compra entra no custo.** Corretagem e emolumentos compoem o custo
   de aquisicao, entao sobem o preco medio.
2. **Venda nao altera o preco medio.** Ela realiza resultado contra o preco
   medio vigente e reduz a quantidade. Recalcular a media na venda e o erro mais
   comum, e produz resultado errado em toda venda parcial seguinte.
3. **Taxa de venda reduz o resultado**, nao o custo da posicao remanescente.
4. **Desdobramento e grupamento** multiplicam a quantidade e dividem o preco
   medio pelo mesmo fator. O custo total nao muda, porque nao houve desembolso.
5. **Provento** nao mexe em quantidade nem em preco medio.

As transacoes sao ordenadas por data antes da apuracao. A ordem altera o
resultado realizado, e confiar na ordem de insercao seria um bug silencioso
quando o CSV vem fora de ordem.

### Conferencia

`src/carteira.test.ts` apura uma carteira de 10 transacoes com um desdobramento
e tres proventos. Os valores esperados foram calculados **fora** desta
implementacao, com `Decimal` do Python, a partir das mesmas transacoes.

|                     | PETR4          | VALE3    |
| ------------------- | -------------- | -------- |
| Quantidade          | 180 (apos 1:2) | 50       |
| Preco medio         | 18,026667      | 61,26    |
| Custo total         | 3.244,80       | 3.063,00 |
| Resultado realizado | 350,80         | 182,00   |
| Proventos           | 201,00         | 120,00   |

Totais: realizado 532,80, proventos 321,00, taxas 25,00.

## TWR

$$r_t = \frac{V_t}{V_{t-1} + CF_t} - 1 \qquad \text{TWR} = \prod_{t}(1 + r_t) - 1$$

O TWR mede a decisao de alocacao, nao o tamanho do aporte: ele neutraliza fluxo
de caixa. Quem quiser o resultado em reais usa resultado realizado e nao
realizado.

**Convencao: fluxo no inicio do dia.** O aporte entra no denominador, ou seja,
participa do retorno daquele dia. A convencao oposta daria numeros diferentes, e
a escolha precisa estar escrita porque nao e deduzivel do resultado.

O primeiro dia nao tem retorno: nao existe $V_{t-1}$. Devolve `null`, nao zero,
porque zero significaria "nao rendeu".

O benchmark recebe os mesmos dias, **nao os mesmos fluxos**. Comparar com um
benchmark que sofresse os aportes mediria outra coisa.

## Eventos corporativos

Chegam de `marketdata.dividend.announced.v1` e viram transacao:

| Evento             | Transacao gerada            | Efeito                                                       |
| ------------------ | --------------------------- | ------------------------------------------------------------ |
| `dividendo`, `jcp` | `provento`                  | caixa; nao mexe em posicao                                   |
| `desdobramento`    | `desdobramento` com o fator | quantidade x fator, preco medio / fator                      |
| `grupamento`       | `grupamento` com o fator    | quantidade / fator, preco medio x fator                      |
| `bonificacao`      | `bonificacao`               | quantidade nova ao preco de emissao; sem preco, a custo zero |

**Razao.** `"1:2"` em desdobramento significa que cada acao vira duas, fator 2.
`"10:1"` em grupamento significa que dez viram uma, e o fator guardado e 10.
Ler na ordem errada inverte a posicao do usuario por um fator de 100 em casos
reais, e e um erro que nao aparece em teste com razao 1:1.

**Posicao zero na data ex nao recebe nada.** Aplicar o evento ali criaria
quantidade do nada.

## Layout do CSV

Cabecalho obrigatorio. Separador `;` ou `,`, detectado no cabecalho -- nao numa
linha de dados, porque valor em pt-BR usa virgula decimal e a deteccao sairia
errada.

| Coluna       | Obrigatoria | Formato                                                                     |
| ------------ | ----------- | --------------------------------------------------------------------------- |
| `data`       | sim         | `YYYY-MM-DD` ou `DD/MM/YYYY`                                                |
| `ticker`     | sim         | 4 a 12 caracteres, normalizado para maiuscula                               |
| `tipo`       | sim         | `compra`, `venda`, `provento`, `desdobramento`, `grupamento`, `bonificacao` |
| `quantidade` | sim         | decimal; em desdobramento, o fator                                          |
| `preco`      | sim         | decimal; `0` em desdobramento                                               |
| `taxas`      | nao         | decimal, padrao `0`                                                         |
| `corretora`  | nao         | texto                                                                       |

```csv
data;ticker;tipo;quantidade;preco;taxas;corretora
15/01/2024;PETR4;compra;100;35,00;5,00;XP
05/03/2024;PETR4;provento;150;0,80;0;XP
10/06/2024;PETR4;desdobramento;2;0;0;
```

Numero em pt-BR e aceito: `1.234,56` vira `1234.56`. A ordem da conversao
importa -- o ponto de milhar sai antes da virgula decimal; na ordem inversa,
`1.234,56` viraria `1.234.56`.

**O importador nao para na primeira linha ruim.** Uma planilha de 500 linhas com
tres datas erradas importa 497 e relata as tres, com numero de linha, motivo e
conteudo original. Abortar tudo obriga o usuario a caçar o erro sem ajuda.

Cabecalho sem coluna obrigatoria rejeita o arquivo inteiro, nao cada linha: o
problema e do arquivo.

### Extrato da B3

O arquivo exportado da area do investidor usa cabecalho proprio e
"Compra"/"Venda" em `Tipo de Movimentação`. O importador mapeia para o layout
interno. Movimentacao que nao e compra nem venda (transferencia, por exemplo) e
rejeitada com motivo, sem abortar o arquivo. O sufixo `F` do fracionario
(`PETR4F`) e removido.

## Seguranca

Duas barreiras, nesta ordem:

1. **Filtro por usuario na consulta da aplicacao.** E a barreira principal.
2. **RLS no Postgres.** Existe para o caso em que a primeira falha: query nova
   sem `WHERE`, ID vindo do cliente sem validacao, bug de ORM.

Detalhes sem os quais a RLS nao protege nada estao no
[ADR 0011](../adr/0011-rls.md). O resumo operacional:

- A aplicacao conecta com `bolsiq_app`: **nao e dono das tabelas e nao tem
  BYPASSRLS**.
- `FORCE ROW LEVEL SECURITY` em todas as tabelas, senao o dono ignora as
  politicas.
- **Superusuario ignora a RLS**, e `FORCE` nao alcanca superusuario. Rodar a
  aplicacao como `postgres` anula a barreira inteira. Isto esta verificado em
  teste, e e o motivo de `DATABASE_URL_APP` existir separado de `DATABASE_URL`.
- O usuario da sessao vem de `SET LOCAL bolsiq.user_id`, nunca `SET`: sem
  `LOCAL`, o usuario vaza para a proxima requisicao que pegar a mesma conexao
  do pool.

`audit_log` e append-only, garantido por `REVOKE UPDATE, DELETE` e por politica
separada de `SELECT` e `INSERT`. Nem a aplicacao reescreve auditoria.

## Pendencias

1. **Better Auth e as telas**, que dependem de `apps/web`.
2. **Snapshot diario gravado**: a tabela e o calculo existem; falta o job.
3. **Rate limit no login** e auditoria dos eventos de autenticacao.
4. **LGPD**: exportacao e exclusao dos dados do usuario.
5. **Teste E2E de isolamento entre usuarios**, que precisa de sessao real. O que
   existe hoje cobre a camada de banco, que e a barreira mais profunda.
