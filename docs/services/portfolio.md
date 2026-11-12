# portfolio

Carteiras, transacoes e rentabilidade. Pacote `packages/portfolio`, schema
`portfolio` no banco.

Nao le `market_data` nem `analytics`: preco e evento corporativo entram pela API
`/v1` ou por evento, pelo mesmo motivo do ADR 0009, do analytics: copia local em vez de join
entre schemas de servicos diferentes.

## Estado atual

| Parte                                                               | Estado                                                         |
| ------------------------------------------------------------------- | -------------------------------------------------------------- |
| Apuracao: preco medio, posicao, resultado realizado e nao realizado | pronto, conferido contra calculo independente                  |
| TWR diario e comparacao com benchmark                               | pronto                                                         |
| Eventos corporativos aplicados a carteira                           | pronto                                                         |
| Importacao de CSV e do extrato da B3                                | pronto, 500 linhas em menos de 5 s                             |
| Importacao de posicoes (renda fixa, fundos, COE)                    | pronto; valor pelo extrato (ADR 0025)                          |
| Importacao com IA, qualquer formato                                 | pronto: [importacao-ia.md](importacao-ia.md) (ADR 0026 e 0027) |
| Alocacao e proventos por mes                                        | pronto                                                         |
| Schema com RLS forcada                                              | pronto, 12 testes contra Postgres real                         |
| Autenticacao (Better Auth)                                          | pronto: `packages/auth`, telas no `apps/web` (ADR 0022)        |
| Telas `/carteiras`                                                  | prontas no `apps/web` ([web.md](web.md#carteira))              |
| Snapshot diario gravado                                             | pronto: `portfolio-worker`, job e recalculo por marcacao       |
| Exportacao e exclusao LGPD                                          | pronto: `/configuracoes/conta`                                 |

## Modelo de dados

| Tabela              | Chave                             | Hypertable        |
| ------------------- | --------------------------------- | ----------------- |
| `portfolios`        | `id`, unico por `(user_id, nome)` | nao               |
| `transactions`      | `id`                              | nao               |
| `snapshots`         | `(portfolio_id, data)`            | sim, chunk mensal |
| `imports`           | `id`                              | nao               |
| `audit_log`         | `id`                              | nao               |
| `posicoes`          | `id`, unico parcial se `vigente`  | nao               |
| `cargas_de_posicao` | `(portfolio_id, corretora)`       | nao               |

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
6. **Saldo inicial** (carga de posicao) entra como compra: soma no custo e no
   preco medio.

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

$$r_t = \frac{V_t + S_t}{V_{t-1} + A_t} - 1 \qquad \text{TWR} = \prod_{t}(1 + r_t) - 1$$

O TWR mede a decisao de alocacao, nao o tamanho do aporte: ele neutraliza fluxo
de caixa. Quem quiser o resultado em reais usa resultado realizado e nao
realizado.

**Convencao: aporte no inicio do dia, retirada no fim.** $A_t$ e o fluxo
liquido positivo (compra) e entra no denominador: o aporte participa do retorno
daquele dia; `saldo_inicial` e aporte igual a compra. $S_t$ e a retirada (venda, provento) e volta ao numerador. Com a
retirada no inicio, o dia em que a carteira vende tudo daria -100% (ADR 0022).

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

## Layout de posicao

Terceiro formato, `posicao_bolsiq`: a fotografia da carteira numa data, com todas
as classes. O importador o reconhece pelo cabecalho (presenca de `data_posicao` e
`classe`); o seletor da tela segue como opcao manual. Decisao no
[ADR 0025](../adr/0025-posicoes-sem-ticker.md). Para gerar o arquivo a partir dos
extratos, ha um [prompt pronto](../importacao/prompt-normalizacao.md), e a tela
importa qualquer formato com IA ([importacao-ia.md](importacao-ia.md)), pelos mesmos
validadores.

CSV UTF-8, separador `,` ou `;`, ponto decimal (numero em pt-BR tambem e aceito
com `;`). Aspas valem: `"COE, Ouro"` e um campo so. O cabecalho e exatamente:

```csv
data_posicao,corretora,classe,subclasse,ativo,codigo,cnpj,emissor,indexador,pct_indexador,taxa_aa,data_aplicacao,vencimento,liquidez_diaria,quantidade,preco_unitario,preco_medio,valor_aplicado,saldo_bruto,ir,iof,saldo_liquido,valorizacao,observacao
```

| Coluna            | Obrigatoria                                             | Formato                                                                                                                      |
| ----------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `data_posicao`    | sim                                                     | `AAAA-MM-DD` ou `DD/MM/AAAA`; uma por corretora                                                                              |
| `corretora`       | sim                                                     | texto; mesma grafia entre cargas                                                                                             |
| `classe`          | sim                                                     | `acao`, `fii`, `bdr`, `etf`, `renda_fixa`, `titulo_publico`, `fundo`, `previdencia`, `coe`, `estruturado`, `cripto`, `outro` |
| `subclasse`       | nao                                                     | texto                                                                                                                        |
| `ativo`           | sim, ou `codigo` preenchido                             | texto                                                                                                                        |
| `codigo`          | `acao`, `fii`, `bdr`, `etf` (ticker) e `titulo_publico` | texto                                                                                                                        |
| `cnpj`            | nao; falta vira pendencia                               | 14 digitos, com ou sem pontuacao                                                                                             |
| `emissor`         | nao                                                     | texto                                                                                                                        |
| `indexador`       | nao                                                     | `CDI`, `SELIC`, `IPCA`, `IGPM`, `PRE` ou vazio                                                                               |
| `pct_indexador`   | nao                                                     | fracao, ate 5: 120% do CDI e `1.20`                                                                                          |
| `taxa_aa`         | nao                                                     | fracao, ate 1: 14,69% e `0.1469`                                                                                             |
| `data_aplicacao`  | nao                                                     | data                                                                                                                         |
| `vencimento`      | nao                                                     | data                                                                                                                         |
| `liquidez_diaria` | nao                                                     | `S`, `N` ou vazio                                                                                                            |
| `quantidade`      | `acao`, `fii`, `bdr`, `etf`                             | decimal nao negativo                                                                                                         |
| `preco_unitario`  | nao                                                     | decimal                                                                                                                      |
| `preco_medio`     | nao; falta vira pendencia na renda variavel             | decimal                                                                                                                      |
| `valor_aplicado`  | nao                                                     | decimal                                                                                                                      |
| `saldo_bruto`     | sim                                                     | decimal                                                                                                                      |
| `ir`, `iof`       | nao                                                     | decimal                                                                                                                      |
| `saldo_liquido`   | nao                                                     | decimal                                                                                                                      |
| `valorizacao`     | sim                                                     | `cotacao_b3`, `curva`, `tesouro`, `cota_cvm`, `manual`                                                                       |
| `observacao`      | nao; preenchida vira pendencia                          | texto                                                                                                                        |

**Vazio nao e zero.** Campo numerico vazio fica nulo, porque `normalizarNumero`
devolveria `"0"` e um fundo sem saldo pareceria zerado.

**Linha ruim nao aborta.** Rejeita com numero da linha e motivo. Sao rejeitadas
tambem a linha com data mais antiga que a mais recente da mesma corretora e o
ativo repetido na corretora (some as duas linhas): a soma nao bateria com extrato
nenhum, e a repetida violaria o indice unico.

**Pendencia nao rejeita.** Fundo ou previdencia sem CNPJ; renda fixa sem data de
aplicacao ou sem taxa (`taxa_aa` ou `pct_indexador`: um CDB a 120% do CDI nao tem
taxa ao ano a informar); titulo publico sem taxa; renda variavel sem preco medio;
qualquer `observacao`.

### Identidade do ativo

`chave_ativo` e o que evita duplicar entre cargas:

| Classe                                                          | Chave                                                                          |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `acao`, `fii`, `bdr`, `etf`, `titulo_publico`, `coe` com codigo | classe e codigo                                                                |
| `fundo`, `previdencia`                                          | CNPJ; sem ele, classe e nome normalizado                                       |
| `renda_fixa`                                                    | emissor (ou nome), indexador, taxa, percentual, vencimento e data de aplicacao |
| demais                                                          | classe e nome normalizado                                                      |

Nome normalizado: maiusculas, sem acento, sem espaco duplicado. Numero na chave
passa por `Decimal`, para `1.20` e `1.2` serem o mesmo CDB. Preencher o CNPJ de um
fundo muda a chave: na recarga, a linha aparece como nova e a antiga como removida.

### Regras de carga

A revisao (`POST /api/carteiras/:id/importacoes/revisao`) nao grava. A confirmacao
(`POST /api/carteiras/:id/importacoes`, com `decisoes`) refaz a comparacao e grava
tudo numa transacao de banco, com `imports` e `audit_log`.

- **Renda variavel com ticker** (`acao`, `fii`, `bdr`, `etf`) vira transacao, nao
  linha em `posicoes`:
  - Sem transacao do ticker na corretora: `saldo_inicial` com a quantidade, ao
    `preco_medio` (sem ele, `valor_aplicado` / quantidade; sem ele, o preco do
    extrato) na `data_posicao`.
  - Com transacao: nada automatico. Divergencia ("PETR4: sistema 30, extrato 33")
    vai para a revisao; "gerar ajuste" vira compra ou venda na `data_posicao` ao
    `preco_unitario` (sem ele, saldo / quantidade), "ignorar" nao muda nada.
  - **Transacao sem corretora conta como desta corretora** (extrato da B3,
    lancamento sem o campo, evento corporativo): sem isso, a quantidade dobraria.
  - Ticker com saldo em transacoes da corretora e fora do extrato aparece como
    divergencia sem ajuste: nao ha preco para a venda, que se lanca pelo formulario.
- **Demais classes** vao para `posicoes`. A carga mais recente da corretora desliga
  as vigentes dela (`vigente = false`) e grava as novas; as outras corretoras nao
  mudam. Linha ausente na carga nova deixa de valer.
- **Carga com data igual ou anterior a da corretora e recusada**, e o arquivo
  inteiro volta: a data de cada corretora fica em `cargas_de_posicao`, que cobre a
  corretora so com renda variavel. Corretora sem linha valida no arquivo nao e
  tocada.
- A comparacao de carga por corretora usa a grafia exata: `XP` e `xp` seriam duas.

### Valor e alocacao

- O valor atual de posicao sem ticker e o `saldo_bruto` da carga vigente, marcado na
  tela como "valor do extrato de DD/MM", ate existir a valorizacao por curva,
  Tesouro e cota da CVM.
- Patrimonio e alocacao somam renda variavel a mercado e posicoes vigentes. Classes
  na alocacao: Acoes, FIIs, BDRs, ETFs, Fundos, Renda fixa, Titulos publicos,
  Previdencia, COE, Estruturados, Cripto, Outros. No agrupamento por setor, a
  posicao entra com o rotulo da classe.
- "Nao realizado" segue so na renda variavel: saldo de extrato nao tem custo aqui.

### Limitacoes do TWR

O TWR e o snapshot continuam so na renda variavel, com `saldo_inicial` como fluxo.
Posicao sem ticker nao tem fluxo: nao ha retorno a medir, e a tela avisa. Transacoes
anteriores a `data_posicao`, importadas depois do saldo inicial, dobram a quantidade
e aparecem como divergencia na carga seguinte.

## Seguranca

Duas barreiras, nesta ordem:

1. **Filtro por usuario na consulta da aplicacao.** E a barreira principal.
2. **RLS no Postgres.** Existe para o caso em que a primeira falha: query nova
   sem `WHERE`, ID vindo do cliente sem validacao, bug de ORM.

Detalhes sem os quais a RLS nao protege nada estao no
[ADR 0011](../adr/0011-rls.md). O resumo operacional:

- Toda transacao da aplicacao no `portfolio` passa por `comoUsuario`, que faz
  `SET LOCAL ROLE bolsiq_app` (**nao e dono das tabelas e nao tem
  BYPASSRLS**) e `SET LOCAL bolsiq.user_id` (ADR 0022).
- `FORCE ROW LEVEL SECURITY` em todas as tabelas, senao o dono ignora as
  politicas.
- **Superusuario ignora a RLS**, e `FORCE` nao alcanca superusuario. Rodar a
  aplicacao como `postgres` anula a barreira inteira. Isto esta verificado em
  teste, e e o motivo de trocar o papel dentro da transacao.
- O usuario da sessao vem de `SET LOCAL bolsiq.user_id`, nunca `SET`: sem
  `LOCAL`, o usuario vaza para a proxima requisicao que pegar a mesma conexao
  do pool.

`audit_log` e append-only, garantido por `REVOKE UPDATE, DELETE` e por politica
separada de `SELECT` e `INSERT`. Nem a aplicacao reescreve auditoria.

## Snapshot diario

`services/portfolio-worker` (ADR 0022):

- O app marca `portfolios.recalcular_desde` em toda transacao nova e
  importacao. O worker procura carteiras marcadas a cada `RECALCULO_MS`
  (2 s), recalcula a serie inteira com `snapshotsDiarios` e regrava
  `snapshots`, como o dono da carteira (mesma RLS).
- O job `portfolio.snapshot-diario` (pg-boss, `SNAPSHOT_CRON`, padrao 19h de
  dias uteis em Brasilia) marca todas as carteiras: e o snapshot do
  fechamento.
- Preco: `/v1/history?adjusted=false`. Ativo sem fechamento entra pelo custo.
- O mesmo processo aplica as migrations dos schemas `app` e `portfolio`
  (`portfolio-migrate` no compose).
- Tambem consome a fila `assistant.importacao`: a importacao com IA em segundo
  plano, com OCR e leitura de PDF na imagem dele ([importacao-ia.md](importacao-ia.md),
  ADR 0027).

## LGPD

Em `/configuracoes/conta`: exportar tudo em JSON e excluir a conta. A
exclusao apaga carteira, transacoes, snapshots, importacoes, auditoria,
alertas, watchlist, os dados do assistente e a conta (ADR 0022 e 0024). A chave de
provedor cifrada nao entra na exportacao. `posicoes` e `cargas_de_posicao` entram
na exportacao e caem com a carteira, pela FK.

## Pendencias

1. **Auditoria dos eventos de autenticacao** (login, 2FA, troca de senha) no
   `audit_log`. Hoje so as acoes na carteira sao auditadas.
2. **Check que reprove acesso ao `portfolio` fora de `comoUsuario`.**
3. **Editar e apagar transacao** pela tela.
4. **Caixa** da carteira: o design mostra uma linha de caixa; ainda nao ha
   transacao de deposito ou saque.
