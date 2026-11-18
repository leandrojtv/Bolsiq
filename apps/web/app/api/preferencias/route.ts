import {
  lerPreferencias,
  salvarPreferencias,
  telegramHabilitadoNoApp,
} from "@/lib/alertas";
import type { CanalDeAlerta } from "@/lib/alertas-modelo";
import { env } from "@/lib/env";
import { Preferencias } from "@/lib/alertas-modelo";
import { invalido, tratar } from "@/lib/respostas";
import { usuarioAtual } from "@/lib/usuario";

/** Canais que este ambiente entrega: Push so com VAPID, Telegram so com a flag. */
function disponiveis(): CanalDeAlerta[] {
  return [
    "inapp",
    "email",
    ...(env.VAPID_PUBLIC_KEY ? (["push"] as const) : []),
    ...(telegramHabilitadoNoApp() ? (["telegram"] as const) : []),
  ];
}

export async function GET() {
  return Response.json({
    data: await lerPreferencias(await usuarioAtual()),
    canais_disponiveis: disponiveis(),
  });
}

export async function PUT(req: Request) {
  const r = Preferencias.safeParse(await req.json().catch(() => null));
  if (!r.success) return invalido(r.error);
  try {
    const uid = await usuarioAtual();
    await salvarPreferencias(uid, r.data);
    return Response.json({
      data: await lerPreferencias(uid),
      canais_disponiveis: disponiveis(),
    });
  } catch (erro) {
    return tratar(erro);
  }
}
