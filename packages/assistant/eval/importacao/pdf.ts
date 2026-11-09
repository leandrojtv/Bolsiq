import { createHash, randomBytes } from "node:crypto";

/**
 * PDFs minimos para as fixtures, gerados no teste em vez de binario versionado:
 * o conteudo fica legivel no diff e anonimo por construcao.
 */

/** Uma linha: colunas em posicoes x fixas, para o pdf.js separar com " | ". */
export type LinhaDoPdf = string | string[];

const escapar = (s: string) =>
  s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

/** RC4, para o handler de seguranca padrao do PDF (R2, 40 bits). So para fixture. */
function rc4(chave: Buffer, dados: Buffer): Buffer {
  const S = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + (S[i] as number) + (chave[i % chave.length] as number)) & 255;
    [S[i], S[j]] = [S[j] as number, S[i] as number];
  }
  const saida = Buffer.alloc(dados.length);
  for (let n = 0, i = 0, j = 0; n < dados.length; n++) {
    i = (i + 1) & 255;
    j = (j + (S[i] as number)) & 255;
    [S[i], S[j]] = [S[j] as number, S[i] as number];
    saida[n] =
      (dados[n] as number) ^ (S[((S[i] as number) + (S[j] as number)) & 255] as number);
  }
  return saida;
}

const md5 = (...partes: Buffer[]) =>
  createHash("md5").update(Buffer.concat(partes)).digest();

const PREENCHIMENTO = Buffer.from(
  "28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A",
  "hex",
);
const completar = (senha: string) =>
  Buffer.concat([Buffer.from(senha, "latin1"), PREENCHIMENTO]).subarray(0, 32);

interface Cifra {
  /** Cifra o stream do objeto `numero`. */
  stream(numero: number, dados: Buffer): Buffer;
  dicionario: string;
  id: Buffer;
}

/** Algoritmos 2, 3 e 4 da especificacao (R2): dono e usuario com a mesma senha. */
function cifraDoPdf(senha: string): Cifra {
  const id = randomBytes(16);
  const p = -4;
  const pBytes = Buffer.alloc(4);
  pBytes.writeInt32LE(p);
  const O = rc4(md5(completar(senha)).subarray(0, 5), completar(senha));
  const chave = md5(completar(senha), O, pBytes, id).subarray(0, 5);
  const U = rc4(chave, PREENCHIMENTO);
  return {
    id,
    dicionario: `<< /Filter /Standard /V 1 /R 2 /O <${O.toString("hex")}> /U <${U.toString("hex")}> /P ${p} >>`,
    stream: (numero, dados) => {
      const sufixo = Buffer.from([
        numero & 255,
        (numero >> 8) & 255,
        (numero >> 16) & 255,
        0,
        0,
      ]);
      return rc4(md5(chave, sufixo).subarray(0, 10), dados);
    },
  };
}

function montar(
  objetos: string[],
  binarios: Map<number, Buffer> = new Map(),
  cifra?: Cifra,
): Uint8Array {
  const pedacos: Buffer[] = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  const offsets: number[] = [];
  let tamanho = pedacos[0]?.length ?? 0;
  const todos = cifra ? [...objetos, cifra.dicionario] : objetos;
  todos.forEach((corpo, i) => {
    offsets.push(tamanho);
    const numero = i + 1;
    const bruto = binarios.get(numero);
    const bin = bruto && cifra ? cifra.stream(numero, bruto) : bruto;
    const partes = bin
      ? [
          Buffer.from(
            `${numero} 0 obj\n${corpo.replace("{TAMANHO}", String(bin.length))}\nstream\n`,
            "latin1",
          ),
          bin,
          Buffer.from("\nendstream\nendobj\n", "latin1"),
        ]
      : [Buffer.from(`${numero} 0 obj\n${corpo}\nendobj\n`, "latin1")];
    for (const p of partes) {
      pedacos.push(p);
      tamanho += p.length;
    }
  });
  const id = cifra?.id.toString("hex");
  const extra = cifra ? ` /Encrypt ${todos.length} 0 R /ID [<${id}> <${id}>]` : "";
  const xref = [
    "xref",
    `0 ${todos.length + 1}`,
    "0000000000 65535 f ",
    ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n `),
    "trailer",
    `<< /Size ${todos.length + 1} /Root 1 0 R${extra} >>`,
    "startxref",
    String(tamanho),
    "%%EOF",
  ].join("\n");
  pedacos.push(Buffer.from(`${xref}\n`, "latin1"));
  return new Uint8Array(Buffer.concat(pedacos));
}

const COLUNAS = [40, 150, 230, 300, 370, 440, 510, 560];

/** Uma pagina A4 por item, texto em Helvetica com acentos em WinAnsi. Com `senha`, cifrado. */
export function pdfDeTexto(paginas: LinhaDoPdf[][], senha?: string): Uint8Array {
  const n = paginas.length;
  // 1 catalogo, 2 paginas, 3 fonte, depois (pagina, conteudo) por pagina.
  const objetos = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${paginas.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${n} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];
  const binarios = new Map<number, Buffer>();
  for (const linhas of paginas) {
    const comandos = linhas.flatMap((linha, i) => {
      const y = 800 - i * 14;
      const colunas = typeof linha === "string" ? [linha] : linha;
      return colunas.map(
        (texto, c) =>
          `BT /F1 8 Tf ${colunas.length > 8 ? 40 + c * 120 : (COLUNAS[c] ?? 40 + c * 70)} ${y} Td (${escapar(texto)}) Tj ET`,
      );
    });
    objetos.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1400 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objetos.length + 2} 0 R >>`,
    );
    objetos.push("<< /Length {TAMANHO} >>");
    binarios.set(objetos.length, Buffer.from(comandos.join("\n"), "latin1"));
  }
  return montar(objetos, binarios, senha === undefined ? undefined : cifraDoPdf(senha));
}

/** Pagina so com imagem, como sai de um scanner: o pdf.js nao acha texto nenhum. */
export function pdfEscaneado(): Uint8Array {
  const largura = 8;
  const altura = 8;
  const pixels = Buffer.alloc(largura * altura, 0xc0);
  const desenho = "q 595 0 0 842 0 0 cm /Im1 Do Q";
  return montar(
    [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>",
      `<< /Type /XObject /Subtype /Image /Width ${largura} /Height ${altura} /ColorSpace /DeviceGray /BitsPerComponent 8 /Length ${pixels.length} >>`,
      `<< /Length ${desenho.length} >>\nstream\n${desenho}\nendstream`,
    ],
    new Map([[4, pixels]]),
  );
}
