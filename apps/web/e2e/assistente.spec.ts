import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { CONFERENCIA, cadastrar, emailNovo } from "./conta";
import { consultar } from "./banco";

const CHAVE = "sk-e2e-chave-de-teste-do-bolsiq-1234";

async function importarConferencia(page: Page) {
  await page.getByRole("button", { name: "Importar CSV ou extrato B3" }).click();
  const sheet = page.getByRole("dialog", { name: "Importar transações" });
  await sheet.getByLabel("Arquivo CSV").setInputFiles({
    name: "conferencia.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(CONFERENCIA),
  });
  await sheet.getByRole("button", { name: "Importar", exact: true }).click();
  await expect(sheet.getByRole("status")).toContainText("10 de 10");
  await page.keyboard.press("Escape");
}

async function configurarDeepSeek(page: Page) {
  await page.goto("/configuracoes/assistente");
  await page.getByLabel("Provedor", { exact: true }).selectOption("deepseek");
  await page.getByLabel("Chave de API").fill(CHAVE);
  await page.getByRole("button", { name: "Testar conexão" }).click();
  await expect(page.getByRole("status")).toContainText("Conexão ok");
  await page.getByLabel("Modelo", { exact: true }).selectOption("falso-com-ferramentas");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByRole("status")).toContainText("Configuração salva");
}

async function preencherPerfil(page: Page) {
  await page.goto("/configuracoes/perfil");
  await expect(page.getByRole("heading", { name: "Perfil do investidor" })).toBeVisible();
  await page.getByRole("button", { name: "Salvar perfil" }).click();
  await expect(page.getByText("Perfil salvo.")).toBeVisible();
}

async function abrirPainel(page: Page) {
  await page.getByRole("button", { name: "Pergunte ao Bolsiq" }).click();
  return page.getByRole("dialog", { name: "Pergunte ao Bolsiq" });
}

test("configura DeepSeek, consente e avalia a carteira com os números da tela", async ({
  page,
}) => {
  const respostas: string[] = [];
  page.on("response", (r) => {
    if (r.url().includes("/api/assistente"))
      void r
        .text()
        .then((t) => respostas.push(t))
        .catch(() => undefined);
  });

  const carteira = await cadastrar(page, emailNovo("assistente"));
  await importarConferencia(page);
  await configurarDeepSeek(page);
  await expect(page.getByText("••••1234")).toBeVisible();
  await preencherPerfil(page);

  await page.goto(`/carteiras/${carteira}`);
  const painel = await abrirPainel(page);
  await expect(painel.getByRole("region", { name: "Consentimento" })).toContainText(
    "carteira",
  );
  await painel.getByRole("button", { name: "Concordo, continuar" }).click();

  await painel.getByRole("button", { name: "Avalie minha carteira" }).click();
  const resposta = painel.getByRole("article", { name: "Resposta do Bolsiq" }).last();
  await expect(resposta).toContainText("Concentração", { timeout: 30_000 });
  await expect(resposta.getByText(/Avaliando carteira Principal/)).toBeVisible();
  await expect(resposta).toContainText("Desvio da alocação-alvo");
  await expect(resposta).toContainText("Risco");

  // Mesmos numeros da alocacao da tela (lidos direto do BFF da carteira).
  const painelApi = await page.request.get(`/api/carteiras/${carteira}`);
  const { data } = (await painelApi.json()) as {
    data: { alocacao: { ativo: { chave: string; fracao: number | null }[] } };
  };
  for (const f of data.alocacao.ativo) {
    if (f.fracao !== null)
      await expect(resposta).toContainText(`${f.chave}: ${(f.fracao * 100).toFixed(2)}%`);
  }

  // Ticker citado leva ao ativo.
  await expect(resposta.getByRole("link", { name: "PETR4" }).first()).toHaveAttribute(
    "href",
    "/ativo/PETR4",
  );

  await page.keyboard.press("Escape");
  await expect.poll(() => respostas.length).toBeGreaterThan(0);
  for (const r of respostas) expect(r).not.toContain(CHAVE);

  // Banco: cifrada, sem a chave em claro; consumo registrado.
  const [linha] = consultar(
    `select chave_cifrada, chave_final from assistant.settings s join app."user" u on u.id = s.user_id order by s.atualizado_em desc limit 1`,
  );
  expect(linha?.[0]).toMatch(/^v1\./);
  expect(linha?.[0]).not.toContain(CHAVE);
  expect(linha?.[1]).toBe("1234");
});

