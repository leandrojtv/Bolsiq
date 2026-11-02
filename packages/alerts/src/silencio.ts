/**
 * Janela de silencio.
 *
 * Canal externo (e-mail, push, Telegram) espera o fim da janela; o in-app nao,
 * porque a notificacao na central nao acorda ninguem. A janela pode cruzar a
 * meia-noite (22:00 a 07:00), e e o caso comum.
 *
 * Horario no fuso do usuario, via Intl: o Brasil nao tem horario de verao hoje,
 * mas o fuso nomeado continua certo se voltar a ter.
 */
export function fimDoSilencio(
  agora: Date,
  inicio: string | null,
  fim: string | null,
  fuso: string,
): Date | null {
  if (!inicio || !fim) return null;

  const minutosAgora = minutosNoFuso(agora, fuso);
  const ini = paraMinutos(inicio);
  const fi = paraMinutos(fim);
  if (ini === null || fi === null || ini === fi) return null;

  const dentro =
    ini < fi
      ? minutosAgora >= ini && minutosAgora < fi
      : minutosAgora >= ini || minutosAgora < fi;
  if (!dentro) return null;

  let espera = fi - minutosAgora;
  if (espera <= 0) espera += 24 * 60;
  return new Date(agora.getTime() + espera * 60_000);
}

function paraMinutos(hhmm: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function minutosNoFuso(data: Date, fuso: string): number {
  const partes = new Intl.DateTimeFormat("en-GB", {
    timeZone: fuso,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(data);
  const h = Number(partes.find((p) => p.type === "hour")?.value);
  const m = Number(partes.find((p) => p.type === "minute")?.value);
  return h * 60 + m;
}
