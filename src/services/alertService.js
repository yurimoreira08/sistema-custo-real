import { getDb } from '../database/dbInstance';
import { round2, multiplyMoney } from '../utils/money';
import { fetchTriagemValidadeLotes } from './stockService';

// ========================================================
// SERVIÇO DE PAINEL DE ALERTAS & NOTIFICAÇÕES (S08)
// Consolida alertas proativos para o lojista agir ANTES do prejuízo:
//  - Liquidação comercial antecipada de lotes próximos do vencimento (com preço sugerido)
//  - Lotes já vencidos (retirar da venda e registrar perda)
//  - Estoque abaixo do mínimo
//  - Clientes de fiado com teto atingido ou bloqueados com dívida em aberto
// ========================================================

/** Severidades em ordem de prioridade (a primeira é a mais urgente). */
export const SEVERIDADES = ['critica', 'alta', 'media', 'info'];

/**
 * Desconto sugerido para liquidação por faixa de risco de validade.
 * Quanto mais perto do vencimento, maior o desconto para girar o lote a tempo.
 */
export const DESCONTO_LIQUIDACAO = Object.freeze({
  RISCO_CRITICO: 30, // vence em até 7 dias
  RISCO_MEDIO: 20,   // vence entre 8 e 15 dias
  ALERTA: 10,        // vence entre 16 e 30 dias
});

/**
 * Sugere o preço de liquidação de um lote. O preço nunca fica abaixo do custo unitário:
 * se o desconto da faixa invadir o custo, o preço é travado no custo (desconto efetivo menor).
 * @param {{ precoVenda: number, custoUnitario: number, quantidade: number, faixaCodigo: string }} lote
 * @returns {{ descontoSugerido: number, descontoEfetivo: number, precoSugerido: number,
 *            travadoNoCusto: boolean, receitaEstimada: number, margemUnitaria: number } | null}
 *          null quando a faixa não pede liquidação (vencido ou seguro)
 */
export function sugerirPrecoLiquidacao({ precoVenda, custoUnitario, quantidade, faixaCodigo }) {
  const desconto = DESCONTO_LIQUIDACAO[faixaCodigo];
  if (!desconto) return null;

  const venda = round2(precoVenda);
  const custo = round2(custoUnitario);
  let preco = round2(venda * (1 - desconto / 100));
  const travadoNoCusto = preco < custo;
  if (travadoNoCusto) preco = custo;

  const descontoEfetivo = venda > 0 ? round2(((venda - preco) / venda) * 100) : 0;
  return {
    descontoSugerido: desconto,
    descontoEfetivo,
    precoSugerido: preco,
    travadoNoCusto,
    receitaEstimada: multiplyMoney(preco, quantidade),
    margemUnitaria: round2(preco - custo),
  };
}

const SEVERIDADE_POR_FAIXA = { VENCIDO: 'critica', RISCO_CRITICO: 'critica', RISCO_MEDIO: 'alta', ALERTA: 'media' };

/**
 * Monta o painel de alertas do estabelecimento.
 * @param {number} gerenteId
 * @param {{ dataReferencia?: string }} [opcoes] - data AAAA-MM-DD (padrão: hoje)
 * @returns {Promise<{ geradoEm: string, alertas: Array, contadores: Object, badgeCount: number, liquidacao: Object }>}
 */
