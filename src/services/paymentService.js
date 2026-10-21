import { getDb } from '../database/dbInstance';
import { syncOrEnqueue } from '../database/syncService';
import { debitarFiado, estornarFiado, validateLimiteFiado } from './clientService';

// ========================================================
// SERVIÇO DE PAGAMENTOS, TAXAS E LUCRO REAL (S01 A S04)
// Integrante: Francisco Yuri da Silva Mauriz
// ========================================================

export const FORMAS_PAGAMENTO_PADRAO = [
  { codigo: 'dinheiro', nome: 'Dinheiro', taxa_percentual: 0.0, taxa_fixa: 0.0 },
  { codigo: 'pix', nome: 'PIX', taxa_percentual: 0.99, taxa_fixa: 0.0 },
  { codigo: 'cartao_debito', nome: 'Cartão de Débito', taxa_percentual: 1.99, taxa_fixa: 0.0 },
  { codigo: 'cartao_credito', nome: 'Cartão de Crédito', taxa_percentual: 3.49, taxa_fixa: 0.30 },
  { codigo: 'fiado', nome: 'Fiado (Caderneta)', taxa_percentual: 0.0, taxa_fixa: 0.0 }
];

/**
 * Cria tabelas de configuração de formas de pagamento e pagamentos por venda
 */
