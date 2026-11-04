import { getDb } from '../database/dbInstance';
import { syncOrEnqueue } from '../database/syncService';
import { round2, sumMoney, subtractMoney, toCents, fromCents } from '../utils/money';

// ========================================================
// SERVIÇO DE CAIXA, TURNOS, AUDITORIA E BLOQUEIO (S06)
// Responsável: Francisco Yuri da Silva Mauriz / Base Conjunta
// ========================================================

/**
 * Inicializa tabelas de turnos de caixa e auditoria de movimentações
 */
export async function initCashTables(db) {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS TurnoCaixa (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gerente_id INTEGER NOT NULL,
      operador_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'aberto' CHECK(status IN ('aberto', 'bloqueado', 'fechado')),
      fundo_troco_inicial REAL NOT NULL DEFAULT 0.0,
      total_vendas_dinheiro REAL NOT NULL DEFAULT 0.0,
      total_vendas_outros REAL NOT NULL DEFAULT 0.0,
      total_suprimentos REAL NOT NULL DEFAULT 0.0,
      total_sangrias REAL NOT NULL DEFAULT 0.0,
      saldo_esperado_dinheiro REAL NOT NULL DEFAULT 0.0,
      saldo_fechamento_informado REAL,
      diferenca_fechamento REAL,
      motivo_bloqueio TEXT,
      observacoes TEXT,
      data_abertura TEXT NOT NULL DEFAULT (datetime('now')),
      data_bloqueio TEXT,
      data_fechamento TEXT,
      FOREIGN KEY (operador_id) REFERENCES Usuario(id)
    );

    CREATE TABLE IF NOT EXISTS MovimentacaoCaixa (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      turno_caixa_id INTEGER NOT NULL,
      gerente_id INTEGER NOT NULL,
      operador_id INTEGER NOT NULL,
      tipo_operacao TEXT NOT NULL CHECK(tipo_operacao IN ('ABERTURA', 'VENDA', 'SANGRIA', 'SUPRIMENTO', 'BLOQUEIO', 'DESBLOQUEIO', 'FECHAMENTO', 'ESTORNO')),
      forma_pagamento TEXT DEFAULT 'dinheiro',
      valor REAL NOT NULL,
      saldo_apos REAL NOT NULL,
      origem_referencia TEXT,
      justificativa TEXT,
      data_movimentacao TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (turno_caixa_id) REFERENCES TurnoCaixa(id) ON DELETE CASCADE,
      FOREIGN KEY (operador_id) REFERENCES Usuario(id)
    );

    CREATE INDEX IF NOT EXISTS idx_turno_operador_status ON TurnoCaixa(operador_id, status);
    CREATE INDEX IF NOT EXISTS idx_mov_caixa_turno ON MovimentacaoCaixa(turno_caixa_id, data_movimentacao ASC);
  `);

  // Adiciona coluna turno_caixa_id na tabela Venda caso ainda não exista
  try {
    await db.execAsync("ALTER TABLE Venda ADD COLUMN turno_caixa_id INTEGER;");
  } catch (e) {}
}

/**
 * Abre um novo turno de caixa com fundo de troco inicial obrigatório
 */
export async function abrirTurnoCaixa({ gerenteId, operadorId, fundoTrocoInicial = 0, observacoes = null }, dbOverride = null) {
  const db = dbOverride || await getDb();

  const fundo = Math.max(0, parseFloat(fundoTrocoInicial) || 0);
  const now = new Date().toISOString();

  // 1. Verifica se já existe um turno em aberto ou bloqueado para este operador
  const turnoExistente = await db.getAllAsync(
    `SELECT id, status FROM TurnoCaixa 
     WHERE operador_id = ? AND gerente_id = ? AND status IN ('aberto', 'bloqueado')
     LIMIT 1;`,
    [operadorId, gerenteId]
  );

  if (turnoExistente.length > 0) {
    const t = turnoExistente[0];
    throw new Error(
      `Operador já possui um turno de caixa ativo (Turno #${t.id} - Status: ${t.status.toUpperCase()}). Feche o turno atual antes de abrir um novo.`
    );
  }

  // 2. Insere cabeçalho do Turno
  const resTurno = await db.runAsync(
    `INSERT INTO TurnoCaixa (
      gerente_id, operador_id, status, fundo_troco_inicial, total_vendas_dinheiro,
      total_vendas_outros, total_suprimentos, total_sangrias, saldo_esperado_dinheiro,
      observacoes, data_abertura
    ) VALUES (?, ?, 'aberto', ?, 0.0, 0.0, 0.0, 0.0, ?, ?, ?);`,
    [gerenteId, operadorId, fundo, fundo, observacoes || null, now]
  );
  const turnoId = resTurno.lastInsertRowId;

  // 3. Registra movimentação de auditoria
  await db.runAsync(
    `INSERT INTO MovimentacaoCaixa (
      turno_caixa_id, gerente_id, operador_id, tipo_operacao, forma_pagamento, valor, saldo_apos, origem_referencia, justificativa, data_movimentacao
    ) VALUES (?, ?, ?, 'ABERTURA', 'dinheiro', ?, ?, ?, ?, ?);`,
    [turnoId, gerenteId, operadorId, fundo, fundo, `ABERTURA-${turnoId}`, 'Abertura de caixa com fundo de troco inicial', now]
  );

  const turno = await obterTurnoPorId(turnoId, gerenteId, db);
  await syncOrEnqueue('TurnoCaixa', 'upsert', turno);
  return turno;
}

