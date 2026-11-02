# API Bolsiq — guia do cliente

Autenticação, limites, erros e exemplos de uso da API pública do Bolsiq.

> **Especificação, não documentação.** A API ainda não foi implementada. Este
> documento define o contrato que a implementação deve cumprir — nomes de
> header, códigos de erro, formato da chave — para que o cliente não precise ser
> reescrito depois. Enquanto não houver serviço, os exemplos não respondem.
>
> Uma parte ainda pode mudar: a revogação de chave tem efeito imediato ou com
> atraso, conforme a decisão pendente no [ADR 0007](../adr/0007-gateway-e-planos.md).

## Base

```
https://api.bolsiq.com/v1
```

Versão no caminho. Mudança incompatível em `/v1` não acontece: quando for
necessária, nasce `/v2`, e `/v1` continua. Campo novo e endpoint novo são
compatíveis e podem aparecer em `/v1` sem aviso — seu código deve ignorar campo
que não conhece.

## Autenticação

Toda requisição leva a chave no header:

```
X-API-Key: mdk_live_a1b2c3d4e5f6...
```

Dois endpoints não exigem chave:

| Endpoint | Para que serve |
| --- | --- |
| `GET /v1/health` | monitoração |
| `GET /v1/openapi.json` | especificação OpenAPI, para gerar cliente |

### Formato da chave

```
mdk_live_<32 caracteres>
```

O prefixo `mdk_live_` é fixo e serve a dois propósitos: você reconhece a chave
num arquivo de configuração sem decifrá-la, e varredores de segredo (como o
gitleaks) detectam o padrão se ela for commitada por acidente.

**Guardamos apenas o hash da sua chave.** Ela é exibida uma única vez, na
criação. Se perder, rotacione — não há como recuperá-la.

### Onde não colocar a chave

Na query string, não. A chave em URL vai para log de servidor, histórico de
navegador e header `Referer`. Use sempre o header.

Em código de front-end, também não. Chave em JavaScript que roda no navegador é
chave pública. Para front-end, faça a chamada pelo seu próprio back-end.

## Planos e limites

| | `free` | `startup` | `pro` |
| --- | --- | --- | --- |
| Requisições por minuto | 20 | 120 | 600 |
| Requisições por mês | 10.000 | 500.000 | 5.000.000 |
| Tickers por chamada | 5 | 50 | 200 |
| Cotações e histórico | sim | sim | sim |
| Fundos | sim | sim | sim |
| Benchmarks macro | sim | sim | sim |
| `fundamentals` | **não** | sim | sim |
| WebSocket | não | sim | sim |

Os números acima são a proposta inicial e precisam ser confirmados antes do
primeiro cliente.

### Headers de limite

Toda resposta traz o estado do seu limite:

```
X-RateLimit-Limit: 120
X-RateLimit-Remaining: 117
X-RateLimit-Reset: 1762041600
X-Correlation-ID: 01JBQ7X8N4K2M9P3R5T7V9W1Y3
```

`X-RateLimit-Reset` é epoch em segundos. `X-Correlation-ID` identifica a
requisição ponta a ponta — **inclua-o ao abrir um suporte**, é por ele que
achamos sua requisição nos nossos logs.

Leia `X-RateLimit-Remaining` e desacelere antes de chegar a zero. É mais barato
que tratar 429.

## Erros

Formato único:

```json
{
  "error": {
    "code": "rate_limit_exceeded",
    "message": "Limite de 120 requisições por minuto excedido.",
    "correlation_id": "01JBQ7X8N4K2M9P3R5T7V9W1Y3"
  }
}
```

| HTTP | `code` | O que aconteceu | O que fazer |
| --- | --- | --- | --- |
| 400 | `too_many_tickers` | Mais tickers do que o plano permite | Fatie a chamada; o campo `max` diz o limite |
| 401 | `missing_api_key` | Header `X-API-Key` ausente | Envie a chave |
| 401 | `invalid_api_key` | Chave inexistente ou revogada | Confira a chave; se foi revogada, crie outra |
| 403 | `plan_upgrade_required` | Endpoint fora do seu plano | O campo `required_plan` diz o mínimo |
| 404 | `not_found` | Ticker ou fundo inexistente | Confira o identificador |
| 422 | `validation_error` | Parâmetro malformado | O campo `details` aponta o parâmetro |
| 429 | `rate_limit_exceeded` | Acima do limite | **Espere o que diz `Retry-After`** |
| 500 | `internal_error` | Erro nosso | Tente de novo com backoff; persistindo, abra suporte com o `correlation_id` |
| 503 | `source_unavailable` | Fonte de dados indisponível | Erro temporário; tente mais tarde |

Chave revogada devolve **401**, não 403. É deliberado: 403 revelaria que a
chave existe.

### Como tratar 429

A resposta traz `Retry-After` em segundos. Respeite-o — não é sugestão, e
reenviar antes só consome limite.

