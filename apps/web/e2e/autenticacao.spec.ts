import { expect, test } from "@playwright/test";
import { SENHA, cadastrar, emailNovo, entrar, linkDoEmail, totp } from "./conta";

test("rota de carteira exige login e volta para ela depois", async ({ page }) => {
  const email = emailNovo("volta");
  await cadastrar(page, email);
  await page.context().clearCookies();
  await page.goto("/configuracoes/conta");
  await expect(page).toHaveURL(/\/entrar\?volta=%2Fconfiguracoes%2Fconta/);
  await entrar(page, email, "/configuracoes/conta");
  await expect(page.getByRole("heading", { name: "Minha conta" })).toBeVisible();
});

test("senha errada não entra", async ({ page }) => {
  const email = emailNovo("errada");
  await cadastrar(page, email);
  await page.context().clearCookies();
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill("outra-senha-qualquer");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByText("E-mail ou senha incorretos.")).toBeVisible();
});

test("recuperação de senha pelo e-mail", async ({ page }) => {
  const email = emailNovo("recupera");
  await cadastrar(page, email);
  await page.context().clearCookies();
  await page.goto("/recuperar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByRole("button", { name: "Enviar link" }).click();
  await expect(page.getByRole("status")).toContainText(email);

  await page.goto(await linkDoEmail(email, "reset-password"));
  await expect(page).toHaveURL(/\/redefinir-senha\?token=/);
  await page.getByLabel(/^Nova senha/).fill(`${SENHA}-nova`);
  await page.getByRole("button", { name: "Salvar senha" }).click();
  await expect(page).toHaveURL(/\/entrar\?aviso=senha/);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(`${SENHA}-nova`);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/carteiras\//);
});

test("2FA por TOTP: ativa e passa a pedir o código", async ({ page }) => {
  const email = emailNovo("totp");
  await cadastrar(page, email);
  await page.goto("/configuracoes/seguranca");
  await page.getByLabel("Senha atual").fill(SENHA);
  await page.getByRole("button", { name: "Configurar" }).click();
  const chave = (await page.getByTestId("chave-totp").textContent()) ?? "";
  await page.getByLabel("Código do app").fill(totp(chave));
  await page.getByRole("button", { name: "Ativar" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Verificação em duas etapas ativada.",
  );

  await page.context().clearCookies();
  await entrar(page, email);
  await expect(
    page.getByRole("heading", { name: "Verificação em duas etapas" }),
  ).toBeVisible();
  await page.getByLabel("Código").fill(totp(chave));
  await page.getByRole("button", { name: "Verificar" }).click();
  await expect(page).toHaveURL(/\/carteiras\//);
});

test("watchlist do aparelho vai para a conta no primeiro login", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() =>
    localStorage.setItem("bolsiq:watchlist", JSON.stringify(["WEGE3", "PETR4"])),
  );
  await cadastrar(page, emailNovo("watchlist"));
  await expect
    .poll(
      async () =>
        ((await (await page.request.get("/api/watchlist")).json()) as { data: string[] })
          .data,
    )
    .toEqual(["WEGE3", "PETR4"]);
});

test("LGPD: exporta e exclui a conta com os dados", async ({ page }) => {
  const email = emailNovo("lgpd");
  const id = await cadastrar(page, email);
  await page.goto("/configuracoes/conta");
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Exportar meus dados" }).click();
  const arquivo = await download;
  const dados = JSON.parse(
    await (
      await arquivo.createReadStream()
    )
      .toArray()
      .then((b) => Buffer.concat(b).toString()),
  ) as {
    conta: { email: string };
    carteiras: { id: string }[];
  };
  expect(dados.conta.email).toBe(email);
  expect(dados.carteiras.map((c) => c.id)).toEqual([id]);

  await page.getByLabel(/Digite "EXCLUIR"/).fill("EXCLUIR");
  await page.getByRole("button", { name: "Excluir conta e dados" }).click();
  await expect(page).toHaveURL(/\/entrar\?aviso=excluida/);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByText("E-mail ou senha incorretos.")).toBeVisible();
});
