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

const tags = ["financas"];

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
    paths: Record<string, Record<string, { security?: unknown }>>;
  };
  doc.components.securitySchemes = {
    sessao: { type: "apiKey", in: "cookie", name: "better-auth.session_token" },
  };
  for (const metodos of Object.values(doc.paths))
    for (const op of Object.values(metodos)) op.security = [{ sessao: [] }];
  return doc;
}