```
HTTP/1.1 429 Too Many Requests
Retry-After: 43
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1762041643
```

Não faça retry imediato em laço. Use backoff exponencial com jitter, e respeite
`Retry-After` quando presente.

## Seu consumo

```bash
curl -H "X-API-Key: $BOLSIQ_API_KEY" \
  https://api.bolsiq.com/v1/me/usage
```

```json
{
  "plan": "startup",
  "period": { "start": "2026-11-01", "end": "2026-11-30" },
  "requests": { "used": 18432, "limit": 500000 },
  "rate_limit": { "per_minute": 120 },
  "by_day": [
    { "date": "2026-11-01", "requests": 1203, "errors": 4 }
  ]
}
```

O consumo aparece em até um minuto após a requisição.

## Exemplos

### curl

```bash
export BOLSIQ_API_KEY="mdk_live_..."

# Cotação
curl -sH "X-API-Key: $BOLSIQ_API_KEY" \
  "https://api.bolsiq.com/v1/quotes/PETR4" | jq .

# Várias, respeitando o limite de tickers do plano
curl -sH "X-API-Key: $BOLSIQ_API_KEY" \
  "https://api.bolsiq.com/v1/quotes?tickers=PETR4,VALE3,ITUB4" | jq .

# Ver os headers de limite
curl -sD - -o /dev/null -H "X-API-Key: $BOLSIQ_API_KEY" \
  "https://api.bolsiq.com/v1/quotes/PETR4" | grep -i x-ratelimit
```

### JavaScript

```javascript
const BASE = "https://api.bolsiq.com/v1";

async function bolsiq(path, { retries = 3 } = {}) {
  for (let tentativa = 0; tentativa <= retries; tentativa++) {
    const res = await fetch(`${BASE}${path}`, {
      headers: { "X-API-Key": process.env.BOLSIQ_API_KEY },
    });

    if (res.status === 429 && tentativa < retries) {
      // Retry-After é autoritativo; o jitter evita que todos os
      // clientes voltem no mesmo instante.
      const espera = Number(res.headers.get("Retry-After") ?? 2 ** tentativa);
      await new Promise((r) => setTimeout(r, espera * 1000 + Math.random() * 500));
      continue;
    }

    if (!res.ok) {
      const { error } = await res.json();
      throw new Error(`${error.code}: ${error.message} (${error.correlation_id})`);
    }

    return res.json();
  }
  throw new Error("limite de tentativas esgotado");
}

const cotacao = await bolsiq("/quotes/PETR4");
```

### Python

```python
import os, random, time
import requests

BASE = "https://api.bolsiq.com/v1"
SESSAO = requests.Session()
SESSAO.headers["X-API-Key"] = os.environ["BOLSIQ_API_KEY"]


def bolsiq(path: str, tentativas: int = 3) -> dict:
    for tentativa in range(tentativas + 1):
        res = SESSAO.get(f"{BASE}{path}", timeout=10)

        if res.status_code == 429 and tentativa < tentativas:
            espera = float(res.headers.get("Retry-After", 2**tentativa))
            time.sleep(espera + random.random() * 0.5)
            continue

        if not res.ok:
            erro = res.json()["error"]
            raise RuntimeError(
                f"{erro['code']}: {erro['message']} ({erro['correlation_id']})"
            )

        return res.json()

    raise RuntimeError("limite de tentativas esgotado")


cotacao = bolsiq("/quotes/PETR4")
```

## Boas práticas

1. **Chave em variável de ambiente**, nunca no código.
2. **Agrupe tickers numa chamada** em vez de uma por ticker: conta como uma
   requisição no limite.
3. **Cacheie.** Cotação diária muda uma vez por dia; demonstração financeira,
   uma vez por trimestre. Buscar de novo o que não mudou gasta seu limite.
4. **Trate 429 com backoff**, não com laço.
5. **Guarde o `X-Correlation-ID`** das requisições que falharem.
6. **Gere seu cliente** a partir de `/v1/openapi.json` em vez de escrever os
   tipos à mão.

## Proveniência e licença dos dados

Toda resposta diz de onde o dado veio:

```json
{
  "ticker": "PETR4",
  "close": "38.42",
  "date": "2026-10-31",
  "provenance": {
    "source": "b3-cotahist",
    "fetched_at": "2026-10-31T22:14:03Z",
    "license": "proprietária — B3",
    "source_ref": "COTAHIST_A2026.ZIP"
  }
}
```

Isso não é enfeite: a licença varia por fonte, e **o que você pode fazer com o
dado depende dela**. Dados da CVM e do Banco Central são abertos, com
atribuição. Dados de preço da B3 são proprietários, com restrição de
redistribuição.

Leia o campo `license` antes de redistribuir qualquer dado recebido desta API.
Detalhes em [market-data-sources.md](../services/market-data-sources.md).

## Suporte

Abra uma issue em https://github.com/leandrojtv/Bolsiq/issues com o
`X-Correlation-ID` e o horário da requisição.