/**
 * Bloqueia temporariamente o caixa ativo (pausa do operador, ausência momentânea ou suspeita)
 */
export async function bloquearTurnoCaixa({ turnoId, operadorId, motivo, gerenteId }, dbOverride = null) {
  const db = dbOverride || await getDb();
  const justificativa = (motivo || '').trim();
  if (!justificativa) {
    throw new Error('Informe o motivo ou justificativa do bloqueio do caixa.');
  }

  const turno = await obterTurnoPorId(turnoId, gerenteId, db);
  if (!turno) throw new Error('Turno de caixa não encontrado.');
  if (turno.status === 'fechado') throw new Error('Não é possível bloquear um turno já encerrado.');
  if (turno.status === 'bloqueado') throw new Error('Este caixa já se encontra bloqueado.');

  const now = new Date().toISOString();

  await db.runAsync(
    `UPDATE TurnoCaixa 
     SET status = 'bloqueado', motivo_bloqueio = ?, data_bloqueio = ?
     WHERE id = ? AND gerente_id = ?;`,
    [justificativa, now, turnoId, gerenteId]
  );

  await db.runAsync(
    `INSERT INTO MovimentacaoCaixa (
      turno_caixa_id, gerente_id, operador_id, tipo_operacao, forma_pagamento, valor, saldo_apos, origem_referencia, justificativa, data_movimentacao
    ) VALUES (?, ?, ?, 'BLOQUEIO', 'dinheiro', 0.0, ?, ?, ?, ?);`,
    [turnoId, gerenteId, operadorId, turno.saldo_esperado_dinheiro, `BLOQUEIO-${turnoId}`, justificativa, now]
  );

  const atualizado = await obterTurnoPorId(turnoId, gerenteId, db);
  await syncOrEnqueue('TurnoCaixa', 'upsert', atualizado);
  return atualizado;
}

/**
 * Desbloqueia e reativa o caixa para permitir checkout de vendas
 */
