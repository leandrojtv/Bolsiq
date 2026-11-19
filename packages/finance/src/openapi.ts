import { buildOpenApi, type RouteSpec } from "@bolsiq/contracts";
import {
  Categoria,
  Conta,
  EdicaoDeCategoria,
  EdicaoDeConta,
  EdicaoDeLancamento,
  FiltroDeLancamentos,
  Lancamento,
  NovaCategoria,
  NovaConta,
  NovoLancamento,
  PaginaDeLancamentos,
  ParametroId,
  ParametroMes,
  RespostaDe,
  ResumoDoMes,
  Vazio,
} from "./contratos.js";
import { z } from "zod";
import {
  AnaliseDeImportacao,
  Cartao,
  EdicaoDeCartao,
  EdicaoDeLinha,
  EdicaoDeRegra,
  Importacao,
  ImportacaoComLinhas,
  NovaImportacao,
  NovaRegra,
  NovoCartao,
  ParametroLinha,
  Regra,
  ResumoDeFatura,
} from "./contratos-importacao.js";

const tags = ["financas"];

const Arquivos = z
  .array(z.string().describe("binário"))
  .describe("Um ou mais arquivos .ofx (campo repetido `arquivos`)");

/** Rotas que recebem multipart/form-data em vez de JSON. */
const MULTIPART = new Set([
  "post /api/financas/importacoes/analise",
  "post /api/financas/importacoes",
]);

