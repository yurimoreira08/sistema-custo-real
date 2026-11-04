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
 * Normaliza a data de validade para AAAA-MM-DD. Aceita AAAA-MM-DD ou DD/MM/AAAA.
 * Retorna null se vazia; lança erro se o formato ou a data forem inválidos.
 */
export function normalizarDataValidade(valor) {
  if (valor == null || !String(valor).trim()) return null;
  const txt = String(valor).trim();
  let ano, mes, dia;
  let m = txt.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    [, ano, mes, dia] = m;
  } else if ((m = txt.match(/^(\d{2})\/(\d{2})\/(\d{4})$/))) {
    [, dia, mes, ano] = m;
  } else {
    throw new Error(`Data de validade "${txt}" inválida. Use AAAA-MM-DD ou DD/MM/AAAA.`);
  }
  const d = new Date(Date.UTC(+ano, +mes - 1, +dia));
  if (d.getUTCFullYear() !== +ano || d.getUTCMonth() !== +mes - 1 || d.getUTCDate() !== +dia) {
    throw new Error(`Data de validade "${txt}" não existe no calendário.`);
  }
  return `${ano}-${mes}-${dia}`;
}

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

    CREATE TABLE IF NOT EXISTS LoteEstoque (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gerente_id INTEGER NOT NULL,
      produto_id INTEGER NOT NULL,
      entrada_id INTEGER,
      item_entrada_id INTEGER,
      numero_lote TEXT NOT NULL,
      data_entrada TEXT NOT NULL DEFAULT (datetime('now')),
      data_validade TEXT,
      quantidade_inicial REAL NOT NULL,
      quantidade_saldo REAL NOT NULL,
      custo_unitario REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'ativo' CHECK(status IN ('ativo', 'esgotado', 'vencido')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (produto_id) REFERENCES Produto(id),
      FOREIGN KEY (entrada_id) REFERENCES EntradaMercadoria(id)
    );
    CREATE INDEX IF NOT EXISTS idx_lote_produto_status ON LoteEstoque(produto_id, status);
    CREATE INDEX IF NOT EXISTS idx_lote_validade ON LoteEstoque(data_validade ASC);

    -- Rastreabilidade: de quais lotes saiu cada baixa (venda, perda), para estornos exatos
    CREATE TABLE IF NOT EXISTS BaixaLote (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gerente_id INTEGER NOT NULL,
      lote_id INTEGER NOT NULL,
      produto_id INTEGER NOT NULL,
      origem_tipo TEXT NOT NULL,
      origem_id INTEGER,
      item_venda_id INTEGER,
      quantidade REAL NOT NULL,
      quantidade_restaurada REAL NOT NULL DEFAULT 0.0,
      data_baixa TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (lote_id) REFERENCES LoteEstoque(id)
    );
    CREATE INDEX IF NOT EXISTS idx_baixa_lote_origem ON BaixaLote(origem_tipo, origem_id, item_venda_id);
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
      normalizarDataValidade(item.dataValidade); // lança erro se a validade for inválida
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

      // Registra o lote e prazo de validade vinculado à entrada de mercadoria
      const numeroLote = (item.lote && String(item.lote).trim()) 
        ? String(item.lote).trim() 
        : `LOTE-${now.substring(0, 10).replace(/-/g, '')}-${item.produtoId}`;
      const dataValidade = normalizarDataValidade(item.dataValidade);

      await db.runAsync(
        `INSERT INTO LoteEstoque (
          gerente_id, produto_id, entrada_id, item_entrada_id, numero_lote, data_entrada,
          data_validade, quantidade_inicial, quantidade_saldo, custo_unitario, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ativo');`,
        [
          gerenteId,
          item.produtoId,
          entradaId,
          resItem.lastInsertRowId,
          numeroLote,
          now,
          dataValidade,
          qtdEntrada,
          qtdEntrada,
          custoEntrada
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

    // 2.1 Baixa nos lotes (PEPS/FEFO: o lote de validade mais próxima/vencido sai primeiro)
    await baixarLotesFIFO(produtoId, qtdPerda, gerenteId, db, { tipo: 'perda', id: perdaId });

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

// --------------------------------------------------------
// 7. LOTES, CONTROLE DE VALIDADE & ALGORITMO PEPS / FIFO
// --------------------------------------------------------

/**
 * Algoritmo de sugestão de saída no modelo PEPS/FIFO (Primeiro que Entra, Primeiro que Sai)
 * Prioriza os lotes com data de validade mais próxima (FEFO) e data de entrada mais antiga (PEPS).
 */
export async function sugerirSaidaLotesFIFO(produtoId, quantidadeSolicitada, gerenteId, dbOverride = null) {
  const db = dbOverride || await getDb();
  const qSolicitada = parseFloat(quantidadeSolicitada);
  if (isNaN(qSolicitada) || qSolicitada <= 0) {
    throw new Error('A quantidade solicitada para sugestão PEPS/FIFO deve ser maior que zero.');
  }

  // Busca lotes com saldo positivo para o produto ordenados por:
  // 1. Data de validade ASC (lotes a vencer primeiro saem primeiro)
  // 2. Data de entrada ASC (lotes que entraram antes saem antes)
  // 3. ID ASC (critério de desempate)
  const lotes = await db.getAllAsync(
    `SELECT * FROM LoteEstoque 
     WHERE produto_id = ? AND gerente_id = ? AND quantidade_saldo > 0 AND status = 'ativo'
     ORDER BY 
       CASE WHEN data_validade IS NOT NULL AND data_validade != '' THEN 0 ELSE 1 END,
       data_validade ASC,
       data_entrada ASC,
       id ASC;`,
    [produtoId, gerenteId]
  );

  let restante = qSolicitada;
  const sugestoes = [];
  const alertas = [];
  const hoje = new Date().toISOString().substring(0, 10);

  for (const lote of lotes) {
    if (restante <= 0.0001) break;

    const qtdDisponivel = parseFloat(lote.quantidade_saldo);
    const qtdAlocar = round3(Math.min(restante, qtdDisponivel));

    let diasParaVencer = null;
    let statusValidade = 'ok';

    if (lote.data_validade) {
      const dVal = lote.data_validade.substring(0, 10);
      const diffMs = new Date(dVal).getTime() - new Date(hoje).getTime();
      diasParaVencer = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

      if (diasParaVencer < 0) {
        statusValidade = 'vencido';
        alertas.push({
          loteId: lote.id,
          numeroLote: lote.numero_lote,
          tipo: 'VENCIDO',
          mensagem: `ATENÇÃO: O lote "${lote.numero_lote}" venceu há ${Math.abs(diasParaVencer)} dia(s) (${lote.data_validade})!`
        });
      } else if (diasParaVencer <= 30) {
        statusValidade = 'proximo_vencimento';
        alertas.push({
          loteId: lote.id,
          numeroLote: lote.numero_lote,
          tipo: 'PROXIMO_VENCIMENTO',
          mensagem: `Aviso: O lote "${lote.numero_lote}" vencerá em ${diasParaVencer} dia(s) (${lote.data_validade}). Sugerido para giro prioritário.`
        });
      }
    }

    sugestoes.push({
      loteId: lote.id,
      numeroLote: lote.numero_lote,
      dataEntrada: lote.data_entrada,
      dataValidade: lote.data_validade,
      quantidadeSugerida: qtdAlocar,
      saldoDisponivel: qtdDisponivel,
      custoUnitario: lote.custo_unitario,
      diasParaVencer,
      statusValidade
    });

    restante = round3(restante - qtdAlocar);
  }

  const quantidadeAtendida = round3(qSolicitada - restante);

  if (restante > 0.0001) {
    alertas.push({
      tipo: 'SALDO_INSUFICIENTE_LOTES',
      mensagem: `Atenção: Saldo em lotes controlados (${quantidadeAtendida}) é inferior à quantidade solicitada (${qSolicitada}). Faltam ${round3(restante)} un.`
    });
  }

  return {
    produtoId,
    quantidadeSolicitada: qSolicitada,
    quantidadeAtendida,
    atendimentoCompleto: restante <= 0.0001,
    sugestoes,
    alertas
  };
}

/**
 * Consome e dá baixa nos lotes no modelo PEPS/FIFO durante checkout ou saída
 */
export async function baixarLotesFIFO(produtoId, quantidade, gerenteId, dbOverride = null, origem = null) {
  const db = dbOverride || await getDb();
  const sugestao = await sugerirSaidaLotesFIFO(produtoId, quantidade, gerenteId, db);

  const baixasRealizadas = [];

  for (const s of sugestao.sugestoes) {
    const novoSaldo = round3(s.saldoDisponivel - s.quantidadeSugerida);
    const novoStatus = novoSaldo <= 0.0001 ? 'esgotado' : 'ativo';

    await db.runAsync(
      `UPDATE LoteEstoque 
       SET quantidade_saldo = ?, status = ?
       WHERE id = ? AND gerente_id = ?;`,
      [Math.max(0, novoSaldo), novoStatus, s.loteId, gerenteId]
    );

    if (origem && origem.tipo) {
      await db.runAsync(
        `INSERT INTO BaixaLote (gerente_id, lote_id, produto_id, origem_tipo, origem_id, item_venda_id, quantidade)
         VALUES (?, ?, ?, ?, ?, ?, ?);`,
        [gerenteId, s.loteId, produtoId, origem.tipo, origem.id ?? null, origem.itemVendaId ?? null, s.quantidadeSugerida]
      );
    }

    baixasRealizadas.push({
      loteId: s.loteId,
      numeroLote: s.numeroLote,
      quantidadeBaixada: s.quantidadeSugerida,
      saldoRestanteLote: Math.max(0, novoSaldo),
      statusLote: novoStatus
    });
  }

  return {
    produtoId,
    quantidadeTotalBaixada: sugestao.quantidadeAtendida,
    baixas: baixasRealizadas,
    alertas: sugestao.alertas
  };
}

/**
 * Devolve aos lotes de origem a quantidade baixada por um item de venda (cancelamento ou
 * devolução apta para revenda). Restaura primeiro os lotes consumidos por último.
 */
export async function restaurarLotesItemVenda(itemVendaId, quantidade, gerenteId, dbOverride = null) {
  const db = dbOverride || await getDb();
  let restante = round3(parseFloat(quantidade) || 0);
  if (restante <= 0) return { quantidadeRestaurada: 0 };

  const baixas = await db.getAllAsync(
    `SELECT * FROM BaixaLote
     WHERE item_venda_id = ? AND gerente_id = ? AND origem_tipo = 'venda' AND quantidade > quantidade_restaurada
     ORDER BY id DESC;`,
    [itemVendaId, gerenteId]
  );

  for (const b of baixas) {
    if (restante <= 0.0001) break;
    const qtd = round3(Math.min(restante, b.quantidade - b.quantidade_restaurada));
    await db.runAsync(
      'UPDATE BaixaLote SET quantidade_restaurada = quantidade_restaurada + ? WHERE id = ?;',
      [qtd, b.id]
    );
    await db.runAsync(
      `UPDATE LoteEstoque SET quantidade_saldo = quantidade_saldo + ?, status = 'ativo'
       WHERE id = ? AND gerente_id = ?;`,
      [qtd, b.lote_id, gerenteId]
    );
    restante = round3(restante - qtd);
  }

  return { quantidadeRestaurada: round3((parseFloat(quantidade) || 0) - restante) };
}

/**
 * Busca histórico e saldos de lotes de um produto
 */
export async function fetchLotesProduto(produtoId, gerenteId, dbOverride = null) {
  const db = dbOverride || await getDb();
  return await db.getAllAsync(
    `SELECT * FROM LoteEstoque 
     WHERE produto_id = ? AND gerente_id = ? 
     ORDER BY CASE WHEN status = 'ativo' THEN 0 ELSE 1 END, data_validade ASC, id ASC;`,
    [produtoId, gerenteId]
  );
}

/**
 * Relatório de lotes com validade próxima ou vencidos
 */
export async function fetchLotesProximosVencimento(gerenteId, diasLimite = 30, dbOverride = null) {
  const db = dbOverride || await getDb();
  const hoje = new Date().toISOString().substring(0, 10);

  const rows = await db.getAllAsync(
    `SELECT le.*, p.nome as produto_nome, p.categoria as produto_categoria 
     FROM LoteEstoque le
     JOIN Produto p ON p.id = le.produto_id
     WHERE le.gerente_id = ? AND le.quantidade_saldo > 0 AND le.data_validade IS NOT NULL AND le.data_validade != ''
     ORDER BY le.data_validade ASC;`,
    [gerenteId]
  );

  return rows.map(r => {
    const diffMs = new Date(r.data_validade.substring(0, 10)).getTime() - new Date(hoje).getTime();
    const dias = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    return {
      ...r,
      diasParaVencer: dias,
      vencido: dias < 0,
      proximoVencimento: dias >= 0 && dias <= diasLimite,
      impactoFinanceiro: round2(r.quantidade_saldo * r.custo_unitario)
    };
  }).filter(r => r.vencido || r.proximoVencimento);
}
