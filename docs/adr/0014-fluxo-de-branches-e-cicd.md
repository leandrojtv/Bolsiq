# ADR 0014 — Fluxo de branches e CI/CD

- **Status:** aceito
- **Data:** 2026-11-01
- **Decisores:** @leandrojtv

## Contexto e definição do problema

O projeto nasce com uma restrição que a maioria dos projetos não tem: o serviço
`market-data` será **vendido como API pública**, concorrendo com a brapi. Isso
muda o peso de certas decisões. Quebrar o contrato `/v1` não é um incômodo
interno, é cliente pagante com integração parada. Dado de mercado incorreto não
é um bug de tela, é decisão de investimento tomada com número errado.

Ao mesmo tempo, o repositório hoje tem um mantenedor, nenhum código e nenhum
ambiente provisionado. Um processo pesado demais para o tamanho atual é
abandonado na primeira pressa; um processo leve demais não se consegue apertar
depois, porque os hábitos já estão formados.

A pergunta é: qual fluxo de branches e qual pipeline sustentam um serviço com
contrato público, sem travar um time de uma pessoa?

## Opções consideradas

1. **Trunk-based com feature flags** — uma branch só, deploy contínuo.
2. **GitHub Flow** — `main` + branches curtas, deploy no merge.
3. **GitFlow reduzido** — `main` + `develop` + branches de trabalho, com
   `release/*` e `hotfix/*`.

## Decisão

Adotamos o **GitFlow reduzido**: `main` como produção, `develop` como integração
com deploy automático em staging, branches de trabalho nomeadas
`<tipo>/<issue>-<slug>`, mais `release/*` e `hotfix/*`.

O pipeline tem onze checks de PR consolidados num único portão obrigatório
(`ci-ok`), CD automático para staging no merge em `develop`, e promoção por
**retag** das mesmas imagens para produção na criação da tag `vX.Y.Z`.

### Por que não trunk-based

Trunk-based é o fluxo mais eficiente quando existe uma suíte de testes madura,
feature flags em produção e a capacidade de corrigir para frente em minutos.
Nada disso existe aqui ainda, e a consequência de um erro vazar para a API
pública é alta. Trunk-based é um destino plausível depois que o smoke, o e2e e a
observabilidade estiverem estabelecidos — não o ponto de partida.

### Por que não GitHub Flow

GitHub Flow não tem um lugar onde o código fica integrado e observado antes de
ir para produção. Precisamos desse lugar: `develop` com deploy automático em
staging é o que permite que a promoção para produção seja um **retag de uma
imagem já validada**, e não um build novo e não observado. Essa propriedade é a
que mais nos interessa no pipeline todo.

### Por que `develop` separado de `main`

A separação dá três coisas concretas:

1. **A imagem de produção é bit a bit a de staging.** O `cd-production.yml` não
   reconstrói nada: acha o `sha-<commit>` publicado e faz
   `docker buildx imagetools create`. O digest é idêntico. "Funcionou em
   staging" deixa de ser uma frase de esperança.
2. **Congelamento é possível.** `release/*` aceita só `fix/*`, então estabilizar
   uma versão não bloqueia o trabalho em `develop`.
3. **Hotfix não carrega trabalho inacabado.** Saindo de `main`, a correção vai
   sozinha para produção.

O custo é o back-merge, que é fácil de esquecer e desfaz hotfix silenciosamente.
Por isso o `hotfix-backmerge.yml` abre o PR automaticamente e, quando há
conflito, commita os marcadores em vez de escolher um lado — a resolução fica
humana e visível no PR.

## Consequências

### Positivas

- Produção roda imagem validada em staging, sem rebuild.
- Quebra de contrato `/v1` é barrada por padrão (`oasdiff`), e liberá-la exige um
  ato explícito e registrado: a label `breaking-change`.
- Drift entre o schema do Drizzle e as migrations é detectado antes do merge.
- Proteção do repositório é código revisável em `infra/github/rulesets`, não
  cliques perdidos numa tela.
- Trocar SSH + compose por Kubernetes mexe em um arquivo (`deploy.yml`).
- Rollback automático tem environment próprio sem aprovação, então de fato é
  automático.

### Negativas

