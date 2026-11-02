import { indicadoresDe } from "@/lib/analytics";

export async function GET(_req: Request, ctx: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await ctx.params;
  if (!/^[A-Za-z0-9]{4,12}$/.test(ticker))
    return Response.json({ data: null }, { status: 404 });
  const dados = await indicadoresDe(ticker.toUpperCase());
  return Response.json({ data: dados }, { status: dados ? 200 : 404 });
}
