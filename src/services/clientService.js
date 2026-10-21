import { getDb } from '../database/dbInstance';
import { syncOrEnqueue } from '../database/syncService';

// ========================================================
// SERVIÇO DE CLIENTES E CADERNETA DE FIADO (S01 / S02)
// Integrante: Yuri Mauriz / Base Conjunta
// ========================================================

/**
 * Cria a tabela de clientes se não existir (usado nas migrations)
 */
export async function initClienteTable(db) {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS Cliente (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gerente_id INTEGER NOT NULL,
      nome TEXT NOT NULL,
      cpf TEXT,
      telefone TEXT,
      limite_fiado REAL NOT NULL DEFAULT 0.0,
      saldo_devedor REAL NOT NULL DEFAULT 0.0,
      ativo INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_cliente_nome ON Cliente(nome);
  `);
}

/**
 * Cadastra ou atualiza um cliente
 */
export async function saveCliente(cliente, gerenteId, dbOverride = null) {
  const db = dbOverride || await getDb();
  const nome = (cliente.nome || '').trim();
  if (!nome) throw new Error('Nome do cliente é obrigatório.');

  const limite = parseFloat(cliente.limite_fiado) || 0;
  if (limite < 0) throw new Error('Limite de crédito não pode ser negativo.');

  let resultId = cliente.id;

  if (cliente.id) {
    await db.runAsync(
      `UPDATE Cliente 
       SET nome = ?, cpf = ?, telefone = ?, limite_fiado = ?, ativo = ?
       WHERE id = ? AND gerente_id = ?;`,
      [nome, cliente.cpf || null, cliente.telefone || null, limite, cliente.ativo !== false ? 1 : 0, cliente.id, gerenteId]
    );
  } else {
    const res = await db.runAsync(
      `INSERT INTO Cliente (gerente_id, nome, cpf, telefone, limite_fiado, saldo_devedor, ativo)
       VALUES (?, ?, ?, ?, ?, 0.0, 1);`,
      [gerenteId, nome, cliente.cpf || null, cliente.telefone || null, limite]
    );
    resultId = res.lastInsertRowId;
  }

  const saved = await getClienteById(resultId, gerenteId, db);
  await syncOrEnqueue('Cliente', 'upsert', saved);
  return saved;
}

/**
 * Busca clientes ativos do gerente
 */
export async function fetchClientes(gerenteId, dbOverride = null) {
  const db = dbOverride || await getDb();
  return await db.getAllAsync(
    'SELECT * FROM Cliente WHERE gerente_id = ? AND ativo = 1 ORDER BY nome ASC;',
    [gerenteId]
  );
}

/**
 * Busca cliente por ID
 */
export async function getClienteById(id, gerenteId, dbOverride = null) {
  const db = dbOverride || await getDb();
  const rows = await db.getAllAsync(
    'SELECT * FROM Cliente WHERE id = ? AND gerente_id = ? LIMIT 1;',
    [id, gerenteId]
  );
  return rows[0] || null;
}

/**
 * Valida se o cliente pode comprar no Fiado pelo valor solicitado
 */
export async function validateLimiteFiado(clienteId, valor, gerenteId, dbOverride = null) {
  const db = dbOverride || await getDb();
  const cliente = await getClienteById(clienteId, gerenteId, db);
  if (!cliente) {
    throw new Error('Cliente para cobrança em Fiado não encontrado.');
  }
  if (!cliente.ativo) {
    throw new Error(`O cliente ${cliente.nome} está inativo.`);
  }

  const saldoAtual = Number(cliente.saldo_devedor) || 0;
  const limite = Number(cliente.limite_fiado) || 0;
  const novoSaldo = saldoAtual + Number(valor);

  if (limite > 0 && novoSaldo > (limite + 0.001)) {
    throw new Error(
      `Limite de crédito do cliente ${cliente.nome} excedido! Saldo atual: R$ ${saldoAtual.toFixed(2)}, Limite: R$ ${limite.toFixed(2)}, Tentativa: R$ ${Number(valor).toFixed(2)}.`
    );
  }

  return { cliente, saldoAtual, novoSaldo };
}

/**
 * Debita fiado na caderneta do cliente
 */
export async function debitarFiado(clienteId, valor, gerenteId, dbOverride = null) {
  const db = dbOverride || await getDb();
  const valorNum = parseFloat(valor);
  if (isNaN(valorNum) || valorNum <= 0) {
    throw new Error('Valor inválido para débito em fiado.');
  }

  const { cliente, novoSaldo } = await validateLimiteFiado(clienteId, valorNum, gerenteId, db);
  await db.runAsync(
    'UPDATE Cliente SET saldo_devedor = saldo_devedor + ? WHERE id = ? AND gerente_id = ?;',
    [valorNum, clienteId, gerenteId]
  );

  const updated = await getClienteById(clienteId, gerenteId, db);
  await syncOrEnqueue('Cliente', 'upsert', updated);
  return updated;
}

/**
 * Estorna fiado da caderneta (ex: cancelamento ou devolução)
 */
export async function estornarFiado(clienteId, valor, gerenteId, dbOverride = null) {
  const db = dbOverride || await getDb();
  const valorNum = parseFloat(valor);
  if (isNaN(valorNum) || valorNum <= 0) return;

  await db.runAsync(
    'UPDATE Cliente SET saldo_devedor = MAX(0.0, saldo_devedor - ?) WHERE id = ? AND gerente_id = ?;',
    [valorNum, clienteId, gerenteId]
  );

  const updated = await getClienteById(clienteId, gerenteId, db);
  if (updated) {
    await syncOrEnqueue('Cliente', 'upsert', updated);
  }
}
