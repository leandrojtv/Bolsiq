import { api } from "@/lib/api";

/** VAPID vem em base64url; o pushManager quer os bytes. */
function bytes(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/**
 * Pede permissao e registra a inscricao. So e chamado quando o usuario marca
 * o canal Push: pedir ao abrir a pagina faz o navegador bloquear o site.
 * Devolve a mensagem de erro, ou null quando deu certo.
 */
export async function ativarPush(): Promise<string | null> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window))
    return "Este navegador não recebe push.";
  if ((await Notification.requestPermission()) !== "granted")
    return "Permissão de notificação negada no navegador.";
  const { data } = await api<{ data: { chave: string } }>("push");
  const registro =
    (await navigator.serviceWorker.getRegistration()) ??
    (await navigator.serviceWorker.register("/sw.js"));
  await navigator.serviceWorker.ready;
  const inscricao =
    (await registro.pushManager.getSubscription()) ??
    (await registro.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: bytes(data.chave),
    }));
  await api("push", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(inscricao.toJSON()),
  });
  return null;
}
