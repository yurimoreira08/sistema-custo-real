import { getDb } from '../database/dbInstance';
import { syncOrEnqueue } from '../database/syncService';
import { 
  round2, 
  round3, 
  multiplyMoney, 
  sumMoney, 
  toCents, 
  fromCents 
} from '../utils/money';

// ========================================================
// SERVIÇO DE ESTOQUE, FORNECEDORES, KARDEX E PERDAS (S01 A S05)
// Integrante: José da Luz Coelho Neto
// ========================================================

/**
 * Inicializa tabelas do módulo de estoque, fornecedores, entradas, kardex e perdas
 */
export async function initStockTables(db) {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS Fornecedor (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gerente_id INTEGER NOT NULL,
      nome TEXT NOT NULL,
      cnpj_cpf TEXT,
      telefone TEXT,
      email TEXT,
      cidade TEXT,
      ativo INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS EntradaMercadoria (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gerente_id INTEGER NOT NULL,
      fornecedor_id INTEGER NOT NULL,
      numero_nota TEXT,
      serie_nota TEXT,
      chave_acesso TEXT,
      data_recebimento TEXT NOT NULL DEFAULT (datetime('now')),
      valor_total_nota REAL NOT NULL DEFAULT 0.0,
      observacoes TEXT,
      FOREIGN KEY (fornecedor_id) REFERENCES Fornecedor(id)
    );

    CREATE TABLE IF NOT EXISTS ItensEntrada (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gerente_id INTEGER NOT NULL,
      entrada_id INTEGER NOT NULL,
      produto_id INTEGER NOT NULL,
      quantidade REAL NOT NULL,
      custo_unitario REAL NOT NULL,
      custo_total REAL NOT NULL,
      lote TEXT,
      data_validade TEXT,
      pmp_anterior REAL NOT NULL,
      pmp_resultante REAL NOT NULL,
      estoque_anterior REAL NOT NULL,
      estoque_resultante REAL NOT NULL,
      FOREIGN KEY (entrada_id) REFERENCES EntradaMercadoria(id) ON DELETE CASCADE,
      FOREIGN KEY (produto_id) REFERENCES Produto(id)
    );

    CREATE TABLE IF NOT EXISTS MovimentacaoEstoque (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gerente_id INTEGER NOT NULL,
      produto_id INTEGER NOT NULL,
      tipo_movimentacao TEXT NOT NULL,
      quantidade REAL NOT NULL,
      saldo_anterior REAL NOT NULL,
      saldo_resultante REAL NOT NULL,
      custo_unitario REAL NOT NULL,
      valor_total REAL NOT NULL,
      origem_tipo TEXT,
      origem_id INTEGER,
      justificativa TEXT,
      responsavel_id INTEGER,
      data_movimentacao TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (produto_id) REFERENCES Produto(id)
    );

    CREATE TABLE IF NOT EXISTS PerdaEstoque (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gerente_id INTEGER NOT NULL,
      produto_id INTEGER NOT NULL,
      usuario_id INTEGER NOT NULL,
      tipo_perda TEXT NOT NULL,
      quantidade REAL NOT NULL,
      custo_unitario REAL NOT NULL,
      impacto_financeiro REAL NOT NULL,
      justificativa TEXT NOT NULL,
      data_perda TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (produto_id) REFERENCES Produto(id),
      FOREIGN KEY (usuario_id) REFERENCES Usuario(id)
    );

    CREATE INDEX IF NOT EXISTS idx_mov_produto_data ON MovimentacaoEstoque(produto_id, data_movimentacao DESC);
    CREATE INDEX IF NOT EXISTS idx_mov_origem ON MovimentacaoEstoque(origem_tipo, origem_id);
    CREATE INDEX IF NOT EXISTS idx_perda_produto ON PerdaEstoque(produto_id);
  `);
}

// --------------------------------------------------------
// 1. FORNECEDORES (Zé Neto S02)
// --------------------------------------------------------

export async function saveFornecedor(fornecedor, gerenteId, dbOverride = null) {
  const db = dbOverride || await getDb();
  const nome = (fornecedor.nome || '').trim();
  if (!nome) throw new Error('Nome do fornecedor é obrigatório.');

  let id = fornecedor.id;
  if (id) {
    await db.runAsync(
      `UPDATE Fornecedor
       SET nome = ?, cnpj_cpf = ?, telefone = ?, email = ?, cidade = ?, ativo = ?
       WHERE id = ? AND gerente_id = ?;`,
      [nome, fornecedor.cnpj_cpf || null, fornecedor.telefone || null, fornecedor.email || null, fornecedor.cidade || null, fornecedor.ativo !== false ? 1 : 0, id, gerenteId]
    );
  } else {
    const res = await db.runAsync(
      `INSERT INTO Fornecedor (gerente_id, nome, cnpj_cpf, telefone, email, cidade, ativo)
       VALUES (?, ?, ?, ?, ?, ?, 1);`,
      [gerenteId, nome, fornecedor.cnpj_cpf || null, fornecedor.telefone || null, fornecedor.email || null, fornecedor.cidade || null]
    );
    id = res.lastInsertRowId;
  }

  const saved = await getFornecedorById(id, gerenteId, db);
  await syncOrEnqueue('Fornecedor', 'upsert', saved);
  return saved;
}

export async function fetchFornecedores(gerenteId, dbOverride = null) {
  const db = dbOverride || await getDb();
  return await db.getAllAsync(
    'SELECT * FROM Fornecedor WHERE gerente_id = ? AND ativo = 1 ORDER BY nome ASC;',
    [gerenteId]
  );
}

export async function getFornecedorById(id, gerenteId, dbOverride = null) {
  const db = dbOverride || await getDb();
  const rows = await db.getAllAsync(
    'SELECT * FROM Fornecedor WHERE id = ? AND gerente_id = ? LIMIT 1;',
    [id, gerenteId]
  );
  return rows[0] || null;
}

// --------------------------------------------------------
// 2. KARDEX / MOVIMENTAÇÃO DE ESTOQUE (Zé Neto S02)
// --------------------------------------------------------

/**
 * Registra um lançamento no Kardex com integridade e rastreabilidade total
 */
export async function registrarMovimentacaoKardex(params, db) {
  const {
    gerenteId,
    produtoId,
    tipoMovimentacao,
    quantidade,
    saldoAnterior,
    saldoResultante,
    custoUnitario,
    origemTipo = null,
    origemId = null,
    justificativa = null,
    responsavelId = null,
    dataMovimentacao = null
  } = params;

  const dataIso = dataMovimentacao || new Date().toISOString();
  const valorTotal = parseFloat((Math.abs(quantidade) * custoUnitario).toFixed(2));

  const result = await db.runAsync(
    `INSERT INTO MovimentacaoEstoque 
     (gerente_id, produto_id, tipo_movimentacao, quantidade, saldo_anterior, saldo_resultante, custo_unitario, valor_total, origem_tipo, origem_id, justificativa, responsavel_id, data_movimentacao)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      gerenteId,
      produtoId,
      tipoMovimentacao,
      quantidade,
      saldoAnterior,
      saldoResultante,
      custoUnitario,
      valorTotal,
      origemTipo,
      origemId,
      justificativa,
      responsavelId,
      dataIso
    ]
  );

  return result.lastInsertRowId;
}