export async function desbloquearTurnoCaixa({ turnoId, operadorId, justificativa = 'Desbloqueio autorizado', gerenteId }, dbOverride = null) {
  const db = dbOverride || await getDb();
  const turno = await obterTurnoPorId(turnoId, gerenteId, db);
  if (!turno) throw new Error('Turno de caixa não encontrado.');
  if (turno.status === 'fechado') throw new Error('Não é possível desbloquear um turno já encerrado.');
  if (turno.status === 'aberto') throw new Error('Este caixa já está aberto e ativo.');

  const now = new Date().toISOString();

  await db.runAsync(
    `UPDATE TurnoCaixa 
     SET status = 'aberto', motivo_bloqueio = NULL, data_bloqueio = NULL
     WHERE id = ? AND gerente_id = ?;`,
    [turnoId, gerenteId]
  );

  await db.runAsync(
    `INSERT INTO MovimentacaoCaixa (
      turno_caixa_id, gerente_id, operador_id, tipo_operacao, forma_pagamento, valor, saldo_apos, origem_referencia, justificativa, data_movimentacao
    ) VALUES (?, ?, ?, 'DESBLOQUEIO', 'dinheiro', 0.0, ?, ?, ?, ?);`,
    [turnoId, gerenteId, operadorId, turno.saldo_esperado_dinheiro, `DESBLOQUEIO-${turnoId}`, justificativa, now]
  );

  const atualizado = await obterTurnoPorId(turnoId, gerenteId, db);
  await syncOrEnqueue('TurnoCaixa', 'upsert', atualizado);
  return atualizado;
}

/**
 * Realiza suprimento (entrada de troco) ou sangria (retirada de segurança)
 */
export async function registrarSuprimentoSangria({ turnoId, operadorId, tipo, valor, justificativa, gerenteId }, dbOverride = null) {
  const db = dbOverride || await getDb();
  const tipoUpper = String(tipo).toUpperCase();
  if (tipoUpper !== 'SUPRIMENTO' && tipoUpper !== 'SANGRIA') {
    throw new Error('Tipo inválido. Deve ser SUPRIMENTO ou SANGRIA.');
  }

  const vNum = parseFloat(valor);
  if (isNaN(vNum) || vNum <= 0) {
    throw new Error('Valor da movimentação deve ser maior que zero.');
  }

  const just = (justificativa || '').trim();
  if (!just) {
    throw new Error(`Justificativa obrigatória para registrar ${tipoUpper}.`);
  }

  const turno = await validarCaixaAtivoParaCheckout(operadorId, gerenteId, db);
  if (turno.id !== turnoId) {
    throw new Error('Turno informado não coincide com o turno ativo do operador.');
  }

  const now = new Date().toISOString();
  let novoSaldoEsperado = 0;

  if (tipoUpper === 'SANGRIA') {
    if (vNum > turno.saldo_esperado_dinheiro) {
      throw new Error(
        `Sangria não permitida! Saldo em dinheiro no caixa (R$ ${turno.saldo_esperado_dinheiro.toFixed(2)}) é inferior ao valor solicitado (R$ ${vNum.toFixed(2)}).`
      );
    }
    novoSaldoEsperado = subtractMoney(turno.saldo_esperado_dinheiro, vNum);
    const novoTotalSangrias = sumMoney(turno.total_sangrias, vNum);

    await db.runAsync(
      `UPDATE TurnoCaixa 
       SET total_sangrias = ?, saldo_esperado_dinheiro = ?
       WHERE id = ? AND gerente_id = ?;`,
      [novoTotalSangrias, novoSaldoEsperado, turnoId, gerenteId]
    );
  } else {
    // SUPRIMENTO
    novoSaldoEsperado = sumMoney(turno.saldo_esperado_dinheiro, vNum);
    const novoTotalSuprimentos = sumMoney(turno.total_suprimentos, vNum);

    await db.runAsync(
      `UPDATE TurnoCaixa 
       SET total_suprimentos = ?, saldo_esperado_dinheiro = ?
       WHERE id = ? AND gerente_id = ?;`,
      [novoTotalSuprimentos, novoSaldoEsperado, turnoId, gerenteId]
    );
  }

  await db.runAsync(
    `INSERT INTO MovimentacaoCaixa (
      turno_caixa_id, gerente_id, operador_id, tipo_operacao, forma_pagamento, valor, saldo_apos, origem_referencia, justificativa, data_movimentacao
    ) VALUES (?, ?, ?, ?, 'dinheiro', ?, ?, ?, ?, ?);`,
    [turnoId, gerenteId, operadorId, tipoUpper, vNum, novoSaldoEsperado, `${tipoUpper}-${turnoId}`, just, now]
  );

  const atualizado = await obterTurnoPorId(turnoId, gerenteId, db);
  await syncOrEnqueue('TurnoCaixa', 'upsert', atualizado);
  return atualizado;
}

