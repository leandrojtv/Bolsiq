import type { NotificacaoParaEnvio } from "./canal.js";

/**
 * Template de e-mail.
 *
 * Funcao que devolve html e texto, nao componente React Email: o React entra
 * no monorepo com o apps/web, que ainda nao existe. A troca e local a este
 * arquivo, porque o canal so depende da assinatura `(n) => {assunto, html, texto}`.
 */
export function templateDeEmail(n: NotificacaoParaEnvio, urlBase: string) {
  const titulo = escapar(n.titulo);
  const corpo = escapar(n.corpo);
  const link = `${urlBase}/notificacoes/${encodeURIComponent(n.id)}`;

  return {
    assunto: n.titulo,
    texto: `${n.titulo}\n\n${n.corpo}\n\n${link}`,
    html: `<!doctype html><html><body style="font-family:system-ui,sans-serif;max-width:560px;margin:auto;padding:24px">
<h2 style="margin:0 0 12px">${titulo}</h2>
<p style="margin:0 0 20px;color:#333">${corpo}</p>
<p><a href="${link}" style="color:#1d4ed8">Ver no Bolsiq</a></p>
<p style="color:#888;font-size:12px">Voce recebeu este e-mail porque criou um alerta. Ajuste em Preferencias de notificacao.</p>
</body></html>`,
  };
}

/**
 * Escapa HTML. Titulo e corpo levam ticker e valores vindos de evento; o
 * escape impede que dado de fonte externa vire HTML executavel no e-mail.
 */
export function escapar(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