/**
 * Consulta o histórico Kardex de um produto ou de todos os produtos
 */
export async function fetchKardex(produtoId, gerenteId, limit = 50, dbOverride = null) {
  const db = dbOverride || await getDb();
  let query = `
    SELECT 
      m.*,
      p.nome as produto_nome,
      p.codigo_barras
    FROM MovimentacaoEstoque m
    JOIN Produto p ON m.produto_id = p.id
    WHERE m.gerente_id = ?
  `;
  const params = [gerenteId];

  if (produtoId) {
    query += ' AND m.produto_id = ?';
    params.push(produtoId);
  }

  query += ' ORDER BY datetime(m.data_movimentacao) DESC, m.id DESC LIMIT ?;';
  params.push(limit);

  return await db.getAllAsync(query, params);
}

// --------------------------------------------------------
// 3. RECEBIMENTO DE MERCADORIAS E PREÇO MÉDIO PONDERADO (PMP) (Zé Neto S03)
// --------------------------------------------------------

/**
 * Calcula o novo Preço Médio Ponderado (PMP):
 * Novo PMP = (estoque_anterior * custo_anterior + qtd_entrada * custo_entrada) / (estoque_anterior + qtd_entrada)
 */
export function calcularNovoPMP(estoqueAnterior, custoAnterior, qtdEntrada, custoEntrada) {
  const qAnt = Math.max(0, parseFloat(estoqueAnterior) || 0);
  const cAnt = Math.max(0, parseFloat(custoAnterior) || 0);
  const qEnt = parseFloat(qtdEntrada) || 0;
  const cEnt = parseFloat(custoEntrada) || 0;

  if (qEnt <= 0 || cEnt < 0) {
    throw new Error('Quantidade da entrada deve ser maior que zero e o custo unitário não pode ser negativo.');
  }

  // Caso estoque anterior seja zero ou inexistente
  if (qAnt <= 0) {
    return parseFloat(cEnt.toFixed(2));
  }

  const valorEstoqueAnterior = qAnt * cAnt;
  const valorEntrada = qEnt * cEnt;
  const quantidadeTotal = qAnt + qEnt;

  const novoPmp = (valorEstoqueAnterior + valorEntrada) / quantidadeTotal;
  return parseFloat(novoPmp.toFixed(2));
}

