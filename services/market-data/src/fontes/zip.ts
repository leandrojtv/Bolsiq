import { createInterface } from "node:readline";
import yauzl from "yauzl";

/**
 * Le as linhas das entradas de um ZIP, em streaming.
 *
 * `latin1` e o encoding de todos os arquivos da CVM e da B3. Decodificar como
 * UTF-8 trocaria "ÚLTIMO" por lixo, e o filtro de ORDEM_EXERC descartaria
 * todas as linhas sem erro nenhum.
 */
export async function* linhasDoZip(
  caminho: string,
  aceitar: (nomeDaEntrada: string) => boolean = () => true,
): AsyncGenerator<{ entrada: string; linha: string }> {
  const zip = await new Promise<yauzl.ZipFile>((ok, falha) => {
    yauzl.open(caminho, { lazyEntries: true, autoClose: true }, (erro, z) => {
      if (erro) falha(erro);
      else ok(z);
    });
  });

  try {
    while (true) {
      const entrada = await new Promise<yauzl.Entry | null>((ok, falha) => {
        const aoEntrar = (e: yauzl.Entry) => {
          zip.off("end", aoFim);
          zip.off("error", falha);
          ok(e);
        };
        const aoFim = () => {
          zip.off("entry", aoEntrar);
          ok(null);
        };
        zip.once("entry", aoEntrar);
        zip.once("end", aoFim);
        zip.once("error", falha);
        zip.readEntry();
      });
      if (entrada === null) return;
      if (entrada.fileName.endsWith("/") || !aceitar(entrada.fileName)) continue;

      const fluxo = await new Promise<NodeJS.ReadableStream>((ok, falha) => {
        zip.openReadStream(entrada, (erro, s) => {
          if (erro) falha(erro);
          else ok(s);
        });
      });
      (fluxo as NodeJS.ReadableStream & { setEncoding: (e: string) => void }).setEncoding(
        "latin1",
      );

      for await (const linha of createInterface({ input: fluxo, crlfDelay: Infinity })) {
        yield { entrada: entrada.fileName, linha: linha.replace(/\r$/, "") };
      }
    }
  } finally {
    zip.close();
  }
}
