/**
 * Abre o "Pergunte ao Bolsiq" de qualquer tela, com uma pergunta ja digitada
 * (o usuario confere e envia; o consentimento continua valendo antes).
 */
export const EVENTO_ABRIR_ASSISTENTE = "bolsiq:abrir-assistente";

export function abrirAssistente(pergunta?: string) {
  window.dispatchEvent(
    new CustomEvent<{ pergunta?: string | undefined }>(EVENTO_ABRIR_ASSISTENTE, {
      detail: { pergunta },
    }),
  );
}