export async function initPaymentTables(db) {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS FormaPagamentoConfig (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gerente_id INTEGER NOT NULL,
      codigo TEXT NOT NULL,
      nome TEXT NOT NULL,
      operadora TEXT NOT NULL DEFAULT 'Padrao',
      taxa_percentual REAL NOT NULL DEFAULT 0.0,
      taxa_fixa REAL NOT NULL DEFAULT 0.0,
      ativo INTEGER NOT NULL DEFAULT 1,
      UNIQUE(gerente_id, codigo, operadora)
    );

    CREATE TABLE IF NOT EXISTS PagamentoVenda (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gerente_id INTEGER NOT NULL,
      venda_id INTEGER NOT NULL,
      forma_pagamento TEXT NOT NULL,
      operadora TEXT DEFAULT 'Padrao',
      valor_bruto REAL NOT NULL,
      taxa_percentual REAL NOT NULL DEFAULT 0.0,
      taxa_fixa REAL NOT NULL DEFAULT 0.0,
      valor_taxa REAL NOT NULL DEFAULT 0.0,
      valor_liquido REAL NOT NULL,
      estornado INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (venda_id) REFERENCES Venda(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_pagamento_venda_id ON PagamentoVenda(venda_id);
  `);
}

/**
 * Popula formas de pagamento padrão caso o comércio não possua nenhuma
 */
export async function seedFormasPagamento(gerenteId, dbOverride = null) {
  const db = dbOverride || await getDb();
  const exist = await db.getAllAsync(
    'SELECT id FROM FormaPagamentoConfig WHERE gerente_id = ? LIMIT 1;',
    [gerenteId]
  );
  if (exist.length === 0) {
    for (const f of FORMAS_PAGAMENTO_PADRAO) {
      await db.runAsync(
        `INSERT OR IGNORE INTO FormaPagamentoConfig 
         (gerente_id, codigo, nome, operadora, taxa_percentual, taxa_fixa, ativo)
         VALUES (?, ?, ?, 'Padrao', ?, ?, 1);`,
        [gerenteId, f.codigo, f.nome, f.taxa_percentual, f.taxa_fixa]
      );
    }
  }
}

/**
 * Retorna as formas de pagamento ativas e suas taxas configuradas
 */
export async function fetchFormasPagamento(gerenteId, dbOverride = null) {
  const db = dbOverride || await getDb();
  await seedFormasPagamento(gerenteId, db);
  return await db.getAllAsync(
    'SELECT * FROM FormaPagamentoConfig WHERE gerente_id = ? AND ativo = 1 ORDER BY id ASC;',
    [gerenteId]
  );
}

/**
 * Salva ou atualiza a taxa de uma forma de pagamento por operadora
 */
export async function saveFormaPagamentoConfig(config, gerenteId, dbOverride = null) {
  const db = dbOverride || await getDb();
  const taxaPercentual = Math.max(0, parseFloat(config.taxa_percentual) || 0);
  const taxaFixa = Math.max(0, parseFloat(config.taxa_fixa) || 0);
  const operadora = (config.operadora || 'Padrao').trim();

  let id = config.id;
  if (id) {
    await db.runAsync(
      `UPDATE FormaPagamentoConfig
       SET operadora = ?, taxa_percentual = ?, taxa_fixa = ?, ativo = ?
       WHERE id = ? AND gerente_id = ?;`,
      [operadora, taxaPercentual, taxaFixa, config.ativo !== false ? 1 : 0, id, gerenteId]
    );
  } else {
    const res = await db.runAsync(
      `INSERT INTO FormaPagamentoConfig 
       (gerente_id, codigo, nome, operadora, taxa_percentual, taxa_fixa, ativo)
       VALUES (?, ?, ?, ?, ?, ?, 1);`,
      [gerenteId, config.codigo, config.nome, operadora, taxaPercentual, taxaFixa]
    );
    id = res.lastInsertRowId;
  }

  const saved = await db.getAllAsync('SELECT * FROM FormaPagamentoConfig WHERE id = ?;', [id]);
  return saved[0] || null;
}

/**
 * Calcula taxa e valor líquido com precisão de 2 casas decimais
 */
export function calcularTaxaPagamento(valorBruto, taxaPercentual = 0, taxaFixa = 0) {
  const bruto = parseFloat(valorBruto) || 0;
  const pct = parseFloat(taxaPercentual) || 0;
  const fix = parseFloat(taxaFixa) || 0;

  if (bruto <= 0) {
    return { valorBruto: 0, valorTaxa: 0, valorLiquido: 0 };
  }

  const taxaVariavel = bruto * (pct / 100);
  const taxaTotal = parseFloat((taxaVariavel + fix).toFixed(2));
  const valorLiquido = parseFloat(Math.max(0, bruto - taxaTotal).toFixed(2));

  return {
    valorBruto: parseFloat(bruto.toFixed(2)),
    taxaPercentual: pct,
    taxaFixa: fix,
    valorTaxa: taxaTotal,
    valorLiquido: valorLiquido
  };
}

/**
 * Valida o conjunto de pagamentos de uma venda (S03 - Processamento Misto)
 */
export async function validarPagamentosMistos(pagamentos, valorTotalVenda, clienteId, gerenteId, dbOverride = null) {
  if (!Array.isArray(pagamentos) || pagamentos.length === 0) {
    throw new Error('Nenhuma forma de pagamento foi informada.');
  }

  let totalPago = 0;
  const pagamentosValidados = [];

  const configs = await fetchFormasPagamento(gerenteId, dbOverride);
  const configMap = new Map();
  for (const c of configs) {
    configMap.set(`${c.codigo}_${c.operadora || 'Padrao'}`, c);
    if (!configMap.has(c.codigo)) {
      configMap.set(c.codigo, c);
    }
  }

  let totalFiado = 0;

  for (const pag of pagamentos) {
    const valorBruto = parseFloat(pag.valor || pag.valor_bruto);
    if (isNaN(valorBruto) || valorBruto <= 0) {
      throw new Error(`Valor de pagamento inválido para a modalidade "${pag.forma_pagamento || pag.codigo}".`);
    }

    const codigo = pag.forma_pagamento || pag.codigo;
    const operadora = pag.operadora || 'Padrao';
    const cfg = configMap.get(`${codigo}_${operadora}`) || configMap.get(codigo) || {
      taxa_percentual: 0,
      taxa_fixa: 0
    };

    const calc = calcularTaxaPagamento(valorBruto, cfg.taxa_percentual, cfg.taxa_fixa);

    if (codigo === 'fiado') {
      totalFiado += valorBruto;
    }

    pagamentosValidados.push({
      forma_pagamento: codigo,
      operadora: operadora,
      valor_bruto: calc.valorBruto,
      taxa_percentual: calc.taxaPercentual,
      taxa_fixa: calc.taxaFixa,
      valor_taxa: calc.valorTaxa,
      valor_liquido: calc.valorLiquido
    });

    totalPago += calc.valorBruto;
  }

  totalPago = parseFloat(totalPago.toFixed(2));
  const totalEsperado = parseFloat(Number(valorTotalVenda).toFixed(2));

  const diferenca = Math.abs(totalPago - totalEsperado);
  if (diferenca > 0.01) {
    throw new Error(
      `A soma dos pagamentos (R$ ${totalPago.toFixed(2)}) diverge do total da venda (R$ ${totalEsperado.toFixed(2)}). Diferença: R$ ${(totalPago - totalEsperado).toFixed(2)}.`
    );
  }

  // Se houver fiado, valida o cliente
  if (totalFiado > 0) {
    if (!clienteId) {
      throw new Error('Pagamentos via Fiado exigem a seleção de um cliente cadastrado.');
    }
    await validateLimiteFiado(clienteId, totalFiado, gerenteId, dbOverride);
  }

  const totalTaxas = parseFloat(pagamentosValidados.reduce((acc, p) => acc + p.valor_taxa, 0).toFixed(2));
  const totalLiquido = parseFloat((totalEsperado - totalTaxas).toFixed(2));

  return {
    pagamentos: pagamentosValidados,
    totalBruto: totalEsperado,
    totalTaxas,
    totalLiquido,
    totalFiado
  };
}

/**
 * Registra os pagamentos de uma venda dentro de transação e debita fiado se houver
 */
export async function registrarPagamentosVenda(vendaId, pagamentosValidados, clienteId, gerenteId, db) {
  for (const pag of pagamentosValidados) {
    await db.runAsync(
      `INSERT INTO PagamentoVenda 
       (gerente_id, venda_id, forma_pagamento, operadora, valor_bruto, taxa_percentual, taxa_fixa, valor_taxa, valor_liquido)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        gerenteId,
        vendaId,
        pag.forma_pagamento,
        pag.operadora,
        pag.valor_bruto,
        pag.taxa_percentual,
        pag.taxa_fixa,
        pag.valor_taxa,
        pag.valor_liquido
      ]
    );

    if (pag.forma_pagamento === 'fiado' && clienteId) {
      await debitarFiado(clienteId, pag.valor_bruto, gerenteId, db);
    }
  }
}

