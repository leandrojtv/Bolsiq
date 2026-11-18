import yazl from "yazl";
import type { Buscar } from "../fontes/http.js";

/** ZIP em memoria, com o texto em latin1 como os arquivos da CVM e da B3. */
export function criarZip(entradas: Record<string, string>): Promise<Buffer> {
  const zip = new yazl.ZipFile();
  for (const [nome, texto] of Object.entries(entradas)) {
    zip.addBuffer(Buffer.from(texto, "latin1"), nome);
  }
  zip.end();
  return new Promise((ok, falha) => {
    const partes: Buffer[] = [];
    zip.outputStream.on("data", (p: Buffer) => partes.push(p));
    zip.outputStream.on("end", () => ok(Buffer.concat(partes)));
    zip.outputStream.on("error", falha);
  });
}

/** `fetch` falso que responde por prefixo de URL. */
export function buscarFalso(
  rotas: Record<string, (url: string) => Response | Promise<Response>>,
): Buscar & { chamadas: string[] } {
  const chamadas: string[] = [];
  const buscar = async (url: string) => {
    chamadas.push(url);
    const chave = Object.keys(rotas)
      .filter((k) => url.startsWith(k) || url.includes(k))
      .sort((a, b) => b.length - a.length)[0];
    if (!chave) return new Response("nao encontrado", { status: 404 });
    return (rotas[chave] as (url: string) => Response | Promise<Response>)(url);
  };
  return Object.assign(buscar, { chamadas });
}

export const json = (corpo: unknown, status = 200): Response =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json" },
  });

export const binario = (b: Buffer): Response =>
  new Response(new Uint8Array(b), { status: 200 });

/** Linha de 245 bytes do COTAHIST com os campos nas posicoes da B3. */
export function linhaCotahist(r: {
  data: string;
  ticker: string;
  codbdi?: string;
  tpmerc?: string;
  nome?: string;
  especi?: string;
  fechamento: number;
  isin?: string;
}): string {
  const linha = Array.from({ length: 245 }, () => " ");
  const por = (inicio: number, valor: string) => {
    for (let i = 0; i < valor.length; i++) linha[inicio - 1 + i] = valor[i] as string;
  };
  const preco = (v: number) => String(Math.round(v * 100)).padStart(13, "0");
  por(1, "01");
  por(3, r.data.replaceAll("-", ""));
  por(11, r.codbdi ?? "02");
  por(13, r.ticker.padEnd(12));
  por(25, r.tpmerc ?? "010");
  por(28, (r.nome ?? r.ticker).padEnd(12));
  por(40, (r.especi ?? "PN      N2").padEnd(10));
  for (const pos of [57, 70, 83, 96, 109]) por(pos, preco(r.fechamento));
  por(148, "00100");
  por(153, "000000000000001000");
  por(171, preco(r.fechamento * 1000).padStart(18, "0"));
  por(211, "0000001");
  por(231, (r.isin ?? "BRPETRACNPR6").padEnd(12));
  return linha.join("");
}
