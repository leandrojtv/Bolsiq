// Servidor estatico minimo do storybook-static, para a regressao visual.
// Sem dependencia: http do Node. Uso: node scripts/servir.mjs [porta] [pasta]
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const porta = Number(process.argv[2] ?? 6006);
const raiz = resolve(process.argv[3] ?? "storybook-static");
const tipos = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".png": "image/png",
};

createServer((req, res) => {
  const caminho = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  let arquivo = normalize(join(raiz, caminho));
  if (!arquivo.startsWith(raiz)) {
    res.writeHead(403).end();
    return;
  }
  try {
    if (statSync(arquivo).isDirectory()) arquivo = join(arquivo, "index.html");
    statSync(arquivo);
  } catch {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    "content-type": tipos[extname(arquivo)] ?? "application/octet-stream",
  });
  createReadStream(arquivo).pipe(res);
}).listen(porta, "0.0.0.0", () => {
  process.stdout.write(`storybook-static em http://localhost:${porta}\n`);
});
