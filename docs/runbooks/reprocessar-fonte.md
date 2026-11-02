# Runbook: reprocessar uma fonte

Forçar a releitura de uma fonte de dados do `market-data`.

**Quando usar:** a fonte republicou o arquivo e o conteúdo mudou; um bug no
parser gravou dado errado; uma carga parou no meio; uma empresa reapresentou
demonstrativo e o número precisa ser corrigido.

**Antes de começar:** leia
[market-data-sources.md](../services/market-data-sources.md) para saber o que a
fonte publica e com que frequência. Reprocessar fonte errada é barato;
reprocessar a certa do jeito errado duplica dado.

## Como a idempotência funciona

Cada download grava uma linha em `fetch_log` com o hash do arquivo. Antes de
processar, o adapter compara o hash do que baixou com o último registrado:

- **hash igual** → não reprocessa, registra a verificação e encerra;
- **hash diferente** → processa e grava o hash novo.

É por isso que a agenda pode conferir DFP/ITR toda semana sem custo: o arquivo
quase nunca muda, e quando não muda nada acontece.

Dentro do processamento, a idempotência vem da chave natural, não do hash:

| Tabela | Chave natural | Conflito resolve em |
| --- | --- | --- |
| `assets` | `cnpj` | `upsert` |
| `quotes_daily` | `(ticker, date)` | `upsert` |
| `financial_statements` | `(cvm_code, reference_date, account_code, is_consolidated)` | `upsert` da maior `versao` |
| `fund_daily` | `(cnpj_fundo, date)` | `upsert` |
| `macro_series` | `(series_code, date)` | `upsert` |

Rodar o mesmo job duas vezes é seguro mesmo que o hash seja apagado: o segundo
passe sobrescreve as mesmas linhas com os mesmos valores.

## 1. Veja o estado dos jobs

```bash
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3001/admin/jobs | jq .
```

Devolve, por job: última execução, duração, resultado, número de tentativas e a
última mensagem de erro.

## 2. Rode um job agora

```bash
curl -s -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3001/admin/jobs/cvm-cadastro/run | jq .
```

Nomes dos jobs:

| Job | Fonte |
| --- | --- |
| `cvm-cadastro` | cadastro de companhias abertas |
| `cvm-dfp` | demonstrações anuais |
| `cvm-itr` | demonstrações trimestrais |
| `cvm-fundos` | informe diário de fundos |
| `b3-cotahist-diario` | COTAHIST do dia |
| `b3-cotahist-anual` | COTAHIST de um ano |
| `bcb-sgs` | séries do SGS |
| `ajuste-proventos` | recálculo de `adj_close` |

Se o hash não mudou, o job encerra sem fazer nada. Para forçar, veja o passo 3.

## 3. Force a releitura de um arquivo que não mudou

Caso típico: o parser tinha bug, o arquivo é o mesmo, e o dado gravado está
errado.

```sql
-- Qual o estado atual
SELECT source, source_ref, fetched_at, content_hash, status
FROM fetch_log
WHERE source = 'cvm-dfp'
ORDER BY fetched_at DESC
LIMIT 10;

-- Invalida um arquivo específico
DELETE FROM fetch_log
WHERE source = 'cvm-dfp' AND source_ref = 'dfp_cia_aberta_2023.zip';
```

Depois rode o job do passo 2. Apague **apenas as linhas do arquivo que vai
reprocessar** — um `DELETE` largo faz a próxima execução baixar tudo de novo.

## 4. Carga histórica

```bash
make backfill FROM=2023
```

Processa, do ano indicado até o atual: COTAHIST anual, DFP e ITR. É longo (anos
de COTAHIST somam gigabytes) e seguro de repetir.

Para uma fonte só:

```bash
make backfill FROM=2023 ONLY=cvm-dfp
```

## 5. Quando o dado gravado está errado, não só ausente

Apagar o `fetch_log` e reprocessar **sobrescreve** as linhas existentes, mas não
remove as que não deveriam existir. Se o bug criou linhas a mais — por exemplo
esqueceu o filtro `ORDEM_EXERC = 'ÚLTIMO'` e gravou o exercício anterior como se
fosse o corrente — é preciso apagar antes:

```sql
-- Confira o tamanho do estrago antes de apagar
SELECT cvm_code, reference_date, COUNT(*), COUNT(DISTINCT version)
FROM financial_statements
WHERE source = 'cvm-dfp' AND reference_date >= '2023-01-01'
GROUP BY 1, 2
HAVING COUNT(*) > COUNT(DISTINCT account_code);
```

```sql
-- Em transação, para poder desistir
BEGIN;
DELETE FROM financial_statements
WHERE source = 'cvm-dfp'
  AND reference_date BETWEEN '2023-01-01' AND '2023-12-31';
-- confira o COUNT antes de confirmar
COMMIT;
```

Só então reprocesse. Em produção, faça isso com o worker parado
(`ROLE=worker` escalado para zero) para não competir com o job agendado.

## 6. Falha de download

O job tenta de novo com backoff exponencial. Depois da última tentativa, o
registro fica com `status = 'failed'` e a mensagem aparece em `/admin/jobs`.

```bash
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3001/admin/jobs | jq '.jobs[] | select(.status=="failed")'
```

| Sintoma | Causa provável | O que fazer |
| --- | --- | --- |
| HTTP 404 na CVM | Arquivo do ano ainda não publicado | Normal no início do ano; não é erro |
| HTTP 406 no BCB | Janela de datas longa demais em série diária | Fatiar em janelas de até 3 anos |
| HTTP 403 na B3 | Bloqueio de coleta automatizada | Ver a seção de licenças em market-data-sources.md; não insista com retry |
| ZIP corrompido | Download interrompido | O hash difere do esperado; o retry resolve |
| Timeout | Arquivo grande em rede lenta | Aumente o timeout do job, não o número de tentativas |
| `invalid byte sequence` | Leitura sem `latin1` | Bug no parser, não na fonte |

Retry não resolve erro de licença nem erro de parser. Se o `status` é `failed` e
a causa é 403 ou decodificação, parar e corrigir é mais rápido que insistir.

## 7. Confira

```sql
-- As cargas mais recentes, por fonte
SELECT source, MAX(fetched_at) AS ultima, COUNT(*) FILTER (WHERE status='failed') AS falhas
FROM fetch_log
GROUP BY source
ORDER BY ultima DESC;

-- Duplicata na chave natural: deve devolver zero linhas
SELECT ticker, date, COUNT(*)
FROM quotes_daily
GROUP BY 1, 2 HAVING COUNT(*) > 1;

SELECT cnpj_fundo, date, COUNT(*)
FROM fund_daily
GROUP BY 1, 2 HAVING COUNT(*) > 1;
```

Qualquer linha na segunda ou na terceira consulta é bug de idempotência, não
dado ruim da fonte. Abra issue com a label `tipo:bug`.