export async function fetchPainelAlertas(gerenteId, { dataReferencia = null } = {}, dbOverride = null) {
  const db = dbOverride || await getDb();
  const alertas = [];

  // 1. Validade: vencidos e lotes candidatos a liquidação antecipada
  const triagem = await fetchTriagemValidadeLotes(gerenteId, dataReferencia, db);
  const lotesRisco = [
    ...triagem.faixas.vencidos.lotes,
    ...triagem.faixas.critico.lotes,
    ...triagem.faixas.medio.lotes,
    ...triagem.faixas.alerta.lotes,
  ];

  let receitaPotencial = 0;
  let lotesParaLiquidar = 0;
  for (const lote of lotesRisco) {
    const nome = lote.produto_nome;
    const qtd = lote.quantidade_saldo;
    const ident = lote.numero_lote ? ` (lote ${lote.numero_lote})` : '';

    if (lote.faixaCodigo === 'VENCIDO') {
      alertas.push({
        id: `lote-vencido-${lote.id}`,
        categoria: 'validade',
        tipo: 'LOTE_VENCIDO',
        severidade: 'critica',
        titulo: `${nome} vencido`,
        mensagem: `${qtd} un.${ident} venceram há ${Math.abs(lote.diasParaVencer)} dia(s). Retire da gôndola e registre a perda (R$ ${lote.capitalParado.toFixed(2)} em custo).`,
        acao: 'REGISTRAR_PERDA',
        referencia: { loteId: lote.id, produtoId: lote.produto_id },
        valor: lote.capitalParado,
      });
      continue;
    }

    const sugestao = sugerirPrecoLiquidacao({
      precoVenda: lote.produto_preco_venda,
      custoUnitario: lote.custo_unitario,
      quantidade: qtd,
      faixaCodigo: lote.faixaCodigo,
    });
    lotesParaLiquidar += 1;
    receitaPotencial = round2(receitaPotencial + (sugestao?.receitaEstimada || 0));

    const prazo = lote.diasParaVencer === 0 ? 'vence hoje' : `vence em ${lote.diasParaVencer} dia(s)`;
    alertas.push({
      id: `lote-liquidar-${lote.id}`,
      categoria: 'validade',
      tipo: 'LIQUIDACAO_ANTECIPADA',
      severidade: SEVERIDADE_POR_FAIXA[lote.faixaCodigo],
      titulo: `Liquidar ${nome}`,
      mensagem:
        `${qtd} un.${ident} ${prazo}. Sugestão: ${sugestao.descontoEfetivo}% OFF → R$ ${sugestao.precoSugerido.toFixed(2)}` +
        (sugestao.travadoNoCusto ? ' (travado no custo)' : '') +
        ` — recupera ~R$ ${sugestao.receitaEstimada.toFixed(2)}.`,
      acao: 'LIQUIDAR',
      referencia: { loteId: lote.id, produtoId: lote.produto_id },
      valor: lote.capitalParado,
      sugestao,
    });
  }

  // 2. Estoque abaixo do mínimo configurado
  const estoqueBaixo = await db.getAllAsync(
    `SELECT id, nome, estoque, estoque_minimo FROM Produto
     WHERE gerente_id = ? AND estoque_minimo > 0 AND estoque <= estoque_minimo
     ORDER BY (estoque * 1.0 / estoque_minimo) ASC, nome ASC;`,
    [gerenteId]
  );
  for (const p of estoqueBaixo) {
    const zerado = Number(p.estoque) <= 0;
    alertas.push({
      id: `estoque-${p.id}`,
      categoria: 'estoque',
      tipo: zerado ? 'ESTOQUE_ZERADO' : 'ESTOQUE_BAIXO',
      severidade: zerado ? 'alta' : 'media',
      titulo: zerado ? `${p.nome} sem estoque` : `${p.nome} com estoque baixo`,
      mensagem: `Estoque atual ${p.estoque} (mínimo ${p.estoque_minimo}). Programe a reposição.`,
      acao: 'REPOR_ESTOQUE',
      referencia: { produtoId: p.id },
    });
  }

  // 3. Fiado: clientes com teto atingido ou bloqueados que ainda devem
  let devedores = [];
  try {
    devedores = await db.getAllAsync(
      `SELECT id, nome, saldo_devedor, limite_fiado, bloqueado_inadimplente FROM Cliente
       WHERE gerente_id = ? AND ativo = 1 AND saldo_devedor > 0
         AND (bloqueado_inadimplente = 1 OR (limite_fiado > 0 AND saldo_devedor >= limite_fiado))
       ORDER BY saldo_devedor DESC;`,
      [gerenteId]
    );
  } catch (e) {} // tabela Cliente ainda não criada
  for (const c of devedores) {
    alertas.push({
      id: `fiado-${c.id}`,
      categoria: 'fiado',
      tipo: c.bloqueado_inadimplente === 1 ? 'CLIENTE_BLOQUEADO_COM_DIVIDA' : 'TETO_FIADO_ATINGIDO',
      severidade: 'media',
      titulo: `Cobrar ${c.nome}`,
      mensagem: `Dívida de R$ ${round2(c.saldo_devedor).toFixed(2)}${c.bloqueado_inadimplente === 1 ? ' com crédito bloqueado' : ` — teto de R$ ${round2(c.limite_fiado).toFixed(2)} atingido`}. Envie a cobrança pelo WhatsApp.`,
      acao: 'COBRAR_WHATSAPP',
      referencia: { clienteId: c.id },
      valor: round2(c.saldo_devedor),
    });
  }

  // Ordena por severidade e, dentro dela, pelo valor em risco
  alertas.sort((a, b) =>
    SEVERIDADES.indexOf(a.severidade) - SEVERIDADES.indexOf(b.severidade) || (b.valor || 0) - (a.valor || 0)
  );

  const contadores = { critica: 0, alta: 0, media: 0, info: 0, total: alertas.length };
  for (const a of alertas) contadores[a.severidade] += 1;

  return {
    geradoEm: new Date().toISOString(),
    alertas,
    contadores,
    // O badge destaca apenas o que exige ação imediata (crítico + alto)
    badgeCount: contadores.critica + contadores.alta,
    liquidacao: {
      lotesParaLiquidar,
      lotesVencidos: triagem.faixas.vencidos.quantidadeLotes,
      capitalEmRisco: triagem.capitalTotalEmRisco,
      receitaPotencial,
    },
  };
}
