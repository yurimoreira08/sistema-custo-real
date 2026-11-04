import { getDb } from '../database/dbInstance';
import { syncOrEnqueue } from '../database/syncService';
import { validarDocumento, validarTelefone, formatarDocumento, formatarTelefone } from '../utils/validators';

// ========================================================
// SERVIÇO DE CLIENTES E CADERNETA DE FIADO (S01 / S02 / S06)
// Responsável: Yuri Mauriz / Base Conjunta
// ========================================================

/**
 * Cria a tabela de clientes e aplica migrações para suporte a validação de documentos,
 * teto de crédito e bloqueio preventivo de inadimplentes.
 */
export async function initClienteTable(db) {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS Cliente (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gerente_id INTEGER NOT NULL,
      nome TEXT NOT NULL,
      cpf TEXT,
      telefone TEXT,
      email TEXT,
      limite_fiado REAL NOT NULL DEFAULT 0.0,
      saldo_devedor REAL NOT NULL DEFAULT 0.0,
      bloqueado_inadimplente INTEGER NOT NULL DEFAULT 0,
      motivo_bloqueio TEXT,
      ativo INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_cliente_nome ON Cliente(nome);
    CREATE INDEX IF NOT EXISTS idx_cliente_cpf ON Cliente(cpf);
    CREATE INDEX IF NOT EXISTS idx_cliente_inadimplente ON Cliente(bloqueado_inadimplente);
  `);

  // Migrações seguras de colunas caso a tabela já exista de versões anteriores
  try {
    await db.execAsync("ALTER TABLE Cliente ADD COLUMN email TEXT;");
  } catch (e) {}
  try {
    await db.execAsync("ALTER TABLE Cliente ADD COLUMN bloqueado_inadimplente INTEGER NOT NULL DEFAULT 0;");
  } catch (e) {}
  try {
    await db.execAsync("ALTER TABLE Cliente ADD COLUMN motivo_bloqueio TEXT;");
  } catch (e) {}
  try {
    await db.execAsync("ALTER TABLE Cliente ADD COLUMN updated_at TEXT;");
  } catch (e) {}
}

/**
 * Cadastra ou atualiza um cliente com validação rigorosa de documento e contato,
 * teto de crédito personalizável e flag de bloqueio preventivo de inadimplência.
 */
export async function saveCliente(cliente, gerenteId, dbOverride = null) {
  const db = dbOverride || await getDb();
  const nome = (cliente.nome || '').trim();
  if (!nome) {
    throw new Error('Nome do cliente é obrigatório.');
  }

  // 1. Validação do Documento (CPF / CNPJ)
  const docBruto = cliente.cpf_cnpj || cliente.cpf;
  let docFormatado = null;
  if (docBruto && String(docBruto).trim()) {
    const valDoc = validarDocumento(docBruto);
    if (!valDoc.valido) {
      throw new Error(`Documento do cliente inválido: ${valDoc.mensagem}`);
    }
    docFormatado = formatarDocumento(valDoc.limpo);
  }

  // 2. Validação do Contato (Telefone)
  let telFormatado = null;
  if (cliente.telefone && String(cliente.telefone).trim()) {
    const valTel = validarTelefone(cliente.telefone);
    if (!valTel.valido) {
      throw new Error(`Contato telefônico inválido: ${valTel.mensagem}`);
    }
    telFormatado = formatarTelefone(valTel.limpo);
  }

  // 3. Teto de Crédito Personalizável
  const limite = parseFloat(cliente.limite_fiado != null ? cliente.limite_fiado : 0);
  if (isNaN(limite) || limite < 0) {
    throw new Error('O teto de crédito (limite) não pode ser negativo.');
  }

  const bloqueado = cliente.bloqueado_inadimplente ? 1 : 0;
  const motivoBloq = cliente.motivo_bloqueio ? String(cliente.motivo_bloqueio).trim() : null;
  const email = cliente.email ? String(cliente.email).trim() : null;
  const ativo = cliente.ativo !== false ? 1 : 0;

  let resultId = cliente.id;

  if (cliente.id) {
    await db.runAsync(
      `UPDATE Cliente 
       SET nome = ?, cpf = ?, telefone = ?, email = ?, limite_fiado = ?, 
           bloqueado_inadimplente = ?, motivo_bloqueio = ?, ativo = ?, updated_at = datetime('now')
       WHERE id = ? AND gerente_id = ?;`,
      [nome, docFormatado, telFormatado, email, limite, bloqueado, motivoBloq, ativo, cliente.id, gerenteId]
    );
  } else {
    const res = await db.runAsync(
      `INSERT INTO Cliente (gerente_id, nome, cpf, telefone, email, limite_fiado, saldo_devedor, bloqueado_inadimplente, motivo_bloqueio, ativo)
       VALUES (?, ?, ?, ?, ?, ?, 0.0, ?, ?, 1);`,
      [gerenteId, nome, docFormatado, telFormatado, email, limite, bloqueado, motivoBloq]
    );
    resultId = res.lastInsertRowId;
  }

  const saved = await getClienteById(resultId, gerenteId, db);
  await syncOrEnqueue('Cliente', 'upsert', saved);
  return saved;
}

/**
 * Busca clientes do gerente com suporte a filtro de inadimplência e texto
 */
export async function fetchClientes(gerenteId, apenasAtivos = true, dbOverride = null) {
  const db = dbOverride || await getDb();
  const sql = apenasAtivos
    ? 'SELECT * FROM Cliente WHERE gerente_id = ? AND ativo = 1 ORDER BY nome ASC;'
    : 'SELECT * FROM Cliente WHERE gerente_id = ? ORDER BY nome ASC;';
  return await db.getAllAsync(sql, [gerenteId]);
}

/**
 * Busca clientes inadimplentes ou com bloqueio preventivo
 */
export async function fetchClientesInadimplentes(gerenteId, dbOverride = null) {
  const db = dbOverride || await getDb();
  return await db.getAllAsync(
    `SELECT * FROM Cliente 
     WHERE gerente_id = ? AND (bloqueado_inadimplente = 1 OR (limite_fiado > 0 AND saldo_devedor >= limite_fiado))
     ORDER BY saldo_devedor DESC, nome ASC;`,
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
 * Altera status de bloqueio preventivo de inadimplência de um cliente
 */
export async function alterarBloqueioInadimplente({ clienteId, gerenteId, bloquear, motivo }, dbOverride = null) {
  const db = dbOverride || await getDb();
  const cliente = await getClienteById(clienteId, gerenteId, db);
  if (!cliente) {
    throw new Error('Cliente não encontrado.');
  }

  const bloqVal = bloquear ? 1 : 0;
  const motivoTexto = bloquear ? (motivo ? String(motivo).trim() : 'Inadimplência registrada no sistema') : null;

  await db.runAsync(
    `UPDATE Cliente 
     SET bloqueado_inadimplente = ?, motivo_bloqueio = ?, updated_at = datetime('now')
     WHERE id = ? AND gerente_id = ?;`,
    [bloqVal, motivoTexto, clienteId, gerenteId]
  );

  const updated = await getClienteById(clienteId, gerenteId, db);
  await syncOrEnqueue('Cliente', 'upsert', updated);
  return updated;
}

/**
 * Valida se o cliente pode comprar no Fiado pelo valor solicitado.
 * Bloqueia expressamente clientes inadimplentes e compras acima do teto de crédito configurado.
 */
export async function validateLimiteFiado(clienteId, valor, gerenteId, dbOverride = null) {
  const db = dbOverride || await getDb();
  const cliente = await getClienteById(clienteId, gerenteId, db);
  if (!cliente) {
    throw new Error('Cliente para cobrança em Fiado não encontrado.');
  }
  if (!cliente.ativo) {
    throw new Error(`O cliente "${cliente.nome}" está inativo.`);
  }

  // 1. Bloqueio Preventivo de Inadimplência
  if (cliente.bloqueado_inadimplente === 1) {
    const justificativa = cliente.motivo_bloqueio || 'Bloqueio preventivo por inadimplência';
    throw new Error(
      `Venda bloqueada: O cliente "${cliente.nome}" possui bloqueio preventivo de crédito. Motivo: ${justificativa}.`
    );
  }

  const saldoAtual = Number(cliente.saldo_devedor) || 0;
  const limite = Number(cliente.limite_fiado) || 0;
  const tentativaValor = Number(valor) || 0;

  if (tentativaValor <= 0) {
    throw new Error('Valor da venda a prazo deve ser maior que zero.');
  }

  // 2. Validação do Teto de Crédito Personalizado
  const novoSaldo = Math.round((saldoAtual + tentativaValor) * 100) / 100;

  if (limite > 0 && novoSaldo > (limite + 0.001)) {
    const disponivel = Math.max(0, limite - saldoAtual);
    throw new Error(
      `Teto de crédito excedido para "${cliente.nome}"! Limite configurado: R$ ${limite.toFixed(2)}, Saldo devedor atual: R$ ${saldoAtual.toFixed(2)}, Crédito disponível: R$ ${disponivel.toFixed(2)}, Tentativa: R$ ${tentativaValor.toFixed(2)}.`
    );
  }

  return { 
    cliente, 
    saldoAtual, 
    novoSaldo, 
    limite,
    disponivel: Math.max(0, limite - saldoAtual)
  };
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

  const { cliente } = await validateLimiteFiado(clienteId, valorNum, gerenteId, db);
  await db.runAsync(
    `UPDATE Cliente 
     SET saldo_devedor = saldo_devedor + ?, updated_at = datetime('now') 
     WHERE id = ? AND gerente_id = ?;`,
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
    `UPDATE Cliente 
     SET saldo_devedor = MAX(0.0, saldo_devedor - ?), updated_at = datetime('now') 
     WHERE id = ? AND gerente_id = ?;`,
    [valorNum, clienteId, gerenteId]
  );

  const updated = await getClienteById(clienteId, gerenteId, db);
  if (updated) {
    await syncOrEnqueue('Cliente', 'upsert', updated);
  }
}
