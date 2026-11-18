/**
 * Normaliza um timestamp lido do Postgres para ISO 8601 com offset.
 *
 * O driver devolve `timestamptz` no formato do Postgres —
 * `2026-10-31 21:05:00+00` — com espaço em vez de `T` e offset abreviado. O
 * schema do envelope exige ISO com offset (`z.string().datetime({offset:true})`),
 * então publicar o valor cru faz **todo consumidor rejeitar o evento**.
 *
 * Isso não é hipótese: foi o que aconteceu na primeira execução do teste de
 * integração. O dado entrava ISO, voltava no formato do Postgres, e os cinco
 * eventos iam para a dead-letter com "Invalid datetime".
 */
export function paraIsoUtc(valor: string | Date): string {
  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) {
      throw new Error("timestamp inválido: Invalid Date");
    }
    return valor.toISOString();
  }

  let texto = valor.trim();
  if (texto === "") {
    throw new Error("timestamp inválido: (vazio)");
  }

  // Postgres usa espaço como separador; ISO usa T.
  texto = texto.replace(" ", "T");

  // Offset abreviado (`+00`) não é ISO; precisa de minutos (`+00:00`).
  texto = texto.replace(/([+-]\d{2})$/, "$1:00");

  const data = new Date(texto);
  if (Number.isNaN(data.getTime())) {
    throw new Error(`timestamp inválido: ${valor}`);
  }

  return data.toISOString();
}