/**
 * Fecha e encerra o turno de caixa com auditoria de conferência cega e apuração de sobras/quebras
 */
export async function fecharTurnoCaixa({ turnoId, operadorId, saldoInformado, observacoes = null, gerenteId }, dbOverride = null) {
  const db = dbOverride || await getDb();
  const turno = await obterTurnoPorId(turnoId, gerenteId, db);
  if (!turno) throw new Error('Turno de caixa não encontrado.');
  if (turno.status === 'fechado') throw new Error('Este turno de caixa já foi fechado anteriormente.');

  const sInformado = parseFloat(saldoInformado != null ? saldoInformado : 0);
  if (isNaN(sInformado) || sInformado < 0) {
    throw new Error('Informe o saldo físico apurado em dinheiro para fechar o caixa.');
  }

  const sEsperado = turno.saldo_esperado_dinheiro;
  const diferenca = subtractMoney(sInformado, sEsperado); // Positivo = sobra, negativo = falta/quebra
  const now = new Date().toISOString();

  await db.runAsync(
    `UPDATE TurnoCaixa 
     SET status = 'fechado', saldo_fechamento_informado = ?, diferenca_fechamento = ?, 
         observacoes = COALESCE(?, observacoes), data_fechamento = ?
     WHERE id = ? AND gerente_id = ?;`,
    [sInformado, diferenca, observacoes, now, turnoId, gerenteId]
  );

  await db.runAsync(
    `INSERT INTO MovimentacaoCaixa (
      turno_caixa_id, gerente_id, operador_id, tipo_operacao, forma_pagamento, valor, saldo_apos, origem_referencia, justificativa, data_movimentacao
    ) VALUES (?, ?, ?, 'FECHAMENTO', 'dinheiro', ?, ?, ?, ?, ?);`,
    [
      turnoId, 
      gerenteId, 
      operadorId, 
      sInformado, 
      sInformado, 
      `FECHAMENTO-${turnoId}`, 
      `Fechamento de caixa. Esperado: R$ ${sEsperado.toFixed(2)}, Informado: R$ ${sInformado.toFixed(2)}, Diferença: R$ ${diferenca.toFixed(2)}`, 
      now
    ]
  );

  const encerrado = await obterTurnoPorId(turnoId, gerenteId, db);
  await syncOrEnqueue('TurnoCaixa', 'upsert', encerrado);
  return {
    turno: encerrado,
    saldoEsperado: sEsperado,
    saldoInformado: sInformado,
    diferenca,
    situacao: diferenca === 0 ? 'CONFERIDO_EXATO' : diferenca > 0 ? 'SOBRA_DE_CAIXA' : 'QUEBRA_DE_CAIXA'
  };
}

/**
 * Validação rigorosa do ciclo de vida: bloqueia expressamente o checkout se não houver caixa aberto e ativo
 */
