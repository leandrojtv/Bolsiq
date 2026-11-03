import { createHmac } from "node:crypto";
import { expect, type Page } from "@playwright/test";

const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";
export const SENHA = "senha-de-teste-123";

/** Primeiro link do ultimo e-mail para o endereco que contem `trecho`. */
export async function linkDoEmail(para: string, trecho: string): Promise<string> {
  let link = "";
  await expect
    .poll(
      async () => {
        const busca = await fetch(
          `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${para}"`)}`,
        );
        const { messages } = (await busca.json()) as { messages: { ID: string }[] };
        for (const m of messages) {
          const msg = (await (
            await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)
          ).json()) as { Text: string };
          const achado = msg.Text.match(/https?:\/\/\S+/g)?.find((u) =>
            u.includes(trecho),
          );
          if (achado) {
            link = achado.replace(/[)\]>.,]+$/, "");
            return true;
          }
        }
        return false;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  return link;
}

export const emailNovo = (nome: string) =>
  `${nome}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@bolsiq.test`;

/** Cadastro pela tela e confirmacao pelo link do Mailpit: sai logado em /carteiras/<id>. */
export async function cadastrar(
  page: Page,
  email: string,
  nome = "Pessoa Teste",
): Promise<string> {
  await page.goto("/cadastro");
  await page.getByLabel("Nome").fill(nome);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel(/^Senha/).fill(SENHA);
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("status")).toContainText(email);
  await page.goto(await linkDoEmail(email, "verify-email"));
  await page.waitForURL(/\/carteiras\/[0-9a-f-]{36}$/);
  return page.url().split("/").at(-1) as string;
}

export async function entrar(page: Page, email: string, volta?: string) {
  await page.goto(volta ? `/entrar?volta=${encodeURIComponent(volta)}` : "/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
}

/** TOTP (RFC 6238) de 6 digitos e 30 s, para o teste de 2FA. */
export function totp(chaveBase32: string, agora = Date.now()): string {
  const alfabeto = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of chaveBase32.replace(/=+$/, "").toUpperCase())
    bits += alfabeto.indexOf(c).toString(2).padStart(5, "0");
  const chave = Buffer.from(bits.match(/.{8}/g)?.map((b) => parseInt(b, 2)) ?? []);
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(Math.floor(agora / 30_000)));
  const h = createHmac("sha1", chave).update(contador).digest();
  const o = (h[h.length - 1] ?? 0) & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

/** A carteira de conferencia de docs/services/portfolio.md (src/carteira.test.ts). */
export const CONFERENCIA = `data;ticker;tipo;quantidade;preco;taxas;corretora
15/01/2024;PETR4;compra;100;35,00;5,00;XP
10/02/2024;PETR4;compra;50;38,00;3,00;XP
05/03/2024;PETR4;provento;150;0,80;0;XP
20/04/2024;VALE3;compra;80;62,00;4,00;XP
15/05/2024;PETR4;venda;60;42,00;6,00;XP
10/06/2024;PETR4;desdobramento;2;0;0;
01/07/2024;VALE3;provento;80;1,50;0;XP
12/08/2024;VALE3;compra;20;58,00;2,00;XP
20/09/2024;VALE3;venda;50;65,00;5,00;XP
05/10/2024;PETR4;provento;180;0,45;0;XP
`;
