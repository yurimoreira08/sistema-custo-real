/**
 * Utilitário Financeiro e de Precisão Decimal - LucroCerto (S05)
 * Responsável: Francisco Yuri da Silva Mauriz
 * 
 * Regras:
 * - Operações financeiras com precisão decimal estrita de duas casas (centavos inteiros).
 * - Eliminação de erros de ponto flutuante do IEEE 754.
 * - Cálculos determinísticos, reproduzíveis e imutáveis.
 */

/**
 * Arredonda um número para 2 casas decimais de forma determinística
 * utilizando epsilon para evitar truncamento indevido de floats binários.
 */
export function round2(val) {
  const num = Number(val);
  if (isNaN(num)) return 0.0;
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

/**
 * Arredonda quantidades fracionárias de estoque (3 casas decimais - gramas/litros)
 */
export function round3(val) {
  const num = Number(val);
  if (isNaN(num)) return 0.0;
  return Math.round((num + Number.EPSILON) * 1000) / 1000;
}

/**
 * Converte um valor monetário (reais) em número inteiro de centavos
 */
export function toCents(val) {
  const num = Number(val);
  if (isNaN(num)) return 0;
  return Math.round((num + Number.EPSILON) * 100);
}

/**
 * Converte centavos inteiros de volta para reais (float com 2 casas decimais)
 */
export function fromCents(cents) {
  const c = parseInt(cents, 10);
  if (isNaN(c)) return 0.0;
  return round2(c / 100);
}

/**
 * Soma uma lista de valores monetários com precisão exata de centavos
 */
export function sumMoney(...values) {
  const totalCents = values.reduce((acc, v) => acc + toCents(v), 0);
  return fromCents(totalCents);
}

/**
 * Subtrai valores monetários garantindo precisão de centavos
 */
export function subtractMoney(base, ...values) {
  const baseCents = toCents(base);
  const subtractCents = values.reduce((acc, v) => acc + toCents(v), 0);
  return fromCents(baseCents - subtractCents);
}

/**
 * Multiplica valor monetário por uma quantidade
 */
export function multiplyMoney(unitPrice, quantity) {
  const p = Number(unitPrice) || 0;
  const q = Number(quantity) || 0;
  return round2(p * q);
}

/**
 * Calcula taxa percentual e fixa sobre um valor bruto,
 * garantindo: valorBruto = valorLiquido + valorTaxa (sem centavos perdidos)
 */
export function calcularTaxaMonetaria(valorBruto, taxaPercentual = 0, taxaFixa = 0) {
  const brutoCents = toCents(valorBruto);
  if (brutoCents <= 0) {
    return {
      valorBruto: 0.0,
      taxaPercentual: round2(taxaPercentual),
      taxaFixa: round2(taxaFixa),
      valorTaxa: 0.0,
      valorLiquido: 0.0
    };
  }

  const pct = Math.max(0, Number(taxaPercentual) || 0);
  const fixCents = toCents(Math.max(0, Number(taxaFixa) || 0));

  // Taxa percentual calculada em centavos inteiros com arredondamento padrão
  const taxaVariavelCents = Math.round((brutoCents * pct) / 100);
  const taxaTotalCents = Math.min(brutoCents, taxaVariavelCents + fixCents);
  const liquidoCents = Math.max(0, brutoCents - taxaTotalCents);

  return {
    valorBruto: fromCents(brutoCents),
    taxaPercentual: round2(pct),
    taxaFixa: fromCents(fixCents),
    valorTaxa: fromCents(taxaTotalCents),
    valorLiquido: fromCents(liquidoCents)
  };
}

/**
 * Valida se uma soma de pagamentos é exatamente igual ao valor total da venda
 * Rejeita qualquer divergência além de 0 centavos.
 */
export function validarIgualdadeMonetaria(totalEsperado, pagamentos) {
  const esperadoCents = toCents(totalEsperado);
  const somaCents = (pagamentos || []).reduce((acc, p) => {
    const val = p.valor_bruto ?? p.valor ?? 0;
    return acc + toCents(val);
  }, 0);

  const diffCents = somaCents - esperadoCents;
  return {
    valido: diffCents === 0,
    esperado: fromCents(esperadoCents),
    recebido: fromCents(somaCents),
    diferenca: fromCents(diffCents)
  };
}

/**
 * Calcula rateio proporcional de um valor (ex: taxas estornadas na devolução parcial)
 */
export function calcularProporcional(valorBase, parte, total) {
  const totalCents = toCents(total);
  if (totalCents <= 0) return 0.0;
  const parteCents = toCents(parte);
  const baseCents = toCents(valorBase);

  const resultadoCents = Math.round((baseCents * parteCents) / totalCents);
  return fromCents(resultadoCents);
}