/**
 * Retorna os pagamentos associados a uma venda
 */
export async function fetchPagamentosVenda(vendaId, dbOverride = null) {
  const db = dbOverride || await getDb();
  return await db.getAllAsync(
    'SELECT * FROM PagamentoVenda WHERE venda_id = ? ORDER BY id ASC;',
    [vendaId]
  );
}

/**
 * Estorna os pagamentos de uma venda cancelada (Yuri Moreira / Yuri Mauriz S03)
 */
export async function estornarPagamentosVenda(vendaId, clienteId, gerenteId, db) {
  const pagamentos = await db.getAllAsync(
    'SELECT * FROM PagamentoVenda WHERE venda_id = ? AND estornado = 0;',
    [vendaId]
  );

  for (const pag of pagamentos) {
    await db.runAsync('UPDATE PagamentoVenda SET estornado = 1 WHERE id = ?;', [pag.id]);
    if (pag.forma_pagamento === 'fiado' && clienteId) {
      await estornarFiado(clienteId, pag.valor_bruto, gerenteId, db);
    }
  }
}

/**
 * Motor de Lucro Real e CMV (Yuri Mauriz S04)
 * Calcula a apuração de resultado após CMV e taxas para vendas ativas/concluídas,
 * considerando cancelamentos e estornos por devolução, agregando por canal de venda.
 */
