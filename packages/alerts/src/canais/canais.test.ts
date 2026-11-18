import { describe, expect, it, vi } from "vitest";
import { canalInApp, subjectInApp } from "./inapp.js";
import { canalPush } from "./push.js";
import { canalTelegram, telegramHabilitado } from "./telegram.js";
import { emailDeConta, escapar, templateDeEmail } from "./templates.js";

const n = {
  id: "n1",
  user_id: "u1",
  titulo: "PETR4 acima de R$ 40.00",
  corpo: "Em R$ 41.00.",
  dados: {},
};

describe("in-app", () => {
  it("publica no subject do usuario", async () => {
    const pub = vi.fn();
    const r = await canalInApp(pub).enviar(n, {});
    expect(r.ok).toBe(true);
    expect(pub.mock.calls[0]?.[0]).toBe(subjectInApp("u1"));
    expect(
      JSON.parse(new TextDecoder().decode(pub.mock.calls[0]?.[1] as Uint8Array)),
    ).toMatchObject({ id: "n1" });
  });
});

describe("templates", () => {
  it("escapa HTML vindo de evento", () => {
    expect(escapar(`<script>"x" & 'y'</script>`)).toBe(
      "&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;",
    );
  });

  it("monta assunto, texto e html com link, escapando o titulo", async () => {
    const t = await templateDeEmail({ ...n, titulo: "<b>x</b>" }, "http://app");
    expect(t.assunto).toBe("<b>x</b>");
    expect(t.html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(t.html).not.toContain("<b>x</b>");
    expect(t.html).toContain("http://app/alertas?n=n1");
    expect(t.html).toContain("http://app/configuracoes/notificacoes");
    expect(t.texto).toContain("http://app/alertas?n=n1");
  });

  it("usa as cores dos tokens", async () => {
    const t = await templateDeEmail(n, "http://app");
    // bg e accent de tokens.css (#0B0F14, #6C9CFF), em estilo inline.
    expect(t.html.toLowerCase()).toContain("#0b0f14");
    expect(t.html.toLowerCase()).toContain("#6c9cff");
  });
});

describe("e-mail de conta", () => {
  it("leva o link no botao e o aviso de quem nao pediu", async () => {
    const e = await emailDeConta({
      titulo: "Confirme seu e-mail",
      corpo: "Falta um passo.",
      link: "http://app/verificar?token=abc",
      acao: "Confirmar e-mail",
    });
    expect(e.assunto).toBe("Confirme seu e-mail");
    expect(e.html).toContain('href="http://app/verificar?token=abc"');
    expect(e.texto).toContain("Se não foi você");
  });
});

describe("push", () => {
  const sub = { endpoint: "https://push/1", p256dh: "k", auth: "a" };

  it("sem inscricao e falha definitiva", async () => {
    const r = await canalPush({ sendNotification: vi.fn() }).enviar(n, { push: [] });
    expect(r).toMatchObject({ ok: false, definitivo: true });
  });

  it("envia para todas as inscricoes", async () => {
    const send = vi.fn().mockResolvedValue({});
    const r = await canalPush({ sendNotification: send }).enviar(n, {
      push: [sub, { ...sub, endpoint: "https://push/2" }],
    });
    expect(r.ok).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("inscricao expirada (410) e marcada para remover", async () => {
    const send = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("gone"), { statusCode: 410 }));
    const r = await canalPush({ sendNotification: send }).enviar(n, { push: [sub] });
    expect(r).toMatchObject({
      ok: false,
      definitivo: true,
      remover_push: ["https://push/1"],
    });
  });

  it("expirada some mesmo quando outra inscricao entrega", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(Object.assign(new Error("gone"), { statusCode: 410 }));
    const r = await canalPush({ sendNotification: send }).enviar(n, {
      push: [sub, { ...sub, endpoint: "https://push/2" }],
    });
    expect(r).toEqual({ ok: true, remover_push: ["https://push/2"] });
  });

  it("falha transitoria nao e definitiva", async () => {
    const send = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("boom"), { statusCode: 500 }));
    const r = await canalPush({ sendNotification: send }).enviar(n, { push: [sub] });
    expect(r).toMatchObject({ ok: false, definitivo: false });
  });

  it("uma inscricao viva basta para ok", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("gone"), { statusCode: 404 }))
      .mockResolvedValueOnce({});
    const r = await canalPush({ sendNotification: send }).enviar(n, {
      push: [sub, { ...sub, endpoint: "x" }],
    });
    expect(r.ok).toBe(true);
  });
});

describe("telegram", () => {
  it("sem chat e falha definitiva", async () => {
    const r = await canalTelegram("t", vi.fn()).enviar(n, {});
    expect(r).toMatchObject({ ok: false, definitivo: true });
  });

  it("envia para o chat", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const r = await canalTelegram("TOK", f).enviar(n, {
      telegram_chat_id: "42",
    });
    expect(r.ok).toBe(true);
    expect(f.mock.calls[0]?.[0]).toBe("https://api.telegram.org/botTOK/sendMessage");
  });

  it("4xx e definitivo, 5xx nao", async () => {
    const f4 = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    const f5 = vi.fn().mockResolvedValue({ ok: false, status: 502 });
    expect(
      await canalTelegram("t", f4 as unknown as typeof fetch).enviar(n, {
        telegram_chat_id: "1",
      }),
    ).toMatchObject({
      definitivo: true,
    });
    expect(
      await canalTelegram("t", f5 as unknown as typeof fetch).enviar(n, {
        telegram_chat_id: "1",
      }),
    ).toMatchObject({
      definitivo: false,
    });
  });

  it("flag exige ligar e ter token", () => {
    expect(
      telegramHabilitado({ FEATURE_TELEGRAM: "true", TELEGRAM_BOT_TOKEN: "x" }),
    ).toBe(true);
    expect(telegramHabilitado({ FEATURE_TELEGRAM: "true" })).toBe(false);
    expect(telegramHabilitado({ TELEGRAM_BOT_TOKEN: "x" })).toBe(false);
  });
});
