// Service worker do Bolsiq.
//
// - Shell: paginas navegadas e /_next/static ficam em cache; sem rede, a
//   ultima versao da pagina abre (ou /offline, se nunca foi aberta).
// - Ultima cotacao: /api/v1/quotes vai a rede primeiro e guarda a resposta;
//   sem rede, devolve a ultima guardada.
// O nome do cache muda com a versao para o activate limpar o antigo.
const VERSAO = "bolsiq-v2";
const SHELL = ["/offline", "/manifest.webmanifest", "/icones/192.png", "/icones/512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(VERSAO)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((nomes) =>
        Promise.all(nomes.filter((n) => n !== VERSAO).map((n) => caches.delete(n))),
      )
      .then(() => self.clients.claim()),
  );
});

async function redePrimeiro(req, reserva) {
  const cache = await caches.open(VERSAO);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return (
      (await cache.match(req)) ?? (reserva ? cache.match(reserva) : Response.error())
    );
  }
}

async function cachePrimeiro(req) {
  const cache = await caches.open(VERSAO);
  const salvo = await cache.match(req);
  if (salvo) return salvo;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    e.respondWith(redePrimeiro(req, "/offline"));
  } else if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icones/")
  ) {
    e.respondWith(cachePrimeiro(req));
  } else if (url.pathname.startsWith("/api/v1/quotes/")) {
    e.respondWith(redePrimeiro(req));
  }
});

// Web Push do alerts-worker: { title, body, id }. O clique abre a central com
// a notificacao em destaque (marcada como lida pela pagina).
self.addEventListener("push", (e) => {
  const dados = e.data ? e.data.json() : {};
  e.waitUntil(
    self.registration.showNotification(dados.title ?? "Bolsiq", {
      body: dados.body ?? "",
      icon: "/icones/192.png",
      badge: "/icones/192.png",
      tag: dados.id,
      data: { url: dados.id ? `/alertas?n=${dados.id}` : "/alertas" },
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url ?? "/alertas";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((abertas) => {
      const aba = abertas.find((c) => new URL(c.url).origin === self.location.origin);
      return aba ? aba.navigate(url).then((c) => c?.focus()) : self.clients.openWindow(url);
    }),
  );
});
