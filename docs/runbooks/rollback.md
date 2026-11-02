# Runbook: rollback

Voltar produção para a versão anterior.

## Rollback automático

Se o smoke pós-deploy falhar, o `cd-production.yml` dispara o job `rollback`
sozinho:

1. Descobre a tag anterior (`git tag --sort=-v:refname`).
2. Faz deploy dessa tag pelo environment `production-rollback`, que **não** tem
   required reviewers — de propósito, para o rollback não ficar esperando
   aprovação com a produção quebrada.
3. **Não roda migrations** (`run_migrations: false`).
4. Roda o smoke de novo.
5. O job `aviso-rollback` abre uma issue com as labels `tipo:bug` e `incidente`.

Você não precisa fazer nada para isso acontecer. Precisa, sim, ler a issue.

## Rollback manual

Quando o deploy "passou" mas o comportamento está errado, e o smoke não pegou.

### 1. Qual é a versão boa

```bash
gh release list --limit 5
git tag --list 'v*' --sort=-v:refname | head -5
```

### 2. Dispare o deploy da versão anterior

```bash
gh workflow run cd-production.yml --ref v1.1.0
```

Como o `cd-production.yml` promove imagens por retag, o deploy de uma tag antiga
é rápido e determinístico: nada é reconstruído.

### 3. Se precisar ser agora, direto no host

```bash
ssh usuario@host
cd ~/bolsiq
sed -i 's/^IMAGE_TAG=.*/IMAGE_TAG=v1.1.0/' .env
docker compose pull
docker compose up -d --wait
bash smoke.sh http://localhost:8000
```

Isto é a saída de emergência. Deixa o host fora de sincronia com o que o
GitHub acha que está publicado — logo depois, rode o rollback pelo workflow para
realinhar.

## O ponto que mais dói: migrations

**O rollback de imagem não reverte migration.** Se `v1.2.0` aplicou uma
migration destrutiva, voltar as imagens para `v1.1.0` deixa código antigo diante
de um schema novo.

Antes de dar rollback, responda:

```bash
git diff v1.1.0..v1.2.0 -- '**/migrations/**'
```

| O que a migration fez | Rollback de imagem resolve? | O que fazer |
| --- | --- | --- |
| Só acrescentou coluna/tabela/índice | Sim | Rollback normal. A coluna nova fica sobrando, inofensiva |
| Renomeou coluna | Não | Precisa de migration de volta, ou corrigir para frente |
| Removeu coluna ou tabela | Não | Restaure do backup. O dado não está mais lá |
| Mudou tipo de coluna | Depende | Avalie caso a caso; prefira corrigir para frente |

Daí a prática: **migration sempre aditiva e compatível com a versão anterior.**
Remoção de coluna vem numa release seguinte, depois que nenhum código em
produção a usa. Isso é o que torna o rollback seguro — e vale escrever como ADR
quando a primeira migration destrutiva aparecer.

## Depois do rollback

1. A issue aberta pelo `aviso-rollback` é o registro do incidente. Complete com
   o que foi causa e o que foi sintoma.
2. Acrescente ao smoke o endpoint ou a verificação que teria pegado o problema.
   Um rollback que não melhora o smoke vai acontecer de novo.
3. A correção entra como `hotfix/*` ([hotfix.md](hotfix.md)) ou como `fix/*` na
   próxima release, conforme a urgência.
4. Se a causa foi uma decisão de arquitetura, abra um ADR.

## Verificação

```bash
make smoke BASE_URL=https://seu-dominio
gh api repos/leandrojtv/Bolsiq/deployments --jq '.[0:3][] | "\(.environment) \(.ref) \(.created_at)"'
```