export async function validarCaixaAtivoParaCheckout(operadorId, gerenteId, dbOverride = null) {
  const db = dbOverride || await getDb();

  // Busca o turno mais recente não fechado para o operador (ou gerente)
  const rows = await db.getAllAsync(
    `SELECT * FROM TurnoCaixa 
     WHERE operador_id = ? AND gerente_id = ? AND status IN ('aberto', 'bloqueado')
     ORDER BY id DESC LIMIT 1;`,
    [operadorId, gerenteId]
  );

  if (rows.length === 0) {
    throw new Error(
      'Checkout bloqueado: Não há caixa aberto para este operador. Abra o caixa com o fundo de troco inicial para registrar vendas.'
    );
  }

  const turno = rows[0];

  if (turno.status === 'bloqueado') {
    throw new Error(
      `Checkout bloqueado: O caixa #${turno.id} está temporariamente BLOQUEADO. Motivo: ${turno.motivo_bloqueio || 'Operação suspensa pelo operador/gerente'}. Desbloqueie o caixa para continuar.`
    );
  }

  if (turno.status !== 'aberto') {
    throw new Error(
      'Checkout bloqueado: O caixa não está em estado ativo para vendas.'
    );
  }

  return turno;
}

/**
 * Registra a venda e movimenta os acumuladores de dinheiro e outros no turno de caixa
 */
export async function registrarVendaNoCaixa({ turnoId, vendaId, valorDinheiro = 0, valorOutros = 0, operadorId, gerenteId }, dbOverride = null) {
  const db = dbOverride || await getDb();
  const vDinheiro = parseFloat(valorDinheiro) || 0;
  const vOutros = parseFloat(valorOutros) || 0;

  const turno = await obterTurnoPorId(turnoId, gerenteId, db);
  if (!turno) return;

  const novoTotalDinheiro = sumMoney(turno.total_vendas_dinheiro, vDinheiro);
  const novoTotalOutros = sumMoney(turno.total_vendas_outros, vOutros);
  const novoSaldoEsperado = sumMoney(turno.saldo_esperado_dinheiro, vDinheiro);

  await db.runAsync(
    `UPDATE TurnoCaixa 
     SET total_vendas_dinheiro = ?, total_vendas_outros = ?, saldo_esperado_dinheiro = ?
     WHERE id = ? AND gerente_id = ?;`,
    [novoTotalDinheiro, novoTotalOutros, novoSaldoEsperado, turnoId, gerenteId]
  );

  if (vDinheiro > 0) {
    await db.runAsync(
      `INSERT INTO MovimentacaoCaixa (
        turno_caixa_id, gerente_id, operador_id, tipo_operacao, forma_pagamento, valor, saldo_apos, origem_referencia, justificativa
      ) VALUES (?, ?, ?, 'VENDA', 'dinheiro', ?, ?, ?, 'Recebimento de venda em dinheiro no checkout');`,
      [turnoId, gerenteId, operadorId, vDinheiro, novoSaldoEsperado, `VENDA-${vendaId}`]
    );
  }
}

/**
 * Estorna venda do caixa (em caso de cancelamento)
 */
export async function estornarVendaDoCaixa({ turnoId, vendaId, valorDinheiro = 0, operadorId, gerenteId, justificativa }, dbOverride = null) {
  const db = dbOverride || await getDb();
  const vDinheiro = parseFloat(valorDinheiro) || 0;
  if (vDinheiro <= 0 || !turnoId) return;

  const turno = await obterTurnoPorId(turnoId, gerenteId, db);
  if (!turno) return;

  const novoSaldoEsperado = subtractMoney(turno.saldo_esperado_dinheiro, vDinheiro);
  const novoTotalDinheiro = Math.max(0, subtractMoney(turno.total_vendas_dinheiro, vDinheiro));

  await db.runAsync(
    `UPDATE TurnoCaixa 
     SET total_vendas_dinheiro = ?, saldo_esperado_dinheiro = ?
     WHERE id = ? AND gerente_id = ?;`,
    [novoTotalDinheiro, novoSaldoEsperado, turnoId, gerenteId]
  );

  await db.runAsync(
    `INSERT INTO MovimentacaoCaixa (
      turno_caixa_id, gerente_id, operador_id, tipo_operacao, forma_pagamento, valor, saldo_apos, origem_referencia, justificativa
    ) VALUES (?, ?, ?, 'ESTORNO', 'dinheiro', ?, ?, ?, ?);`,
    [turnoId, gerenteId, operadorId, vDinheiro, novoSaldoEsperado, `CANCEL-VENDA-${vendaId}`, justificativa || 'Estorno de venda cancelada']
  );
}

