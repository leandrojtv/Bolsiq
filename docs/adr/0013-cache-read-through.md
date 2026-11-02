# ADR 0013 - Read-through no market-data, com carga em lote para arquivo grande

- **Status:** aceito
- **Data:** 2026-11-02
- **Decisores:** @leandrojtv

## Contexto

O CLAUDE.md define o market-data como "cache sob demanda (read-through)
gravando no Postgres". As fontes, porém, têm formas muito diferentes:

| Fonte       | Forma                                    | Custo por leitura            |
| ----------- | ---------------------------------------- | ---------------------------- |
| brapi       | API por ticker, JSON pequeno             | uma chamada, ~200 ms         |
| BCB SGS     | API por série e janela                   | uma chamada por janela       |
| B3 COTAHIST | ZIP anual de 80 MB, 650 MB descomprimido | download e leitura completos |
| CVM DFP/ITR | ZIP anual de 13 a 32 MB, CSVs de 100 MB+ | download e leitura completos |

Read-through literal em COTAHIST e CVM significaria baixar 80 MB para responder
o histórico de um ticker.

## Decisão

Dois modos, conforme a forma da fonte:

1. **Read-through, com TTL e coalescência**, onde a fonte responde por chave:
   cotação corrente e proventos (brapi), séries macro (SGS). A leitura consulta
   o Postgres; se o dado venceu, vai à fonte, grava e devolve. Leituras
   simultâneas da mesma chave esperam a mesma chamada (`Coalescedor`).
2. **Carga em lote por job**, onde a fonte é arquivo: COTAHIST e CVM. O job
   agendado (e o `make backfill`) grava tudo; a leitura só consulta o banco.

| Dado               | Modo         | TTL / agenda                |
| ------------------ | ------------ | --------------------------- |
| cotação corrente   | read-through | 60 s (`QUOTE_TTL_SECONDS`)  |
| proventos          | read-through | 12 h                        |
| séries do SGS      | read-through | 6 h para o ponto mais novo  |
| preço diário       | lote         | 19:30 em dias úteis         |
| DFP, ITR, cadastro | lote         | semanal, só se o hash mudou |

### Regras do read-through

- **Fonte fora não é erro do cliente.** Com valor anterior no banco, a resposta
  sai com `meta.stale = true`. Sem valor nenhum, 503 `source_unavailable`.
- **Cache negativo.** Sem token, a brapi recusa quase todo ticker com 401. A
  recusa fica registrada no `fetch_log` pelo mesmo TTL; sem isso, cada leitura
  do histórico ajustado iria à fonte receber o mesmo 401.
- **Evento só quando muda.** Reler a cotação a cada minuto com o mercado
  fechado não emite `quote.updated`.
- **Erro não fica em cache.** A coalescência descarta a promessa ao terminar.

## Consequências

### Positivas

- O cliente da API nunca paga o download de um arquivo de 80 MB.
- Cada fonte é consultada no ritmo dela: a brapi por minuto, a CVM por semana.
- `meta.stale` e `meta.delay_minutes` dizem ao cliente quão velho é o dado, em
  vez de o serviço esconder a falha da fonte.

### Negativas

- Ticker fora do backfill não tem histórico até o próximo job. O histórico não
  é read-through.
- A cotação corrente depende de um fornecedor terceiro (brapi), com plano
  gratuito limitado aos tickers de demonstração. Sem token, o serviço cai no
  último fechamento do COTAHIST, marcado como `stale`.
