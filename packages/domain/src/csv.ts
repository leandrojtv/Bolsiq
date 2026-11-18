/**
 * Divide uma linha de CSV da CVM.
 *
 * Os arquivos usam `;` sem aspas na pratica, mas o padrao CSV permite campo
 * entre aspas com o separador dentro. Tratar isso custa pouco e evita uma
 * coluna deslocada em silencio no dia em que uma razao social trouxer `;`.
 */
export function dividirLinhaCsv(linha: string, separador = ";"): string[] {
  if (!linha.includes('"')) return linha.split(separador);

  const campos: string[] = [];
  let atual = "";
  let entreAspas = false;

  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (entreAspas) {
      if (c === '"' && linha[i + 1] === '"') {
        atual += '"';
        i++;
      } else if (c === '"') {
        entreAspas = false;
      } else {
        atual += c;
      }
    } else if (c === '"') {
      entreAspas = true;
    } else if (c === separador) {
      campos.push(atual);
      atual = "";
    } else {
      atual += c;
    }
  }
  campos.push(atual);
  return campos;
}

/** Cria um leitor de linhas por nome de coluna a partir do cabecalho. */
export function leitorDeColunas(cabecalho: string, separador = ";") {
  const indices = new Map(
    dividirLinhaCsv(cabecalho.replace(/^\uFEFF/, ""), separador).map((nome, i) => [
      nome.trim(),
      i,
    ]),
  );

  const ler = (linha: string) => {
    const campos = dividirLinhaCsv(linha, separador);
    return (coluna: string): string => {
      const i = indices.get(coluna);
      if (i === undefined) throw new Error(`coluna ausente no CSV: ${coluna}`);
      return (campos[i] ?? "").trim();
    };
  };
  // Balanco nao tem DT_INI_EXERC: e posicao, nao fluxo. Quem le precisa saber
  // se a coluna existe em vez de receber vazio de uma coluna inexistente.
  return Object.assign(ler, { tem: (coluna: string) => indices.has(coluna) });
}