/**
 * Registra o recebimento de mercadorias com Fornecedor, nota, lotes,
 * atualiza o estoque e recalcula atômica e consistentemente o PMP
 */
export async function registrarEntradaMercadorias(dadosEntrada, gerenteId, dbOverride = null) {
  const db = dbOverride || await getDb();
  const {
    fornecedorId,
    numeroNota,
    serieNota,
    chaveAcesso,
    dataRecebimento,
    observacoes,
    itens, // [{ produtoId, quantidade, custoUnitario, lote, dataValidade }]
    responsavelId
  } = dadosEntrada;

  if (!fornecedorId) {
    throw new Error('Fornecedor é obrigatório para entrada de mercadorias.');
  }
  if (!Array.isArray(itens) || itens.length === 0) {
    throw new Error('A entrada deve conter ao menos um item de produto.');
  }

  const fornecedor = await getFornecedorById(fornecedorId, gerenteId, db);
  if (!fornecedor) {
    throw new Error('Fornecedor informado não encontrado.');
  }

  const now = dataRecebimento || new Date().toISOString();
  let entradaId = null;
  const itensProcessados = [];

  const runInsideTx = async () => {
    let valorTotalNota = 0;
    for (const item of itens) {
      const q = parseFloat(item.quantidade);
      const c = parseFloat(item.custoUnitario);
      if (isNaN(q) || q <= 0) throw new Error(`Quantidade inválida para o produto ID ${item.produtoId}.`);
      if (isNaN(c) || c < 0) throw new Error(`Custo inválido para o produto ID ${item.produtoId}.`);
      valorTotalNota += (q * c);
    }
    valorTotalNota = parseFloat(valorTotalNota.toFixed(2));

    const resEntrada = await db.runAsync(
      `INSERT INTO EntradaMercadoria 
       (gerente_id, fornecedor_id, numero_nota, serie_nota, chave_acesso, data_recebimento, valor_total_nota, observacoes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      [gerenteId, fornecedorId, numeroNota || null, serieNota || null, chaveAcesso || null, now, valorTotalNota, observacoes || null]
    );
    entradaId = resEntrada.lastInsertRowId;

    for (const item of itens) {
      const prodRows = await db.getAllAsync(
        'SELECT * FROM Produto WHERE id = ? AND gerente_id = ?;',
        [item.produtoId, gerenteId]
      );
      if (prodRows.length === 0) {
        throw new Error(`Produto ID ${item.produtoId} não encontrado no estoque.`);
      }
      const prod = prodRows[0];

      const qtdEntrada = parseFloat(item.quantidade);
      const custoEntrada = parseFloat(item.custoUnitario);
      const estoqueAnterior = parseFloat(prod.estoque) || 0;
      const custoAnterior = parseFloat(prod.preco_custo) || 0;

      const novoPmp = calcularNovoPMP(estoqueAnterior, custoAnterior, qtdEntrada, custoEntrada);
      const novoEstoque = parseFloat((estoqueAnterior + qtdEntrada).toFixed(3));
      const custoTotalItem = parseFloat((qtdEntrada * custoEntrada).toFixed(2));

      // Atualiza o produto com novo PMP e estoque
      await db.runAsync(
        `UPDATE Produto 
         SET preco_custo = ?, estoque = ?, updated_at = datetime('now')
         WHERE id = ? AND gerente_id = ?;`,
        [novoPmp, novoEstoque, item.produtoId, gerenteId]
      );

      // Insere item da entrada
      const resItem = await db.runAsync(
        `INSERT INTO ItensEntrada 
         (gerente_id, entrada_id, produto_id, quantidade, custo_unitario, custo_total, lote, data_validade, pmp_anterior, pmp_resultante, estoque_anterior, estoque_resultante)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          gerenteId,
          entradaId,
          item.produtoId,
          qtdEntrada,
          custoEntrada,
          custoTotalItem,
          item.lote || null,
          item.dataValidade || null,
          custoAnterior,
          novoPmp,
          estoqueAnterior,
          novoEstoque
        ]
      );

      // Registra movimentação no Kardex
      await registrarMovimentacaoKardex({
        gerenteId,
        produtoId: item.produtoId,
        tipoMovimentacao: 'ENTRADA',
        quantidade: qtdEntrada,
        saldoAnterior: estoqueAnterior,
        saldoResultante: novoEstoque,
        custoUnitario: custoEntrada,
        origemTipo: 'entrada',
        origemId: entradaId,
        justificativa: `Entrada NF ${numeroNota || 'S/N'} - Fornecedor: ${fornecedor.nome}`,
        responsavelId,
        dataMovimentacao: now
      }, db);

      itensProcessados.push({
        itemId: resItem.lastInsertRowId,
        produtoId: item.produtoId,
        nome: prod.nome,
        qtdEntrada,
        custoEntrada,
        pmpAnterior: custoAnterior,
        novoPmp,
        estoqueAnterior,
        novoEstoque
      });
    }
  };

  if (typeof db.withTransactionAsync === 'function') {
    await db.withTransactionAsync(runInsideTx);
  } else {
    await db.runAsync('BEGIN TRANSACTION;');
    try {
      await runInsideTx();
      await db.runAsync('COMMIT;');
    } catch (e) {
      await db.runAsync('ROLLBACK;');
      throw e;
    }
  }

  return {
    entradaId,
    fornecedorId,
    fornecedorNome: fornecedor.nome,
    numeroNota,
    dataRecebimento: now,
    itens: itensProcessados
  };
}

