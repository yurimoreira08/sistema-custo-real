import { getDb } from '../database/dbInstance';
import { syncOrEnqueue } from '../database/syncService';
import { debitarFiado, estornarFiado, validateLimiteFiado } from './clientService';
import { 
  round2, 
  toCents, 
  fromCents, 
  sumMoney, 
  subtractMoney, 
  calcularTaxaMonetaria, 
  validarIgualdadeMonetaria, 
  calcularProporcional 
} from '../utils/money';

// ========================================================
// SERVIÇO DE PAGAMENTOS, TAXAS, AUDITORIA CONTÁBIL E LUCRO REAL (S01 A S05)
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
 * Calcula taxa e valor líquido com precisão monetária estrita de 2 casas decimais (S05)
 */
export function calcularTaxaPagamento(valorBruto, taxaPercentual = 0, taxaFixa = 0) {
  return calcularTaxaMonetaria(valorBruto, taxaPercentual, taxaFixa);
}

/**
 * Valida o conjunto de pagamentos de uma venda (S03 / S05 - Processamento Misto e Auditoria Decimal)
 */
export async function validarPagamentosMistos(pagamentos, valorTotalVenda, clienteId, gerenteId, dbOverride = null) {
  if (!Array.isArray(pagamentos) || pagamentos.length === 0) {
    throw new Error('Nenhuma forma de pagamento foi informada.');
  }

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
    const valorBruto = round2(parseFloat(pag.valor ?? pag.valor_bruto));
    if (isNaN(valorBruto) || valorBruto <= 0) {
      throw new Error(`Valor de pagamento inválido para a modalidade "${pag.forma_pagamento || pag.codigo}".`);
    }

    const codigo = pag.forma_pagamento || pag.codigo;
    const operadora = pag.operadora || 'Padrao';
    const cfg = configMap.get(`${codigo}_${operadora}`) || configMap.get(codigo) || {
      taxa_percentual: 0,
      taxa_fixa: 0
    };

    const calc = calcularTaxaMonetaria(valorBruto, cfg.taxa_percentual, cfg.taxa_fixa);

    if (codigo === 'fiado') {
      totalFiado = sumMoney(totalFiado, valorBruto);
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
  }

  const totalEsperado = round2(valorTotalVenda);
  const checagem = validarIgualdadeMonetaria(totalEsperado, pagamentosValidados);

  if (!checagem.valido) {
    throw new Error(
      `A soma dos pagamentos (R$ ${checagem.recebido.toFixed(2)}) diverge do total da venda (R$ ${checagem.esperado.toFixed(2)}). Diferença: R$ ${checagem.diferenca.toFixed(2)}.`
    );
  }

  // Se houver fiado, valida o cliente
  if (totalFiado > 0) {
    if (!clienteId) {
      throw new Error('Pagamentos via Fiado exigem a seleção de um cliente cadastrado.');
    }
    await validateLimiteFiado(clienteId, totalFiado, gerenteId, dbOverride);
  }

  const totalTaxas = fromCents(pagamentosValidados.reduce((acc, p) => acc + toCents(p.valor_taxa), 0));
  const totalLiquido = subtractMoney(totalEsperado, totalTaxas);

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
 * Estorna os pagamentos de uma venda cancelada (Yuri Moreira / Yuri Mauriz S03 / S05)
 * Garante que vendas com devolução prévia não provoquem estorno financeiro duplicado.
 */
export async function estornarPagamentosVenda(vendaId, clienteId, gerenteId, db, valorMaximoFiado = null) {
  const pagamentos = await db.getAllAsync(
    'SELECT * FROM PagamentoVenda WHERE venda_id = ? AND estornado = 0;',
    [vendaId]
  );

  let fiadoRestante = valorMaximoFiado !== null ? Math.max(0, Number(valorMaximoFiado)) : Infinity;

  for (const pag of pagamentos) {
    await db.runAsync('UPDATE PagamentoVenda SET estornado = 1 WHERE id = ?;', [pag.id]);
    if (pag.forma_pagamento === 'fiado' && clienteId) {
      const valorParaEstornar = Math.min(pag.valor_bruto, fiadoRestante);
      if (valorParaEstornar > 0) {
        await estornarFiado(clienteId, valorParaEstornar, gerenteId, db);
        fiadoRestante -= valorParaEstornar;
      }
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
    query += ' AND LOWER(v.canal_venda) = LOWER(?)';
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

    const canal = (v.canal_venda || 'balcao').toLowerCase().trim();
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

/**
 * Auditoria Contábil e de Arredondamento (Francisco Yuri Mauriz - S05)
 * Executa uma verificação completa e determinística sobre vendas, pagamentos,
 * taxas, estornos e devoluções para certificar a conformidade matemática e contábil.
 */
export async function auditarConsistenciaContabil(gerenteId, dbOverride = null) {
  const db = dbOverride || await getDb();

  const vendas = await db.getAllAsync(`
    SELECT 
      v.*,
      c.nome AS cliente_nome,
      u.nome AS usuario_nome
    FROM Venda v
    LEFT JOIN Cliente c ON c.id = v.cliente_id
    LEFT JOIN Usuario u ON u.id = v.usuario_id
    WHERE v.gerente_id = ? 
    ORDER BY v.id DESC;
  `, [gerenteId]);

  let totalVendasAuditadas = vendas.length;
  let vendasConformes = 0;
  let vendasComDivergencia = 0;
  const divergencias = [];

  let faturamentoTotalAuditado = 0;
  let faturamentoCanceladoAuditado = 0;
  let totalTaxasAuditadas = 0;
  let totalCmvAuditado = 0;

  for (const v of vendas) {
    const vendaId = v.id;
    let vendaOk = true;

    const addDivergencia = (tipo, mensagem) => {
      vendaOk = false;
      divergencias.push({
        vendaId,
        tipo,
        mensagem,
        dataVenda: v.data_venda || v.created_at,
        canalVenda: v.canal_venda || 'balcao',
        clienteNome: v.cliente_nome || (v.cliente_id ? `Cliente #${v.cliente_id}` : 'Cliente Avulso'),
        usuarioNome: v.usuario_nome || 'Operador',
        valorTotal: v.valor_total,
        statusVenda: v.status || 'concluida'
      });
    };

    // Verifica itens da venda para obter subtotal real se valor_bruto não estiver gravado
    const itensVenda = await db.getAllAsync(
      'SELECT subtotal FROM ItensVenda WHERE venda_id = ?;',
      [vendaId]
    );
    const somaItensCents = itensVenda.reduce((acc, it) => acc + toCents(it.subtotal), 0);

    const descontoVendaCents = toCents(v.desconto || 0);
    const valorTotalVendaCents = toCents(v.valor_total);

    // Determina o valor bruto real (respeitando vendas legadas onde valor_bruto era 0 ou nulo)
    let valorBrutoVendaCents;
    if (v.valor_bruto !== null && v.valor_bruto !== undefined && Number(v.valor_bruto) > 0) {
      valorBrutoVendaCents = toCents(v.valor_bruto);
    } else if (somaItensCents > 0) {
      valorBrutoVendaCents = somaItensCents;
    } else {
      valorBrutoVendaCents = valorTotalVendaCents + descontoVendaCents;
    }

    // 1. Validação de fórmula: valor_total == valor_bruto - desconto
    // Só acusa divergência se houver desconto ou se o bruto for informado e diferente do total
    if (descontoVendaCents > 0 || (valorBrutoVendaCents > 0 && valorBrutoVendaCents !== valorTotalVendaCents)) {
      if (valorBrutoVendaCents - descontoVendaCents !== valorTotalVendaCents) {
        addDivergencia(
          'DESCONTO_INCOERENTE',
          `Venda #${vendaId}: valor_total (R$ ${fromCents(valorTotalVendaCents)}) diverge de bruto (R$ ${fromCents(valorBrutoVendaCents)}) - desconto (R$ ${fromCents(descontoVendaCents)}).`
        );
      }
    }

    // 2. Validação da soma dos pagamentos
    const pagamentos = await db.getAllAsync(
      'SELECT * FROM PagamentoVenda WHERE venda_id = ?;',
      [vendaId]
    );

    const somaPagamentosCents = pagamentos.reduce((acc, p) => acc + toCents(p.valor_bruto ?? p.valor_pago), 0);
    if (somaPagamentosCents !== valorTotalVendaCents) {
      addDivergencia(
        'DIVERGENCIA_PAGAMENTO_TOTAL',
        `Venda #${vendaId}: soma dos pagamentos (R$ ${fromCents(somaPagamentosCents)}) diverge do total da venda (R$ ${fromCents(valorTotalVendaCents)}).`
      );
    }

    // 3. Validação de taxas e líquidos de cada pagamento
    for (const p of pagamentos) {
      const pBruto = toCents(p.valor_bruto ?? p.valor_pago);
      const pTaxa = toCents(p.valor_taxa);
      const pLiq = toCents(p.valor_liquido);
      if (pTaxa + pLiq !== pBruto) {
        addDivergencia(
          'TAXA_LIQUIDO_INCONSISTENTE',
          `Pagamento #${p.id} da Venda #${vendaId}: valor_taxa (R$ ${fromCents(pTaxa)}) + valor_liquido (R$ ${fromCents(pLiq)}) != valor_bruto (R$ ${fromCents(pBruto)}).`
        );
      }
    }

    // 4. Validação de cancelamento e estornos
    if (v.status === 'cancelada') {
      faturamentoCanceladoAuditado = sumMoney(faturamentoCanceladoAuditado, v.valor_total);

      // Pagamentos devem estar todos com estornado = 1
      const naoEstornados = pagamentos.filter(p => p.estornado !== 1 && p.status !== 'estornado');
      if (naoEstornados.length > 0) {
        addDivergencia(
          'PAGAMENTO_CANCELADO_NAO_ESTORNADO',
          `Venda cancelada #${vendaId} possui pagamentos ativos não estornados.`
        );
      }

      // Registro de CancelamentoVenda obrigatório
      const canc = await db.getAllAsync(
        'SELECT * FROM CancelamentoVenda WHERE venda_id = ?;',
        [vendaId]
      );
      if (canc.length === 0) {
        addDivergencia(
          'CANCELAMENTO_SEM_AUDITORIA',
          `Venda #${vendaId} está cancelada mas não possui registro correspondente na tabela CancelamentoVenda.`
        );
      }
    } else {
      // Venda válida/ativa
      faturamentoTotalAuditado = sumMoney(faturamentoTotalAuditado, v.valor_total);
      totalTaxasAuditadas = sumMoney(totalTaxasAuditadas, v.total_taxas || 0);
      totalCmvAuditado = sumMoney(totalCmvAuditado, v.valor_cmv || 0);
    }

    // 5. Validação de devoluções parciais
    const devolucoes = await db.getAllAsync(
      'SELECT * FROM DevolucaoVenda WHERE venda_id = ?;',
      [vendaId]
    );
    if (devolucoes.length > 0) {
      let totalEstornadoCents = 0;
      for (const d of devolucoes) {
        totalEstornadoCents += toCents(d.valor_estornado);
      }
      if (totalEstornadoCents > valorTotalVendaCents) {
        addDivergencia(
          'ESTORNO_EXCEDE_TOTAL',
          `Venda #${vendaId}: total devolvido (R$ ${fromCents(totalEstornadoCents)}) excede o valor da venda (R$ ${fromCents(valorTotalVendaCents)}).`
        );
      }
    }

    if (vendaOk) {
      vendasConformes++;
    } else {
      vendasComDivergencia++;
    }
  }

  return {
    statusGeral: divergencias.length === 0 ? 'CONFORME' : 'DIVERGENCIA_ENCONTRADA',
    totalVendasAuditadas,
    vendasConformes,
    vendasComDivergencia,
    divergencias,
    faturamentoTotalAuditado,
    faturamentoCanceladoAuditado,
    totalTaxasAuditadas,
    totalCmvAuditado
  };
}