export async function apurarLucroReal(gerenteId, options = {}, dbOverride = null) {
  const db = dbOverride || await getDb();
  const { dataInicio, dataFim, canalVenda } = options;

  let query = `
    SELECT 
      v.id,
      v.canal_venda,
      v.data_venda,
      v.valor_total,
      v.total_taxas,
      v.valor_liquido,
      v.valor_cmv,
      v.status
    FROM Venda v
    WHERE v.gerente_id = ? AND v.status != 'cancelada'
  `;
  const params = [gerenteId];

  if (dataInicio) {
    query += ' AND v.data_venda >= ?';
    params.push(dataInicio);
  }
  if (dataFim) {
    query += ' AND v.data_venda <= ?';
    params.push(dataFim);
  }
  if (canalVenda && canalVenda !== 'todos') {
    query += ' AND v.canal_venda = ?';
    params.push(canalVenda);
  }

  const vendas = await db.getAllAsync(query, params);

  // Busca devoluções para deduzir faturamento, CMV e taxas
  let devQuery = `
    SELECT 
      dv.venda_id,
      SUM(dv.valor_estornado) as total_estorno,
      SUM(dv.cmv_estornado) as cmv_estornado,
      SUM(dv.taxas_estornadas) as taxas_estornadas
    FROM DevolucaoVenda dv
    JOIN Venda v ON dv.venda_id = v.id
    WHERE dv.gerente_id = ? AND v.status != 'cancelada'
  `;
  const devParams = [gerenteId];
  if (dataInicio) {
    devQuery += ' AND dv.data_devolucao >= ?';
    devParams.push(dataInicio);
  }
  if (dataFim) {
    devQuery += ' AND dv.data_devolucao <= ?';
    devParams.push(dataFim);
  }
  devQuery += ' GROUP BY dv.venda_id;';

  const devolucoes = await db.getAllAsync(devQuery, devParams);
  const devMap = new Map();
  for (const d of devolucoes) {
    devMap.set(d.venda_id, d);
  }

  let faturamentoBruto = 0;
  let totalDevolucoes = 0;
  let faturamentoElegivel = 0;
  let cmvEfetivo = 0;
  let taxasOperacionais = 0;
  let valorLiquidoRecebido = 0;

  const porCanal = {};

  for (const v of vendas) {
    const dev = devMap.get(v.id) || { total_estorno: 0, cmv_estornado: 0, taxas_estornadas: 0 };
    
    const vFaturamento = parseFloat(v.valor_total) || 0;
    const vDevolucao = parseFloat(dev.total_estorno) || 0;
    const vElegivel = Math.max(0, vFaturamento - vDevolucao);

    const vCmvOriginal = parseFloat(v.valor_cmv) || 0;
    const vCmvEstornado = parseFloat(dev.cmv_estornado) || 0;
    const vCmvLiquido = Math.max(0, vCmvOriginal - vCmvEstornado);

    const vTaxasOriginal = parseFloat(v.total_taxas) || 0;
    const vTaxasEstornadas = parseFloat(dev.taxas_estornadas) || 0;
    const vTaxasLiquidas = Math.max(0, vTaxasOriginal - vTaxasEstornadas);

    const vLiquido = Math.max(0, vElegivel - vTaxasLiquidas);
    const vResultado = parseFloat((vElegivel - vCmvLiquido - vTaxasLiquidas).toFixed(2));

    faturamentoBruto += vFaturamento;
    totalDevolucoes += vDevolucao;
    faturamentoElegivel += vElegivel;
    cmvEfetivo += vCmvLiquido;
    taxasOperacionais += vTaxasLiquidas;
    valorLiquidoRecebido += vLiquido;

    const canal = v.canal_venda || 'balcao';
    if (!porCanal[canal]) {
      porCanal[canal] = {
        canal,
        qtdVendas: 0,
        faturamentoElegivel: 0,
        cmv: 0,
        taxas: 0,
        resultadoAposCmvTaxas: 0
      };
    }
    porCanal[canal].qtdVendas += 1;
    porCanal[canal].faturamentoElegivel = parseFloat((porCanal[canal].faturamentoElegivel + vElegivel).toFixed(2));
    porCanal[canal].faturamento = porCanal[canal].faturamentoElegivel;
    porCanal[canal].cmv = parseFloat((porCanal[canal].cmv + vCmvLiquido).toFixed(2));
    porCanal[canal].taxas = parseFloat((porCanal[canal].taxas + vTaxasLiquidas).toFixed(2));
    porCanal[canal].resultadoAposCmvTaxas = parseFloat((porCanal[canal].resultadoAposCmvTaxas + vResultado).toFixed(2));
    porCanal[canal].resultado = porCanal[canal].resultadoAposCmvTaxas;
  }

  faturamentoBruto = parseFloat(faturamentoBruto.toFixed(2));
  totalDevolucoes = parseFloat(totalDevolucoes.toFixed(2));
  faturamentoElegivel = parseFloat(faturamentoElegivel.toFixed(2));
  cmvEfetivo = parseFloat(cmvEfetivo.toFixed(2));
  taxasOperacionais = parseFloat(taxasOperacionais.toFixed(2));
  valorLiquidoRecebido = parseFloat(valorLiquidoRecebido.toFixed(2));

  // Fórmula mestre do edital S04:
  // Resultado após CMV e taxas = faturamento elegível − CMV − taxas operacionais
  const resultadoAposCmvTaxas = parseFloat((faturamentoElegivel - cmvEfetivo - taxasOperacionais).toFixed(2));

  // Margem operacional sobre faturamento elegível
  const margemPercentual = faturamentoElegivel > 0 
    ? parseFloat(((resultadoAposCmvTaxas / faturamentoElegivel) * 100).toFixed(2))
    : 0;

  return {
    tituloMetrica: 'Resultado Operacional após CMV e Taxas',
    avisoContabil: 'Esta métrica representa a margem bruta de contribuição após CMV e taxas de recebimento. Não representa o lucro líquido contábil final pois não inclui despesas administrativas/fixas.',
    totalVendasConsideradas: vendas.length,
    faturamentoBruto,
    totalDevolucoes,
    faturamentoElegivel,
    cmvEfetivo,
    cmvTotal: cmvEfetivo,
    taxasOperacionais,
    valorLiquidoRecebido,
    resultadoAposCmvTaxas,
    resultadoAposCmvETaxas: resultadoAposCmvTaxas,
    margemPercentual,
    margemContribuicaoPercent: margemPercentual,
    porCanal,
    canais: Object.values(porCanal)
  };
}
