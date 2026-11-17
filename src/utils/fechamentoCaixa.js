/**
 * Utilitário de Fechamento Cego de Caixa (S08)
 *
 * Regras:
 * - Contagem cega: o operador informa a quantidade de cada cédula/moeda SEM ver o saldo
 *   esperado (contábil). O sistema soma em centavos inteiros e só depois compara.
 * - Diferença = contado (físico) − esperado (contábil). Positivo = sobra; negativo = falta (quebra).
 * - A diferença é tipificada (SOBRA / FALTA / CONFERIDO) e classificada por gravidade
 *   conforme a tolerância configurada.
 */
import { toCents, fromCents } from './money';

/** Cédulas e moedas do Real em circulação, da maior para a menor. */
export const DENOMINACOES_BRL = [
  { valor: 200, tipo: 'cedula', rotulo: 'R$ 200' },
  { valor: 100, tipo: 'cedula', rotulo: 'R$ 100' },
  { valor: 50, tipo: 'cedula', rotulo: 'R$ 50' },
  { valor: 20, tipo: 'cedula', rotulo: 'R$ 20' },
  { valor: 10, tipo: 'cedula', rotulo: 'R$ 10' },
  { valor: 5, tipo: 'cedula', rotulo: 'R$ 5' },
  { valor: 2, tipo: 'cedula', rotulo: 'R$ 2' },
  { valor: 1, tipo: 'moeda', rotulo: 'R$ 1' },
  { valor: 0.5, tipo: 'moeda', rotulo: 'R$ 0,50' },
  { valor: 0.25, tipo: 'moeda', rotulo: 'R$ 0,25' },
  { valor: 0.1, tipo: 'moeda', rotulo: 'R$ 0,10' },
  { valor: 0.05, tipo: 'moeda', rotulo: 'R$ 0,05' },
];

/**
 * Tolerâncias padrão da conferência:
 * - toleranciaAceitavel: diferenças até este valor (em módulo) são aceitas sem apontamento.
 * - limiteGrave: a partir deste valor a diferença é GRAVE e exige justificativa.
 */
export const TOLERANCIA_PADRAO = Object.freeze({ toleranciaAceitavel: 1.0, limiteGrave: 20.0 });

/**
 * Soma a contagem física de cédulas e moedas.
 * @param {Object<string, number>} contagem - quantidade por denominação, ex.: { '50': 2, '0.25': 4 }
 * @returns {{ total: number, totalCedulas: number, totalMoedas: number, itens: Array }}
 * @throws {Error} se houver denominação desconhecida ou quantidade inválida
 */
export function calcularTotalContagem(contagem = {}) {
  const porValor = new Map(DENOMINACOES_BRL.map((d) => [toCents(d.valor), d]));
  let centsCedulas = 0;
  let centsMoedas = 0;
  const itens = [];

  for (const [chave, qtdBruta] of Object.entries(contagem || {})) {
    const den = porValor.get(toCents(String(chave).replace(',', '.')));
    if (!den) throw new Error(`Denominação desconhecida na contagem: ${chave}.`);

    const qtd = Number(qtdBruta || 0);
    if (!Number.isInteger(qtd) || qtd < 0) {
      throw new Error(`Quantidade inválida para ${den.rotulo}: informe um número inteiro maior ou igual a zero.`);
    }
    if (qtd === 0) continue;

    const subtotalCents = toCents(den.valor) * qtd;
    if (den.tipo === 'cedula') centsCedulas += subtotalCents;
    else centsMoedas += subtotalCents;
    itens.push({ valor: den.valor, rotulo: den.rotulo, tipo: den.tipo, quantidade: qtd, subtotal: fromCents(subtotalCents) });
  }

  // Ordem fixa (maior → menor) para relatório e assinatura determinísticos
  itens.sort((a, b) => b.valor - a.valor);
  return {
    total: fromCents(centsCedulas + centsMoedas),
    totalCedulas: fromCents(centsCedulas),
    totalMoedas: fromCents(centsMoedas),
    itens,
  };
}

/**
 * Tipifica e classifica a diferença entre o físico contado e o contábil esperado.
 * @param {number} diferenca - contado − esperado (R$)
 * @param {{ toleranciaAceitavel?: number, limiteGrave?: number }} [tolerancia]
 * @returns {{ tipo: 'CONFERIDO'|'SOBRA'|'FALTA', gravidade: 'EXATO'|'DENTRO_TOLERANCIA'|'LEVE'|'GRAVE',
 *            situacao: string, exigeJustificativa: boolean, valorAbsoluto: number, descricao: string }}
 */
export function classificarDiferencaCaixa(diferenca, tolerancia = TOLERANCIA_PADRAO) {
  const { toleranciaAceitavel, limiteGrave } = { ...TOLERANCIA_PADRAO, ...(tolerancia || {}) };
  const difCents = toCents(diferenca);
  const absCents = Math.abs(difCents);
  const valorAbsoluto = fromCents(absCents);

  const tipo = difCents === 0 ? 'CONFERIDO' : difCents > 0 ? 'SOBRA' : 'FALTA';
  let gravidade;
  if (absCents === 0) gravidade = 'EXATO';
  else if (absCents <= toCents(toleranciaAceitavel)) gravidade = 'DENTRO_TOLERANCIA';
  else if (absCents < toCents(limiteGrave)) gravidade = 'LEVE';
  else gravidade = 'GRAVE';

  // Mantém os códigos legados de `situacao` usados pela UI e relatórios anteriores
  const situacao = tipo === 'CONFERIDO' ? 'CONFERIDO_EXATO' : tipo === 'SOBRA' ? 'SOBRA_DE_CAIXA' : 'QUEBRA_DE_CAIXA';

  const rotuloTipo = { CONFERIDO: 'Caixa conferido', SOBRA: 'Sobra de caixa', FALTA: 'Falta (quebra) de caixa' }[tipo];
  const rotuloGravidade = {
    EXATO: 'valor exato',
    DENTRO_TOLERANCIA: 'dentro da tolerância',
    LEVE: 'divergência leve',
    GRAVE: 'divergência grave — justificativa obrigatória',
  }[gravidade];

  return {
    tipo,
    gravidade,
    situacao,
    exigeJustificativa: gravidade === 'GRAVE',
    valorAbsoluto,
    descricao: `${rotuloTipo} (${rotuloGravidade})`,
  };
}
