// Precificação a partir do custo usando o split configurado (CMV/OpEx/Lucro).
// Regra: o preço de venda é dimensionado para que o custo represente exatamente
// o percentual de CMV. Fórmula: venda = custo / (percentual_cmv / 100).

export function suggestPrice(custo, settings) {
  const custoNum = Number(custo);
  const cmv = Number(settings?.percentual_cmv);
  const opex = Number(settings?.percentual_opex);
  const lucro = Number(settings?.percentual_lucro);

  const valido =
    Number.isFinite(custoNum) && custoNum > 0 &&
    Number.isFinite(cmv) && cmv > 0 && cmv <= 100;

  if (!valido) {
    return { valido: false, sugerido: 0, cmvValor: 0, opexValor: 0, lucroValor: 0 };
  }

  const sugerido = custoNum / (cmv / 100);
  const frac = (p) => (Number.isFinite(p) ? p : 0) / 100;

  return {
    valido: true,
    sugerido,
    cmvValor: sugerido * frac(cmv),
    opexValor: sugerido * frac(opex),
    lucroValor: sugerido * frac(lucro),
  };
}