- Da branch ao ar em produção são cinco merges (trabalho → `develop` →
  `release` → `main` → PR de release → back-merge). Para um mantenedor só, é
  cerimônia.
- Esquecer o back-merge faz a correção voltar a ser bug. Mitigado por automação,
  não eliminado.
- O caminho do hotfix tem uma lacuna real: ele não passa por staging, e o
  `resolver` só promove imagem existente. Está documentado em
  `docs/runbooks/hotfix.md` e precisará de decisão própria quando os serviços
  existirem.
- Onze checks é bastante superfície para manter.

## Contradições do enunciado e como foram resolvidas

Três exigências do pedido original não são simultaneamente satisfazíveis. Ficam
registradas aqui com a escolha feita.

### Histórico linear em `main` vs. merge commit para release e hotfix

São mutuamente exclusivos: `required_linear_history` proíbe exatamente o merge
commit que preserva o histórico da release.

**Escolha: merge commit.** `required_linear_history` foi omitido da ruleset de
`main`. Saber o que entrou em cada release — e poder olhar o merge e ver o
conjunto — vale mais do que a linha reta. `develop` continua linear, porque usa
squash. A nota está no próprio
[`infra/github/rulesets/main.json`](../../infra/github/rulesets/main.json).

### Origem restrita a `release/*` e `hotfix/*` em rulesets

Rulesets do GitHub não têm regra de branch de origem: a condição `ref_name` se
refere à branch _protegida_, não à de origem do PR.

**Escolha:** a regra vive no check `pr-meta` do `ci.yml`, que reprova
`feature/*` → `main` com mensagem explicativa. Como `ci-ok` é obrigatório e
depende do `pr-meta`, o efeito prático é o pedido. A diferença é que o bloqueio
aparece como check reprovado, não como botão de merge desabilitado.

### Merge por tipo de branch de origem

O GitHub define métodos de merge por repositório e, em ruleset, por branch de
**destino** — nunca pela origem.

**Escolha:** aproveitamos a correspondência que já existe no fluxo. Tudo que
entra em `develop` (`feature`, `fix`, `chore`, `docs`, `refactor`, `test`) usa
squash; tudo que entra em `main` (`release`, `hotfix`) usa merge commit. Logo,
ruleset de `develop` com `allowed_merge_methods: [squash]` e de `main` com
`[merge]` produz o comportamento pedido. A única exceção é o back-merge de
`hotfix` para `develop`, que sai como squash.

### Uma quarta, de fato operacional: aprovação com um mantenedor

`main` exige 1 aprovação de CODEOWNERS e o GitHub não permite aprovar o próprio
PR. Com um mantenedor, nenhum merge em `main` acontece — nem o PR de release.

**Escolha:** a ruleset versionada mantém a exigência, porque é o estado correto
de chegada. O script aceita `--solo` (`make gh-protect-solo`), que zera a
aprovação em `main` e preserva todo o resto. A dívida está explícita no script e
em `docs/ci-cd.md`, para ser desfeita quando houver um segundo mantenedor.

## Conformidade

- Regra 1 (tudo via Docker): o `Makefile` roda pnpm em container; nada exige
  Node local.
- Regra 2 (ADR para decisão nova): este documento.
- Regra 3 (endpoint com Zod, OpenAPI e teste): checks `contract` e `unit`.
- Regra 4 (proveniência do dado): não verificável por CI; está no prompt da
  revisão do Claude.
- Regra 5 (`numeric` e `timestamptz`): idem.
- Regra 6 (segredo por variável de ambiente): check `security` com gitleaks;
  `.env.example` versionado.
- Regra 7 (Conventional Commits): check `pr-meta` no título e squash com mensagem
  derivada do título.
- Regra 8 (documentação em português): este ADR, os runbooks e as mensagens dos
  workflows.

## Pendências

1. `infra/docker/compose.ci.yml` não existe; `smoke` e `e2e` ficam pulados.
2. `infra/docker/deployables.json` está vazio; `build` e todo o CD ficam pulados.
3. `infra/docker/compose.prod.yml` é esqueleto, com os serviços comentados.
4. O caminho do hotfix sem passar por staging precisa de decisão (ADR próprio).
5. O critério de aceite "uma release completa e um hotfix executados de ponta a
   ponta" não foi cumprido: exige serviços, imagens e um host de deploy.
