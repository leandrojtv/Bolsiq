/**
 * PDFs minimos para as fixtures, gerados no teste em vez de binario versionado:
 * o conteudo fica legivel no diff e anonimo por construcao.
 */

/** Uma linha: colunas em posicoes x fixas, para o pdf.js separar com " | ". */
export type LinhaDoPdf = string | string[];

const escapar = (s: string) =>
  s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

function montar(
  objetos: string[],
  binarios: Map<number, Buffer> = new Map(),
): Uint8Array {
  const pedacos: Buffer[] = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  const offsets: number[] = [];
  let tamanho = pedacos[0]?.length ?? 0;
  objetos.forEach((corpo, i) => {
    offsets.push(tamanho);
    const bin = binarios.get(i + 1);
    const partes = bin
      ? [
          Buffer.from(`${i + 1} 0 obj\n${corpo}\nstream\n`, "latin1"),
          bin,
          Buffer.from("\nendstream\nendobj\n", "latin1"),
        ]
      : [Buffer.from(`${i + 1} 0 obj\n${corpo}\nendobj\n`, "latin1")];
    for (const p of partes) {
      pedacos.push(p);
      tamanho += p.length;
    }
  });
  const xref = [
    "xref",
    `0 ${objetos.length + 1}`,
    "0000000000 65535 f ",
    ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n `),
    "trailer",
    `<< /Size ${objetos.length + 1} /Root 1 0 R >>`,
    "startxref",
    String(tamanho),
    "%%EOF",
  ].join("\n");
  pedacos.push(Buffer.from(`${xref}\n`, "latin1"));
  return new Uint8Array(Buffer.concat(pedacos));
}

const COLUNAS = [40, 150, 230, 300, 370, 440, 510, 560];

/** Uma pagina A4 por item, texto em Helvetica com acentos em WinAnsi. */
export function pdfDeTexto(paginas: LinhaDoPdf[][]): Uint8Array {
  const n = paginas.length;
  // 1 catalogo, 2 paginas, 3 fonte, depois (pagina, conteudo) por pagina.
  const objetos = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${paginas.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${n} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];
  for (const linhas of paginas) {
    const comandos = linhas.flatMap((linha, i) => {
      const y = 800 - i * 14;
      const colunas = typeof linha === "string" ? [linha] : linha;
      return colunas.map(
        (texto, c) =>
          `BT /F1 8 Tf ${COLUNAS[c] ?? 40 + c * 70} ${y} Td (${escapar(texto)}) Tj ET`,
      );
    });
    const conteudo = comandos.join("\n");
    objetos.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objetos.length + 2} 0 R >>`,
    );
    objetos.push(
      `<< /Length ${Buffer.byteLength(conteudo, "latin1")} >>\nstream\n${conteudo}\nendstream`,
    );
  }
  return montar(objetos);
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
