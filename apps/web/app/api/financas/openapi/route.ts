import { openApiDeFinancas } from "@bolsiq/finance";

/** OpenAPI do BFF de financas, gerado dos schemas Zod (regra 3). */
export function GET() {
  return Response.json(openApiDeFinancas(process.env.npm_package_version ?? "0.0.0"));
}