/**
 * Busca turno por ID
 */
export async function obterTurnoPorId(turnoId, gerenteId, dbOverride = null) {
  const db = dbOverride || await getDb();
  const rows = await db.getAllAsync(
    'SELECT * FROM TurnoCaixa WHERE id = ? AND gerente_id = ? LIMIT 1;',
    [turnoId, gerenteId]
  );
  return rows[0] || null;
}

/**
 * Busca o turno de caixa atualmente ativo (ou bloqueado) do operador
 */
export async function obterTurnoAtivo(operadorId, gerenteId, dbOverride = null) {
  const db = dbOverride || await getDb();
  const rows = await db.getAllAsync(
    `SELECT tc.*, u.nome as operador_nome 
     FROM TurnoCaixa tc
     JOIN Usuario u ON u.id = tc.operador_id
     WHERE tc.operador_id = ? AND tc.gerente_id = ? AND tc.status IN ('aberto', 'bloqueado')
     ORDER BY tc.id DESC LIMIT 1;`,
    [operadorId, gerenteId]
  );
  return rows[0] || null;
}

/**
 * Lista histórico de turnos de caixa para fechamento diário e auditoria
 */
export async function fetchHistoricoTurnos(gerenteId, limit = 20, dbOverride = null) {
  const db = dbOverride || await getDb();
  return await db.getAllAsync(
    `SELECT tc.*, u.nome as operador_nome 
     FROM TurnoCaixa tc
     JOIN Usuario u ON u.id = tc.operador_id
     WHERE tc.gerente_id = ?
     ORDER BY tc.id DESC LIMIT ?;`,
    [gerenteId, limit]
  );
}

/**
 * Auditoria completa das movimentações de um turno com checagem de consistência
 */
export async function auditarTurnoCaixa(turnoId, gerenteId, dbOverride = null) {
  const db = dbOverride || await getDb();
  const turno = await obterTurnoPorId(turnoId, gerenteId, db);
  if (!turno) throw new Error('Turno de caixa não encontrado.');

  const movimentacoes = await db.getAllAsync(
    `SELECT * FROM MovimentacaoCaixa 
     WHERE turno_caixa_id = ? AND gerente_id = ? 
     ORDER BY id ASC;`,
    [turnoId, gerenteId]
  );

  let saldoReconstruido = 0;
  const divergencias = [];

  for (let i = 0; i < movimentacoes.length; i++) {
    const m = movimentacoes[i];
    if (m.tipo_operacao === 'ABERTURA') {
      saldoReconstruido = m.valor;
    } else if (m.tipo_operacao === 'VENDA' || m.tipo_operacao === 'SUPRIMENTO') {
      saldoReconstruido = sumMoney(saldoReconstruido, m.valor);
    } else if (m.tipo_operacao === 'SANGRIA' || m.tipo_operacao === 'ESTORNO') {
      saldoReconstruido = subtractMoney(saldoReconstruido, m.valor);
    }

    if (Math.abs(saldoReconstruido - m.saldo_apos) > 0.01) {
      divergencias.push({
        movId: m.id,
        tipo: m.tipo_operacao,
        esperado: saldoReconstruido,
        registrado: m.saldo_apos
      });
    }
  }

  const saldoAtualBate = Math.abs(saldoReconstruido - turno.saldo_esperado_dinheiro) <= 0.01;

  return {
    turnoId,
    status: turno.status,
    saldoReconstruido,
    saldoRegistrado: turno.saldo_esperado_dinheiro,
    conforme: saldoAtualBate && divergencias.length === 0,
    totalMovimentacoes: movimentacoes.length,
    divergencias,
    movimentacoes
  };
}

