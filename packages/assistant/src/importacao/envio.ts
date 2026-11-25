import { detectarAtalho, type Atalho } from "./atalho.js";
import { SenhaIncorreta, type FerramentasDoSistema } from "./ferramentas.js";
import { decodificar, exigeSenha } from "./texto.js";
import { ErroDeImportacao, tipoDoArquivo } from "./recebimento.js";

/**
 * O envio antes do job (ADR 0027 e 0040): tamanho, atalho dos layouts da
 * carteira e o PDF com senha, aberto aqui com qpdf. A senha existe so nesta
 * chamada, em memoria: o que sai daqui nao tem o campo `senha`, e nenhuma
 * mensagem de erro a repete. O job (banco e worker) so ve o PDF decifrado.
 */

export interface ArquivoDoEnvio {
  nome: string;
  mime: string;
  bytes: Uint8Array;
  corretora: string;
  senha: string;
}

/** O arquivo como vai para o job: sem senha. */
export type ArquivoAberto = Omit<ArquivoDoEnvio, "senha">;

export interface OpcoesDoEnvio {
  limite_mb: number;
  /** carteira: CSV no layout do Bolsiq vai pelo importador sem IA. */
  documento: "carteira" | "financas";
}

export async function abrirArquivosDoEnvio(
  arquivos: ArquivoDoEnvio[],
  ferramentas: FerramentasDoSistema,
  o: OpcoesDoEnvio,
): Promise<{ abertos: ArquivoAberto[]; atalhos: { nome: string; atalho: Atalho }[] }> {
  const limite = o.limite_mb * 1024 * 1024;
  const atalhos: { nome: string; atalho: Atalho }[] = [];
  const precisaSenha: string[] = [];
  const abertos: ArquivoAberto[] = [];
  for (const { senha, ...a } of arquivos) {
    if (a.bytes.byteLength === 0)
      throw new ErroDeImportacao("vazio", `${a.nome} está vazio.`);
    if (a.bytes.byteLength > limite)
      throw new ErroDeImportacao(
        "grande_demais",
        `${a.nome} passa de ${o.limite_mb} MB. Divida o arquivo por período ou por conta.`,
        413,
      );
    const tipo = tipoDoArquivo(a.nome, a.mime, a.bytes);
    if (tipo === "csv" || tipo === "txt") {
      if (o.documento === "financas")
        throw new ErroDeImportacao(
          "use_sem_ia",
          `${a.nome}: CSV e OFX vão pela importação sem IA, na mesma tela.`,
          422,
        );
      const atalho = detectarAtalho(decodificar(a.bytes));
      if (atalho) {
        atalhos.push({ nome: a.nome, atalho });
        continue;
      }
    }
    if (tipo === "pdf" && (await exigeSenha(a.bytes))) {
      if (!senha) {
        precisaSenha.push(a.nome);
        continue;
      }
      if (!ferramentas.decifrarPdf)
        throw new ErroDeImportacao(
          "sem_qpdf",
          "Este servidor não consegue abrir PDF com senha. Salve o PDF sem senha e envie de novo.",
          503,
        );
      try {
        abertos.push({ ...a, bytes: await ferramentas.decifrarPdf(a.bytes, senha) });
      } catch (e) {
        if (e instanceof SenhaIncorreta)
          throw new ErroDeImportacao(
            "senha_incorreta",
            `A senha de ${a.nome} não confere.`,
            422,
          );
        // O erro do qpdf pode citar o arquivo da senha: sobe sem detalhe.
        throw new ErroDeImportacao(
          "pdf_ilegivel",
          `Não foi possível abrir ${a.nome} com a senha informada.`,
          422,
        );
      }
      continue;
    }
    abertos.push(a);
  }
  if (precisaSenha.length > 0)
    throw new ErroDeImportacao(
      "precisa_senha",
      `${precisaSenha.join(", ")} ${precisaSenha.length === 1 ? "tem" : "têm"} senha. Informe para abrir (muitos bancos usam parte do CPF).`,
      422,
    );
  return { abertos, atalhos };
}
