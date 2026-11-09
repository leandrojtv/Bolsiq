import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Programas do sistema que a leitura usa quando o pdf.js nao basta (ADR 0027).
 * Instalados na imagem do worker e do web (poppler-utils, tesseract-ocr com
 * `por`, libheif-examples, qpdf). Injetados: os testes usam versoes falsas, e
 * ausencia de um programa vira estrategia alternativa, nao erro.
 */
export interface FerramentasDoSistema {
  /** Texto de cada pagina (pdftotext), para PDF que o pdf.js nao abre. */
  pdftotext?(pdf: Uint8Array): Promise<string[]>;
  /** Uma pagina como PNG (pdftoppm), para visao ou OCR. */
  renderizar?(pdf: Uint8Array, pagina: number): Promise<Uint8Array>;
  /** Texto de uma imagem (tesseract, portugues). */
  ocr?(imagem: Uint8Array): Promise<string>;
  /** HEIC do celular para PNG (heif-convert). */
  heicParaPng?(heic: Uint8Array): Promise<Uint8Array>;
  /** PDF sem a senha (qpdf). A senha vai por arquivo temporario, nunca na linha de comando. */
  decifrarPdf?(pdf: Uint8Array, senha: string): Promise<Uint8Array>;
}

/** Saida com codigo diferente de zero: o codigo e o stderr, para quem chamou decidir. */
class ErroDoPrograma extends Error {
  constructor(
    mensagem: string,
    readonly code: unknown,
    readonly stderr: string,
  ) {
    super(mensagem);
  }
}

const executar = (programa: string, args: string[], tempo = 120_000) =>
  new Promise<{ stdout: string; stderr: string }>((ok, erro) => {
    execFile(
      programa,
      args,
      { timeout: tempo, maxBuffer: 64 * 1024 * 1024, encoding: "utf8" },
      (e, stdout, stderr) =>
        e ? erro(new ErroDoPrograma(e.message, e.code, stderr)) : ok({ stdout, stderr }),
    );
  });

async function comPasta<T>(fn: (pasta: string) => Promise<T>): Promise<T> {
  const pasta = await mkdtemp(join(tmpdir(), "bolsiq-importacao-"));
  try {
    return await fn(pasta);
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
}

const existe = async (programa: string) =>
  executar("sh", ["-c", `command -v ${programa}`], 5_000)
    .then(() => true)
    .catch(() => false);

export class SenhaIncorreta extends Error {}

/** As ferramentas que este processo tem. Programa que falta fica de fora. */
export async function ferramentasDoSistema(): Promise<FerramentasDoSistema> {
  const [pdftotext, pdftoppm, tesseract, heif, qpdf] = await Promise.all(
    ["pdftotext", "pdftoppm", "tesseract", "heif-convert", "qpdf"].map(existe),
  );
  const f: FerramentasDoSistema = {};
  if (pdftotext)
    f.pdftotext = (pdf) =>
      comPasta(async (pasta) => {
        const entrada = join(pasta, "doc.pdf");
        await writeFile(entrada, pdf);
        const { stdout } = await executar("pdftotext", [
          "-layout",
          "-enc",
          "UTF-8",
          entrada,
          "-",
        ]);
        // pdftotext separa paginas por form feed.
        return stdout.split("\f").slice(0, -1);
      });
  if (pdftoppm)
    f.renderizar = (pdf, pagina) =>
      comPasta(async (pasta) => {
        const entrada = join(pasta, "doc.pdf");
        await writeFile(entrada, pdf);
        const n = String(pagina);
        await executar("pdftoppm", [
          "-r",
          "200",
          "-png",
          "-gray",
          "-f",
          n,
          "-l",
          n,
          "-singlefile",
          entrada,
          join(pasta, "p"),
        ]);
        return new Uint8Array(await readFile(join(pasta, "p.png")));
      });
  if (tesseract)
    f.ocr = (imagem) =>
      comPasta(async (pasta) => {
        const entrada = join(pasta, "img.png");
        await writeFile(entrada, imagem);
        // psm 6: bloco uniforme de texto, bom para tabela de extrato.
        const { stdout } = await executar("tesseract", [
          entrada,
          "stdout",
          "-l",
          "por",
          "--psm",
          "6",
        ]);
        return stdout;
      });
  if (heif)
    f.heicParaPng = (heic) =>
      comPasta(async (pasta) => {
        await writeFile(join(pasta, "in.heic"), heic);
        await executar("heif-convert", [join(pasta, "in.heic"), join(pasta, "out.png")]);
        return new Uint8Array(await readFile(join(pasta, "out.png")));
      });
  if (qpdf)
    f.decifrarPdf = (pdf, senha) =>
      comPasta(async (pasta) => {
        const entrada = join(pasta, "in.pdf");
        const segredo = join(pasta, "senha");
        await writeFile(entrada, pdf);
        await writeFile(segredo, `${senha}\n`, { mode: 0o600 });
        try {
          await executar("qpdf", [
            `--password-file=${segredo}`,
            "--decrypt",
            entrada,
            join(pasta, "out.pdf"),
          ]);
        } catch (e) {
          // 3: decifrou com aviso, e o arquivo esta la. 2: senha errada ou PDF invalido.
          if ((e as { code?: unknown }).code !== 3) {
            if (/invalid password/i.test(String((e as { stderr?: string }).stderr)))
              throw new SenhaIncorreta();
            throw e;
          }
        }
        return new Uint8Array(await readFile(join(pasta, "out.pdf")));
      });
  return f;
}