// --------------------------------------------------------
// 4. GESTÃO DE PERDAS E AVARIAS (Zé Neto S04)
// --------------------------------------------------------

export const TIPOS_PERDA_VALIDOS = ['quebra', 'avaria', 'extravio', 'furto', 'vencimento'];

/**
 * Registra uma perda ou avaria de estoque, validando saldo disponível,
 * impedindo saldo negativo, gerando baixa no Kardex e apurando impacto financeiro
 */
export async function registrarPerdaEstoque(dadosPerda, gerenteId, dbOverride = null) {
  const db = dbOverride || await getDb();
  const {
    produtoId,
    usuarioId,
    tipoPerda,
    quantidade,
    justificativa
  } = dadosPerda;

  if (!produtoId) throw new Error('Produto é obrigatório para registrar perda.');
  if (!usuarioId) throw new Error('Usuário responsável é obrigatório.');
  
  const tipo = (tipoPerda || '').toLowerCase().trim();
  if (!TIPOS_PERDA_VALIDOS.includes(tipo)) {
    throw new Error(`Tipo de perda inválido. Deve ser um dos seguintes: ${TIPOS_PERDA_VALIDOS.join(', ')}.`);
  }

  const qtdPerda = round3(parseFloat(quantidade));
  if (isNaN(qtdPerda) || qtdPerda <= 0) {
    throw new Error('A quantidade de perda deve ser maior que zero.');
  }

  const just = (justificativa || '').trim();
  if (!just || just.length < 5) {
    throw new Error('A justificativa da perda é obrigatória e deve ter ao menos 5 caracteres.');
  }

  let perdaId = null;
  let impactoFinanceiro = 0;
  let saldoRestante = 0;

  const runInsideTx = async () => {
    const prodRows = await db.getAllAsync(
      'SELECT * FROM Produto WHERE id = ? AND gerente_id = ?;',
      [produtoId, gerenteId]
    );
    if (prodRows.length === 0) {
      throw new Error('Produto não encontrado.');
    }
    const prod = prodRows[0];
    const saldoAtual = round3(parseFloat(prod.estoque) || 0);
    const custoUnitario = round2(parseFloat(prod.preco_custo) || 0);

    if (qtdPerda > saldoAtual) {
      throw new Error(
        `Quantidade de perda (${qtdPerda}) superior ao saldo em estoque (${saldoAtual}) para o produto "${prod.nome}". Saldo negativo não é permitido.`
      );
    }

    saldoRestante = round3(saldoAtual - qtdPerda);
    impactoFinanceiro = multiplyMoney(custoUnitario, qtdPerda);
    const now = new Date().toISOString();

    // 1. Atualiza estoque do produto
    await db.runAsync(
      `UPDATE Produto SET estoque = ?, updated_at = datetime('now') WHERE id = ? AND gerente_id = ?;`,
      [saldoRestante, produtoId, gerenteId]
    );

    // 2. Insere na tabela de auditoria PerdaEstoque
    const resPerda = await db.runAsync(
      `INSERT INTO PerdaEstoque 
       (gerente_id, produto_id, usuario_id, tipo_perda, quantidade, custo_unitario, impacto_financeiro, justificativa, data_perda)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        gerenteId,
        produtoId,
        usuarioId,
        tipo,
        qtdPerda,
        custoUnitario,
        impactoFinanceiro,
        just,
        now
      ]
    );
    perdaId = resPerda.lastInsertRowId;

    // 3. Insere movimentação no Kardex
    const tipoKardex = `PERDA_${tipo.toUpperCase()}`;
    await registrarMovimentacaoKardex({
      gerenteId,
      produtoId,
      tipoMovimentacao: tipoKardex,
      quantidade: -qtdPerda,
      saldoAnterior: saldoAtual,
      saldoResultante: saldoRestante,
      custoUnitario,
      origemTipo: 'perda',
      origemId: perdaId,
      justificativa: `Perda [${tipo.toUpperCase()}]: ${just}`,
      responsavelId: usuarioId,
      dataMovimentacao: now
    }, db);
  };

  if (typeof db.withTransactionAsync === 'function') {
    await db.withTransactionAsync(runInsideTx);
  } else {
    await db.runAsync('BEGIN TRANSACTION;');
    try {
      await runInsideTx();
      await db.runAsync('COMMIT;');
    } catch (e) {
      await db.runAsync('ROLLBACK;');
      throw e;
    }
  }

  return {
    perdaId,
    produtoId,
    tipoPerda: tipo,
    quantidade: qtdPerda,
    impactoFinanceiro,
    saldoRestante
  };
}

// --------------------------------------------------------
// 5. AUDITORIA DE KARDEX E RECONSTRUÇÃO DE SALDO (Zé Neto S05)
// --------------------------------------------------------

/**
 * Compara o saldo físico atual do produto com o saldo reconstruído
 * a partir de toda a cadeia histórica de movimentações do Kardex.
 * Não altera registros (estritamente analítico e não-destrutivo).
 */
export async function auditarSaldoKardex(produtoId, gerenteId, dbOverride = null) {
  const db = dbOverride || await getDb();

  const prodRows = await db.getAllAsync(
    'SELECT id, nome, codigo_barras, estoque, preco_custo FROM Produto WHERE id = ? AND gerente_id = ?;',
    [produtoId, gerenteId]
  );
  if (prodRows.length === 0) {
    throw new Error(`Produto #${produtoId} não encontrado.`);
  }
  const prod = prodRows[0];
  const estoqueFisico = round3(prod.estoque);

  // Busca todas as movimentações do produto ordenadas cronologicamente
  const movs = await db.getAllAsync(
    'SELECT * FROM MovimentacaoEstoque WHERE produto_id = ? AND gerente_id = ? ORDER BY datetime(data_movimentacao) ASC, id ASC;',
    [produtoId, gerenteId]
  );

  let saldoReconstruido = 0;
  const errosContinuidade = [];
  let ultimoSaldo = null;

  if (movs.length > 0) {
    saldoReconstruido = round3(movs[0].saldo_anterior);
    ultimoSaldo = saldoReconstruido;

    for (let i = 0; i < movs.length; i++) {
      const m = movs[i];
      const qtd = round3(m.quantidade);
      const anterior = round3(m.saldo_anterior);
      const resultante = round3(m.saldo_resultante);

      // Verifica se houve salto não rastreado entre a linha anterior e a atual
      if (i > 0 && Math.abs(anterior - ultimoSaldo) > 0.0001) {
        errosContinuidade.push({
          movimentacaoId: m.id,
          tipoErro: 'SALTO_DE_SALDO',
          mensagem: `Movimentação #${m.id}: saldo anterior (${anterior}) difere do resultante anterior (${ultimoSaldo}).`
        });
      }

      // Verifica consistência matemática interna da movimentação
      const resultanteEsperado = round3(anterior + qtd);
      if (Math.abs(resultanteEsperado - resultante) > 0.0001) {
        errosContinuidade.push({
          movimentacaoId: m.id,
          tipoErro: 'CALCULO_RESULTANTE_INVALIDO',
          mensagem: `Movimentação #${m.id}: anterior (${anterior}) + quant (${qtd}) = ${resultanteEsperado}, mas banco registrou ${resultante}.`
        });
      }

      saldoReconstruido = resultante;
      ultimoSaldo = resultante;
    }
  } else {
    // Produto sem movimentações: saldo reconstruído coincide com estoque atual
    saldoReconstruido = estoqueFisico;
  }

  const diferenca = round3(estoqueFisico - saldoReconstruido);
  const conforme = Math.abs(diferenca) < 0.0001 && errosContinuidade.length === 0;

  return {
    produtoId: prod.id,
    nome: prod.nome,
    codigoBarras: prod.codigo_barras,
    estoqueAtual: estoqueFisico,
    saldoReconstruido,
    divergencia: diferenca,
    conforme,
    totalMovimentacoes: movs.length,
    errosContinuidade,
    historico: movs
  };
}

/**
 * Executa a rotina de auditoria de Kardex para todos os produtos do estoque
 */
export async function auditarTodosProdutosKardex(gerenteId, dbOverride = null) {
  const db = dbOverride || await getDb();

  const produtos = await db.getAllAsync(
    'SELECT id FROM Produto WHERE gerente_id = ? ORDER BY nome ASC;',
    [gerenteId]
  );

  let totalProdutosAuditados = produtos.length;
  let produtosConformes = 0;
  let produtosComDivergencia = 0;
  const divergencias = [];

  for (const p of produtos) {
    const aud = await auditarSaldoKardex(p.id, gerenteId, db);
    if (aud.conforme) {
      produtosConformes++;
    } else {
      produtosComDivergencia++;
      divergencias.push({
        produtoId: aud.produtoId,
        nome: aud.nome,
        codigoBarras: aud.codigoBarras,
        estoqueAtual: aud.estoqueAtual,
        saldoReconstruido: aud.saldoReconstruido,
        divergencia: aud.divergencia,
        errosContinuidade: aud.errosContinuidade
      });
    }
  }

  return {
    statusGeral: divergencias.length === 0 ? 'CONFORME' : 'DIVERGENCIA_ENCONTRADA',
    totalProdutosAuditados,
    produtosConformes,
    produtosComDivergencia,
    divergencias
  };
}

// --------------------------------------------------------
// 6. RELATÓRIO GERENCIAL DE PERDAS E AVARIAS (Zé Neto S05)
// --------------------------------------------------------

/**
 * Relatório gerencial detalhado de perdas e avarias por período e categoria,
 * consolidando impactos financeiros com custos históricos unitários.
 */
export async function fetchRelatorioPerdasAvariasDetalhado(gerenteId, options = {}, dbOverride = null) {
  const db = dbOverride || await getDb();
  const { dataInicio, dataFim, tipoPerda } = options;

  let query = `
    SELECT 
      pe.id,
      pe.gerente_id,
      pe.produto_id,
      pe.usuario_id,
      pe.tipo_perda,
      pe.quantidade,
      pe.custo_unitario,
      pe.impacto_financeiro,
      pe.justificativa,
      pe.data_perda,
      p.nome as produto_nome,
      p.codigo_barras,
      p.categoria as produto_categoria,
      u.nome as usuario_nome,
      u.cargo as usuario_cargo
    FROM PerdaEstoque pe
    JOIN Produto p ON pe.produto_id = p.id
    LEFT JOIN Usuario u ON pe.usuario_id = u.id
    WHERE pe.gerente_id = ?
  `;
  const params = [gerenteId];

  if (dataInicio) {
    query += ' AND pe.data_perda >= ?';
    params.push(dataInicio);
  }
  if (dataFim) {
    query += ' AND pe.data_perda <= ?';
    params.push(dataFim);
  }
  if (tipoPerda && tipoPerda !== 'todos') {
    query += ' AND pe.tipo_perda = ?';
    params.push(tipoPerda.toLowerCase().trim());
  }

  query += ' ORDER BY datetime(pe.data_perda) DESC, pe.id DESC;';

  const rows = await db.getAllAsync(query, params);

  const porTipo = {};
  const porCategoria = {};
  let impactoFinanceiroTotal = 0;
  let totalItensPerdidos = 0;

  for (const r of rows) {
    const qtd = round3(r.quantidade);
    const impacto = round2(r.impacto_financeiro);

    totalItensPerdidos = round3(totalItensPerdidos + qtd);
    impactoFinanceiroTotal = sumMoney(impactoFinanceiroTotal, impacto);

    // Agrupamento por tipo de perda
    const tipo = r.tipo_perda;
    if (!porTipo[tipo]) {
      porTipo[tipo] = { tipo, quantidade: 0, impactoTotal: 0, ocorrencias: 0 };
    }
    porTipo[tipo].quantidade = round3(porTipo[tipo].quantidade + qtd);
    porTipo[tipo].impactoTotal = sumMoney(porTipo[tipo].impactoTotal, impacto);
    porTipo[tipo].ocorrencias += 1;

    // Agrupamento por categoria
    const cat = r.produto_categoria || 'Sem categoria';
    if (!porCategoria[cat]) {
      porCategoria[cat] = { categoria: cat, quantidade: 0, impactoTotal: 0, ocorrencias: 0 };
    }
    porCategoria[cat].quantidade = round3(porCategoria[cat].quantidade + qtd);
    porCategoria[cat].impactoTotal = sumMoney(porCategoria[cat].impactoTotal, impacto);
    porCategoria[cat].ocorrencias += 1;
  }

  return {
    totalRegistros: rows.length,
    totalPerdasRegistradas: rows.length,
    totalItensPerdidos,
    quantidadeItensPerdidos: totalItensPerdidos,
    impactoFinanceiroTotal,
    totalPerdasFinanceiras: impactoFinanceiroTotal,
    totaisPorTipo: Object.values(porTipo),
    totaisPorCategoria: Object.values(porCategoria),
    resumoPorTipo: Object.values(porTipo),
    perdas: rows,
    detalhes: rows
  };
}

/**
 * Relatório gerencial de perdas por período (mantido para compatibilidade retroativa)
 */
export async function fetchRelatorioPerdas(gerenteId, options = {}, dbOverride = null) {
  return await fetchRelatorioPerdasAvariasDetalhado(gerenteId, options, dbOverride);
}
