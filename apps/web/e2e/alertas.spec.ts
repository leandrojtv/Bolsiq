import { expect, test, type Page } from "@playwright/test";
import { consultar, publicarCotacao } from "./banco";

const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";
// O alerts-worker recarrega as regras a cada 2 s.
const RECARGA_DO_WORKER = 3_000;

async function criarRegra(
  page: Page,
  r: { ticker: string; tipo: string; valor: string; email?: string },
) {
  const form = page.getByRole("region", { name: "Nova regra" });
  await form.getByLabel("Ativo", { exact: true }).fill(r.ticker);
  await form.getByLabel("Quando", { exact: true }).selectOption(r.tipo);
  await form.getByLabel(/^Valor/).fill(r.valor);
  if (r.email) {
    await form.getByLabel("E-mail", { exact: true }).check();
    await form.getByLabel("Seu e-mail").fill(r.email);
  }
  await form.getByRole("button", { name: "Criar alerta" }).click();
  await expect(form.getByRole("status")).toHaveText("Alerta criado.");
}

const sino = (page: Page) => page.getByRole("button", { name: /^Notificações/ });

test("regra criada pela tela dispara no sino em até 5 s e manda e-mail", async ({
  page,
}) => {
  const email = `e2e-${Date.now()}@bolsiq.test`;
  await page.goto("/alertas");
  await criarRegra(page, { ticker: "PETR4", tipo: "preco_acima", valor: "10", email });
  const regras = page.getByRole("region", { name: "Minhas regras" });
  await expect(regras.getByRole("row", { name: /PETR4/ })).toContainText(
    "Preço acima de R$ 10,00",
  );
  await expect(sino(page)).toHaveAccessibleName("Notificações");

  await page.waitForTimeout(RECARGA_DO_WORKER);
  publicarCotacao("PETR4", "99.00");

  await expect(sino(page)).toHaveAccessibleName("Notificações, 1 não lidas", {
    timeout: 5_000,
  });
  const central = page.getByRole("region", { name: "Central de notificações" });
  await expect(
    central.getByRole("link", { name: /PETR4 acima de R\$ 10,00/ }),
  ).toBeVisible();

  await expect
    .poll(
      async () => {
        const r = await fetch(
          `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`,
        );
        const { messages } = (await r.json()) as { messages: { Subject: string }[] };
        return messages.map((m) => m.Subject);
      },
      { timeout: 15_000 },
    )
    .toContainEqual(expect.stringContaining("PETR4 acima de R$ 10,00"));

  await central.getByRole("button", { name: "Marcar todas como lidas" }).click();
  await expect(sino(page)).toHaveAccessibleName("Notificações");
});

test("regra desligada pelo Switch não dispara", async ({ page }) => {
  await page.goto("/alertas");
  await criarRegra(page, { ticker: "VALE3", tipo: "preco_abaixo", valor: "1000" });
  const chave = page.getByRole("switch", { name: /Ativar regra VALE3/ });
  await expect(chave).toBeChecked();
  await chave.click();
  await expect(chave).not.toBeChecked();

  const uid = (await page.context().cookies()).find(
    (c) => c.name === "bolsiq_uid",
  )?.value;
  expect(uid).toMatch(/^dev_/);
  expect(
    consultar(`select ativo from alerts.alert_rules where user_id = '${uid}'`),
  ).toEqual([["f"]]);

  await page.waitForTimeout(RECARGA_DO_WORKER);
  publicarCotacao("VALE3", "50.00");
  await page.waitForTimeout(6_000);

  expect(
    consultar(`select count(*) from alerts.notifications where user_id = '${uid}'`),
  ).toEqual([["0"]]);
  await expect(sino(page)).toHaveAccessibleName("Notificações");
});

test("Criar alerta na página do ativo abre o sheet com o ticker", async ({ page }) => {
  await page.goto("/ativo/PETR4");
  await page.getByRole("button", { name: "Criar alerta" }).first().click();
  const sheet = page.getByRole("dialog", { name: "Novo alerta para PETR4" });
  await expect(sheet.getByLabel("Ativo", { exact: true })).toHaveValue("PETR4");
  await sheet.getByLabel("Quando", { exact: true }).selectOption("provento_anunciado");
  await expect(sheet.getByLabel(/^Valor/)).toBeDisabled();
  await sheet.getByRole("button", { name: "Criar alerta" }).click();
  await expect(sheet).toBeHidden();

  await page.goto("/alertas");
  await expect(
    page
      .getByRole("region", { name: "Minhas regras" })
      .getByRole("row", { name: /PETR4/ }),
  ).toContainText("Provento anunciado");
});

test("preferências salvam e-mail e silêncio", async ({ page }) => {
  await page.goto("/configuracoes/notificacoes");
  await page.getByLabel("E-mail").first().check();
  await page.getByRole("textbox", { name: "E-mail" }).fill("pref@bolsiq.test");
  await page.getByLabel(/Não enviar e-mail/).check();
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByRole("status")).toHaveText("Preferências salvas.");

  await page.reload();
  await expect(page.getByRole("textbox", { name: "E-mail" })).toHaveValue(
    "pref@bolsiq.test",
  );
  await expect(page.getByLabel("Das")).toHaveValue("22:00");
});
