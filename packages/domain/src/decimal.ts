/**
 * Aritmética decimal exata por deslocamento de ponto.
 *
 * Todas as conversões que o projeto precisa — centavos para reais, fator de
 * cotação da B3, ESCALA_MOEDA da CVM — são multiplicações e divisões por
 * potência de dez. Isso permite resolvê-las movendo o ponto decimal na string,
 * sem nunca passar por `number`.
 *
 * Fazer `Number(raw) / 100` seria mais curto e estaria errado: regra 5 do
 * CLAUDE.md proíbe `float` em moeda, e `1234567890123 / 100` já perde
 * precisão em double.
 */
export function shiftDecimal(valor: string, casas: number): string {
  const negativo = valor.startsWith("-");
  const semSinal = negativo ? valor.slice(1) : valor;

  if (!/^\d*(\.\d*)?$/.test(semSinal) || semSinal === "" || semSinal === ".") {
    throw new Error(`valor decimal inválido: ${valor}`);
  }

  const [inteiraBruta = "", fracionariaBruta = ""] = semSinal.split(".");
  const digitos = `${inteiraBruta}${fracionariaBruta}`;
  // Posição do ponto contada da esquerda, dentro de `digitos`.
  const ponto = inteiraBruta.length + casas;

  let resultado: string;
  if (ponto <= 0) {
    resultado = `0.${"0".repeat(-ponto)}${digitos}`;
  } else if (ponto >= digitos.length) {
    resultado = `${digitos}${"0".repeat(ponto - digitos.length)}`;
  } else {
    resultado = `${digitos.slice(0, ponto)}.${digitos.slice(ponto)}`;
  }

  return normalizar(resultado, negativo);
}

function normalizar(valor: string, negativo: boolean): string {
  let [inteira = "0", fracionaria = ""] = valor.split(".");

  inteira = inteira.replace(/^0+(?=\d)/, "");
  fracionaria = fracionaria.replace(/0+$/, "");

  if (inteira === "") inteira = "0";

  const semSinal = fracionaria === "" ? inteira : `${inteira}.${fracionaria}`;
  const ehZero = /^0(\.0*)?$/.test(semSinal);

  // Evita devolver "-0": zero não tem sinal.
  return negativo && !ehZero ? `-${semSinal}` : semSinal;
}