test("aporte só cita o que sugerir_aporte devolveu, e alerta pede confirmação", async ({
  page,
}) => {
  await cadastrar(page, emailNovo("aporte"));
  await importarConferencia(page);
  await configurarDeepSeek(page);
  await preencherPerfil(page);
  const painel = await abrirPainel(page);
  await painel.getByRole("button", { name: "Concordo, continuar" }).click();

  await painel.getByRole("button", { name: /Onde aportar/ }).click();
  const resposta = painel.getByRole("article", { name: "Resposta do Bolsiq" }).last();
  await expect(resposta).toContainText(/Candidatos|Nenhum ativo/, { timeout: 30_000 });
  await expect(resposta.getByText(/candidatos de aporte/)).toBeVisible();

  await painel
    .getByLabel("Sua pergunta")
    .fill("Crie um alerta para PETR4 acima de R$ 40");
  await painel.getByRole("button", { name: "Enviar" }).click();
  const grupo = painel.getByRole("group", { name: "Confirmar alerta" });
  await expect(grupo).toBeVisible({ timeout: 30_000 });
  // Nada gravado antes do clique.
  let regras = (await (await page.request.get("/api/alertas/regras")).json()) as {
    data: unknown[];
  };
  expect(regras.data).toHaveLength(0);
  await grupo.getByRole("button", { name: "Confirmar alerta" }).click();
  await expect(grupo.getByRole("status")).toContainText("Alerta criado");
  regras = (await (await page.request.get("/api/alertas/regras")).json()) as {
    data: unknown[];
  };
  expect(regras.data).toHaveLength(1);

  // Historico: aparece e apaga.
  await painel.getByRole("button", { name: "Histórico" }).click();
  await expect(
    painel.getByRole("list", { name: "Conversas" }).getByRole("listitem"),
  ).toHaveCount(1);
  await painel.getByRole("button", { name: /Apagar conversa/ }).click();
  await expect(painel.getByText("Nenhuma conversa ainda.")).toBeVisible();
});

test("chave recusada não vaza em resposta nem em log", async ({ page }) => {
  const errada = "sk-e2e-chave-errada-que-nao-pode-vazar-987";
  const corpos: string[] = [];
  page.on(
    "response",
    (r) =>
      void r
        .text()
        .then((t) => corpos.push(t))
        .catch(() => undefined),
  );

  await cadastrar(page, emailNovo("vazamento"));
  await page.goto("/configuracoes/assistente");
  await page.getByLabel("Provedor", { exact: true }).selectOption("deepseek");
  await page.getByLabel("Chave de API").fill(errada);
  await page.getByRole("button", { name: "Testar conexão" }).click();
  await expect(page.getByText("O provedor recusou a chave.")).toBeVisible();

  for (const c of corpos) expect(c).not.toContain(errada);

  const compose = resolve(import.meta.dirname, "../../../infra/docker/compose.ci.yml");
  const logs = execFileSync(
    "docker",
    ["compose", "-f", compose, "logs", "--no-log-prefix", "web"],
    {
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
    },
  );
  expect(logs).not.toContain(errada);
  expect(logs).not.toContain(CHAVE);
});

test("modelo sem ferramentas fica bloqueado; Ollama fora da lista é recusado", async ({
  page,
}) => {
  await cadastrar(page, emailNovo("bloqueado"));
  await page.goto("/configuracoes/assistente");
  await page.getByLabel("Provedor", { exact: true }).selectOption("ollama");
  await page.getByLabel("URL do Ollama").fill("http://169.254.169.254");
  await page.getByRole("button", { name: "Testar conexão" }).click();
  await expect(page.getByText(/fora da lista permitida/)).toBeVisible();

  await page.getByLabel("URL do Ollama").fill("http://llm-falso:11434");
  await page.getByRole("button", { name: "Testar conexão" }).click();
  await expect(page.getByRole("status")).toContainText("Conexão ok");
  const opcao = page.getByRole("option", { name: /falso-sem-ferramentas/ });
  await expect(opcao).toBeDisabled();
  const r = await page.request.put("/api/assistente/configuracao", {
    data: {
      provedor: "ollama",
      modelo: "falso-sem-ferramentas",
      base_url: "http://llm-falso:11434",
    },
  });
  expect(r.status()).toBe(422);
});

test("sem login, o painel pede para entrar e a API recusa", async ({ page }) => {
  await page.goto("/screener");
  const painel = await abrirPainel(page);
  await expect(painel.getByRole("link", { name: "Entre na sua conta" })).toBeVisible();
  const r = await page.request.post("/api/assistente/chat", { data: { texto: "oi" } });
  expect(r.status()).toBe(401);
});