/** Rotas do BFF /api/financas (ADR 0031). Um teste do web reprova rota fora daqui. */
export const ROTAS_DE_FINANCAS: RouteSpec[] = [
  {
    method: "get",
    path: "/api/financas/contas",
    summary: "Lista as contas com o saldo atual",
    tags,
    response: RespostaDe(z.array(Conta)),
  },
  {
    method: "post",
    path: "/api/financas/contas",
    summary: "Cria uma conta",
    tags,
    body: NovaConta,
    response: RespostaDe(Conta),
  },
  {
    method: "patch",
    path: "/api/financas/contas/{id}",
    summary: "Edita ou arquiva uma conta",
    tags,
    params: ParametroId,
    body: EdicaoDeConta,
    response: RespostaDe(Conta),
  },
  {
    method: "delete",
    path: "/api/financas/contas/{id}",
    summary: "Apaga uma conta sem lançamentos (com lançamentos: 409, arquive)",
    tags,
    params: ParametroId,
    response: Vazio,
  },
  {
    method: "get",
    path: "/api/financas/categorias",
    summary: "Lista as categorias, semeando as padrão no primeiro acesso",
    tags,
    response: RespostaDe(z.array(Categoria)),
  },
  {
    method: "post",
    path: "/api/financas/categorias",
    summary: "Cria uma categoria",
    tags,
    body: NovaCategoria,
    response: RespostaDe(Categoria),
  },
  {
    method: "patch",
    path: "/api/financas/categorias/{id}",
    summary: "Edita ou arquiva uma categoria",
    tags,
    params: ParametroId,
    body: EdicaoDeCategoria,
    response: RespostaDe(Categoria),
  },
  {
    method: "delete",
    path: "/api/financas/categorias/{id}",
    summary: "Apaga uma categoria (as de sistema não: 409)",
    tags,
    params: ParametroId,
    response: Vazio,
  },
  {
    method: "get",
    path: "/api/financas/lancamentos",
    summary: "Lista lançamentos paginados, com filtros",
    tags,
    query: FiltroDeLancamentos,
    response: PaginaDeLancamentos,
  },
  {
    method: "post",
    path: "/api/financas/lancamentos",
    summary: "Cria receita, despesa ou transferência (par de lançamentos)",
    tags,
    body: NovoLancamento,
    response: RespostaDe(z.array(Lancamento)),
  },
  {
    method: "patch",
    path: "/api/financas/lancamentos/{id}",
    summary: "Edita um lançamento; na transferência, os dois lados",
    tags,
    params: ParametroId,
    body: EdicaoDeLancamento,
    response: RespostaDe(Lancamento),
  },
  {
    method: "delete",
    path: "/api/financas/lancamentos/{id}",
    summary: "Apaga um lançamento; na transferência, os dois lados",
    tags,
    params: ParametroId,
    response: Vazio,
  },
  {
    method: "get",
    path: "/api/financas/resumo",
    summary: "Totais do mês por natureza e status, e saldo por conta",
    tags,
    query: ParametroMes,
    response: RespostaDe(ResumoDoMes),
  },
  {
    method: "get",
    path: "/api/financas/cartoes",
    summary: "Lista os cartões com a fatura atual",
    tags,
    response: RespostaDe(z.array(Cartao)),
  },
  {
    method: "post",
    path: "/api/financas/cartoes",
    summary: "Cria um cartão (dia de fechamento e de vencimento)",
    tags,
    body: NovoCartao,
    response: RespostaDe(Cartao),
  },
  {
    method: "patch",
    path: "/api/financas/cartoes/{id}",
    summary: "Edita ou arquiva um cartão",
    tags,
    params: ParametroId,
    body: EdicaoDeCartao,
    response: RespostaDe(Cartao),
  },
  {
    method: "delete",
    path: "/api/financas/cartoes/{id}",
    summary: "Apaga um cartão sem lançamentos (com lançamentos: 409, arquive)",
    tags,
    params: ParametroId,
    response: Vazio,
  },
  {
    method: "get",
    path: "/api/financas/cartoes/{id}/faturas",
    summary: "Faturas do cartão pelo ciclo, com total e pagamentos",
    tags,
    params: ParametroId,
    response: RespostaDe(z.array(ResumoDeFatura)),
  },
  {
    method: "post",
    path: "/api/financas/importacoes/analise",
    summary: "Lê os arquivos sem gravar e sugere o destino (conta ou cartão e fatura)",
    tags,
    body: z.object({ arquivos: Arquivos }),
    response: RespostaDe(AnaliseDeImportacao),
  },
  {
    method: "get",
    path: "/api/financas/importacoes",
    summary: "Últimas importações",
    tags,
    response: RespostaDe(z.array(Importacao)),
  },
  {
    method: "post",
    path: "/api/financas/importacoes",
    summary: "Cria a revisão: linhas propostas, duplicatas e categorias sugeridas",
    tags,
    body: NovaImportacao.innerType().extend({ arquivos: Arquivos }),
    response: RespostaDe(ImportacaoComLinhas),
  },
  {
    method: "get",
    path: "/api/financas/importacoes/{id}",
    summary: "Importação com as linhas",
    tags,
    params: ParametroId,
    response: RespostaDe(ImportacaoComLinhas),
  },
  {
    method: "patch",
    path: "/api/financas/importacoes/{id}/linhas/{linha}",
    summary:
      "Edita uma linha da revisão: categoria (aplicar a iguais, criar regra), ignorar, transferência, divisão",
    tags,
    params: ParametroLinha,
    body: EdicaoDeLinha,
    response: RespostaDe(ImportacaoComLinhas),
  },
  {
    method: "post",
    path: "/api/financas/importacoes/{id}/confirmar",
    summary: "Grava as linhas marcadas numa transação e publica o evento no outbox",
    tags,
    params: ParametroId,
    response: RespostaDe(Importacao),
  },
  {
    method: "post",
    path: "/api/financas/importacoes/{id}/cancelar",
    summary: "Descarta a revisão sem gravar",
    tags,
    params: ParametroId,
    response: RespostaDe(Importacao),
  },
  {
    method: "post",
    path: "/api/financas/importacoes/{id}/desfazer",
    summary: "Apaga os lançamentos da importação, se nenhum foi conciliado",
    tags,
    params: ParametroId,
    response: RespostaDe(Importacao),
  },
  {
    method: "get",
    path: "/api/financas/regras",
    summary: "Regras de categorização, na ordem em que são aplicadas",
    tags,
    response: RespostaDe(z.array(Regra)),
  },
  {
    method: "post",
    path: "/api/financas/regras",
    summary: "Cria uma regra (contém, começa com ou regex)",
    tags,
    body: NovaRegra,
    response: RespostaDe(Regra),
  },
  {
    method: "patch",
    path: "/api/financas/regras/{id}",
    summary: "Edita uma regra; a aprendida passa a ser do usuário",
    tags,
    params: ParametroId,
    body: EdicaoDeRegra,
    response: RespostaDe(Regra),
  },
  {
    method: "delete",
    path: "/api/financas/regras/{id}",
    summary: "Apaga uma regra",
    tags,
    params: ParametroId,
    response: Vazio,
  },
  {
    method: "get",
    path: "/api/financas/openapi",
    summary: "Este documento",
    tags,
    response: z.record(z.unknown()),
  },
];

/** OpenAPI do BFF de financas. Autenticacao pelo cookie de sessao do Better Auth. */
export function openApiDeFinancas(versao: string): Record<string, unknown> {
  const doc = buildOpenApi(
    {
      title: "Bolsiq Finanças (BFF)",
      version: versao,
      description:
        "Rotas do BFF do Bolsiq Finanças. Uso interno do app; exigem a sessão do usuário.",
      servers: [{ url: "/", description: "O próprio app" }],
    },
    ROTAS_DE_FINANCAS,
  ) as {
    components: { securitySchemes: Record<string, unknown> };
    paths: Record<
      string,
      Record<
        string,
        { security?: unknown; requestBody?: { content: Record<string, unknown> } }
      >
    >;
  };
  doc.components.securitySchemes = {
    sessao: { type: "apiKey", in: "cookie", name: "better-auth.session_token" },
  };
  for (const [caminho, metodos] of Object.entries(doc.paths))
    for (const [metodo, op] of Object.entries(metodos)) {
      op.security = [{ sessao: [] }];
      if (op.requestBody && MULTIPART.has(`${metodo} ${caminho}`))
        op.requestBody.content = {
          "multipart/form-data": op.requestBody.content["application/json"],
        };
    }
  return doc;
}
