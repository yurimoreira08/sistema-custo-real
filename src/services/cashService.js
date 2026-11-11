import { getDb } from '../database/dbInstance';
import { syncOrEnqueue } from '../database/syncService';
import { round2, sumMoney, subtractMoney, toCents, fromCents } from '../utils/money';
import { hashPassword } from '../utils/crypto';

// ========================================================
// SERVIÇO DE CAIXA, TURNOS, AUDITORIA E BLOQUEIO (S06 / S07)
// Responsável: Francisco Yuri da Silva Mauriz / Base Conjunta
// ========================================================

// Tipos aceitos de movimentação de caixa
export const TIPOS_MOVIMENTACAO_CAIXA = ['ABERTURA', 'VENDA', 'SANGRIA', 'SUPRIMENTO', 'BLOQUEIO', 'DESBLOQUEIO', 'FECHAMENTO', 'ESTORNO', 'RECEBIMENTO_FIADO'];

function ddlMovimentacaoCaixa(nomeTabela) {
  return `CREATE TABLE IF NOT EXISTS ${nomeTabela} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      turno_caixa_id INTEGER NOT NULL,
      gerente_id INTEGER NOT NULL,
      operador_id INTEGER NOT NULL,
      tipo_operacao TEXT NOT NULL CHECK(tipo_operacao IN (${TIPOS_MOVIMENTACAO_CAIXA.map((t) => `'${t}'`).join(', ')})),
      forma_pagamento TEXT DEFAULT 'dinheiro',
      valor REAL NOT NULL,
      saldo_apos REAL NOT NULL,
      origem_referencia TEXT,
      justificativa TEXT,
      comprovante_hash TEXT,
      assinatura_digital TEXT,
      data_movimentacao TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (turno_caixa_id) REFERENCES TurnoCaixa(id) ON DELETE CASCADE,
      FOREIGN KEY (operador_id) REFERENCES Usuario(id)
    );`;
}

/**
 * Bancos criados antes do tipo RECEBIMENTO_FIADO têm um CHECK antigo em tipo_operacao.
 * O SQLite não altera CHECK com ALTER TABLE, então a tabela é reconstruída preservando os dados.
 */
async function migrarCheckMovimentacaoCaixa(db) {
  const rows = await db.getAllAsync("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'MovimentacaoCaixa';");
  const ddlAtual = rows[0]?.sql || '';
  if (!ddlAtual || ddlAtual.includes("'RECEBIMENTO_FIADO'")) return;

  const colunas = 'id, turno_caixa_id, gerente_id, operador_id, tipo_operacao, forma_pagamento, valor, saldo_apos, origem_referencia, justificativa, comprovante_hash, assinatura_digital, data_movimentacao';
  await db.execAsync('PRAGMA foreign_keys = OFF;');
  try {
    await db.withTransactionAsync(async () => {
      await db.execAsync(`
        DROP TABLE IF EXISTS MovimentacaoCaixa_migracao;
        ${ddlMovimentacaoCaixa('MovimentacaoCaixa_migracao')}
        INSERT INTO MovimentacaoCaixa_migracao (${colunas}) SELECT ${colunas} FROM MovimentacaoCaixa;
        DROP TABLE MovimentacaoCaixa;
        ALTER TABLE MovimentacaoCaixa_migracao RENAME TO MovimentacaoCaixa;
      `);
    });
  } finally {
    await db.execAsync('PRAGMA foreign_keys = ON;');
  }
}

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
      total_recebimentos_fiado REAL NOT NULL DEFAULT 0.0,
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

    ${ddlMovimentacaoCaixa('MovimentacaoCaixa')}

    CREATE INDEX IF NOT EXISTS idx_turno_operador_status ON TurnoCaixa(operador_id, status);
  `);

  // Migrações de colunas para bancos existentes (os índices de MovimentacaoCaixa
  // são criados depois, pois dependem de colunas adicionadas aqui)
  try {
    await db.execAsync("ALTER TABLE Venda ADD COLUMN turno_caixa_id INTEGER;");
  } catch (e) {}
  try {
    await db.execAsync("ALTER TABLE MovimentacaoCaixa ADD COLUMN comprovante_hash TEXT;");
  } catch (e) {}
  try {
    await db.execAsync("ALTER TABLE MovimentacaoCaixa ADD COLUMN assinatura_digital TEXT;");
  } catch (e) {}
  try {
    await db.execAsync("ALTER TABLE TurnoCaixa ADD COLUMN total_recebimentos_fiado REAL NOT NULL DEFAULT 0.0;");
  } catch (e) {}

  await migrarCheckMovimentacaoCaixa(db);
  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_mov_caixa_turno ON MovimentacaoCaixa(turno_caixa_id, data_movimentacao ASC);
    CREATE INDEX IF NOT EXISTS idx_mov_comprovante ON MovimentacaoCaixa(comprovante_hash);
  `);
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
 * Gera assinatura digital SHA-256 e hash canônico de auditoria para a movimentação de caixa
 */
export function gerarAssinaturaMovimentacao(movimentacao) {
  const payloadCanonico = [
    movimentacao.turno_caixa_id,
    movimentacao.gerente_id,
    movimentacao.operador_id,
    movimentacao.tipo_operacao,
    Number(movimentacao.valor || 0).toFixed(2),
    Number(movimentacao.saldo_apos || 0).toFixed(2),
    movimentacao.origem_referencia || '',
    movimentacao.justificativa || '',
    movimentacao.data_movimentacao || ''
  ].join('|');

  const hash = hashPassword(payloadCanonico);
  const tipoPrefixo = (movimentacao.tipo_operacao || 'MOV').substring(0, 3).toUpperCase();
  const codigoAutenticacao = `LC-${tipoPrefixo}-${hash.substring(0, 12).toUpperCase()}`;

  return {
    hash,
    codigoAutenticacao,
    payloadCanonico
  };
}

/**
 * Valida a autenticidade e integridade do comprovante digital da movimentação
 */
export function validarComprovanteDigital(movimentacao) {
  if (!movimentacao || !movimentacao.assinatura_digital) return false;
  const assin = gerarAssinaturaMovimentacao(movimentacao);
  return assin.hash === movimentacao.assinatura_digital;
}

/**
 * Busca e estrutura o comprovante assinado de uma movimentação específica de caixa
 */
export async function obterComprovanteMovimentacao(movId, gerenteId, dbOverride = null) {
  const db = dbOverride || await getDb();
  const rows = await db.getAllAsync(
    `SELECT m.*, u.nome as operador_nome, tc.status as turno_status, tc.data_abertura as turno_data_abertura
     FROM MovimentacaoCaixa m
     LEFT JOIN Usuario u ON u.id = m.operador_id
     LEFT JOIN TurnoCaixa tc ON tc.id = m.turno_caixa_id
     WHERE m.id = ? AND m.gerente_id = ? LIMIT 1;`,
    [movId, gerenteId]
  );
  if (rows.length === 0) return null;
  const m = rows[0];

  const valido = validarComprovanteDigital(m);
  return {
    id: m.id,
    turnoId: m.turno_caixa_id,
    tipo: m.tipo_operacao,
    formaPagamento: m.forma_pagamento || 'dinheiro',
    valor: m.valor,
    saldoApos: m.saldo_apos,
    origemReferencia: m.origem_referencia,
    justificativa: m.justificativa,
    dataMovimentacao: m.data_movimentacao,
    operadorId: m.operador_id,
    operadorNome: m.operador_nome || 'Operador',
    comprovanteHash: m.comprovante_hash,
    assinaturaDigital: m.assinatura_digital,
    valido,
    autenticado: true
  };
}

/**
 * Realiza suprimento (entrada de troco) ou sangria (retirada de segurança)
 * Gerando comprovante assinado digitalmente com hash SHA-256
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

  const origemRef = `${tipoUpper}-${turnoId}`;
  const movProvisoria = {
    turno_caixa_id: turnoId,
    gerente_id: gerenteId,
    operador_id: operadorId,
    tipo_operacao: tipoUpper,
    valor: vNum,
    saldo_apos: novoSaldoEsperado,
    origem_referencia: origemRef,
    justificativa: just,
    data_movimentacao: now
  };

  const { hash, codigoAutenticacao } = gerarAssinaturaMovimentacao(movProvisoria);

  const resMov = await db.runAsync(
    `INSERT INTO MovimentacaoCaixa (
      turno_caixa_id, gerente_id, operador_id, tipo_operacao, forma_pagamento, valor, saldo_apos, origem_referencia, justificativa, comprovante_hash, assinatura_digital, data_movimentacao
    ) VALUES (?, ?, ?, ?, 'dinheiro', ?, ?, ?, ?, ?, ?, ?);`,
    [turnoId, gerenteId, operadorId, tipoUpper, vNum, novoSaldoEsperado, origemRef, just, codigoAutenticacao, hash, now]
  );

  const movId = resMov.lastInsertRowId;
  const atualizado = await obterTurnoPorId(turnoId, gerenteId, db);

  const comprovante = {
    id: movId,
    turnoId,
    tipo: tipoUpper,
    valor: vNum,
    saldoAnterior: turno.saldo_esperado_dinheiro,
    saldoApos: novoSaldoEsperado,
    justificativa: just,
    dataMovimentacao: now,
    operadorId,
    gerenteId,
    comprovanteHash: codigoAutenticacao,
    assinaturaDigital: hash,
    codigoAutenticacao,
    valido: true
  };

  atualizado.comprovante = comprovante;
  atualizado.ultimoComprovante = comprovante;

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
 * Estorna venda do caixa (em caso de cancelamento ou devolução)
 * Garante que a dedução do valor seja refletida diretamente no saldo da gaveta de caixa atual
 */
export async function estornarVendaDoCaixa({ turnoId, vendaId, valorDinheiro = 0, operadorId, gerenteId, justificativa, origemReferencia }, dbOverride = null) {
  const db = dbOverride || await getDb();
  const vDinheiro = parseFloat(valorDinheiro) || 0;
  if (vDinheiro <= 0) return null;

  // 1. Localiza o turno ativo da gaveta atual
  let turnoAlvo = null;
  if (turnoId) {
    const t = await obterTurnoPorId(turnoId, gerenteId, db);
    if (t && t.status === 'aberto') {
      turnoAlvo = t;
    }
  }

  // Se o turno da venda estiver fechado ou não informado, reflete no turno de caixa atualmente aberto
  if (!turnoAlvo) {
    if (operadorId) {
      turnoAlvo = await obterTurnoAtivo(operadorId, gerenteId, db);
    }
    if (!turnoAlvo) {
      // Busca qualquer turno aberto do estabelecimento
      const abertos = await db.getAllAsync(
        "SELECT * FROM TurnoCaixa WHERE gerente_id = ? AND status = 'aberto' ORDER BY id DESC LIMIT 1;",
        [gerenteId]
      );
      if (abertos.length > 0) {
        turnoAlvo = abertos[0];
      }
    }
  }

  if (!turnoAlvo) {
    console.warn('[CashService] Nenhum turno de caixa aberto encontrado para abater estorno em dinheiro.');
    return null;
  }

  const novoSaldoEsperado = subtractMoney(turnoAlvo.saldo_esperado_dinheiro, vDinheiro);
  const novoTotalDinheiro = Math.max(0, subtractMoney(turnoAlvo.total_vendas_dinheiro, vDinheiro));
  const now = new Date().toISOString();
  const ref = origemReferencia || `CANCEL-VENDA-${vendaId}`;
  const just = justificativa || 'Estorno de venda cancelada';

  await db.runAsync(
    `UPDATE TurnoCaixa 
     SET total_vendas_dinheiro = ?, saldo_esperado_dinheiro = ?
     WHERE id = ? AND gerente_id = ?;`,
    [novoTotalDinheiro, novoSaldoEsperado, turnoAlvo.id, gerenteId]
  );

  const movProvisoria = {
    turno_caixa_id: turnoAlvo.id,
    gerente_id: gerenteId,
    operador_id: operadorId || turnoAlvo.operador_id,
    tipo_operacao: 'ESTORNO',
    valor: vDinheiro,
    saldo_apos: novoSaldoEsperado,
    origem_referencia: ref,
    justificativa: just,
    data_movimentacao: now
  };

  const { hash, codigoAutenticacao } = gerarAssinaturaMovimentacao(movProvisoria);

  const resMov = await db.runAsync(
    `INSERT INTO MovimentacaoCaixa (
      turno_caixa_id, gerente_id, operador_id, tipo_operacao, forma_pagamento, valor, saldo_apos, origem_referencia, justificativa, comprovante_hash, assinatura_digital, data_movimentacao
    ) VALUES (?, ?, ?, 'ESTORNO', 'dinheiro', ?, ?, ?, ?, ?, ?, ?);`,
    [turnoAlvo.id, gerenteId, operadorId || turnoAlvo.operador_id, vDinheiro, novoSaldoEsperado, ref, just, codigoAutenticacao, hash, now]
  );

  const atualizado = await obterTurnoPorId(turnoAlvo.id, gerenteId, db);
  await syncOrEnqueue('TurnoCaixa', 'upsert', atualizado);

  return {
    turno: atualizado,
    comprovanteEstorno: {
      id: resMov.lastInsertRowId,
      turnoId: turnoAlvo.id,
      tipo: 'ESTORNO',
      valor: vDinheiro,
      saldoApos: novoSaldoEsperado,
      origemReferencia: ref,
      justificativa: just,
      comprovanteHash: codigoAutenticacao,
      assinaturaDigital: hash,
      dataMovimentacao: now
    }
  };
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
 * Lança na gaveta o recebimento em dinheiro de uma dívida de fiado (amortização da caderneta).
 * Não conta como venda (a venda fiado já foi registrada no checkout), mas entra no saldo físico
 * esperado e gera comprovante assinado (SHA-256) como as demais movimentações de dinheiro.
 */
export async function registrarRecebimentoFiadoNoCaixa({ turnoId, operadorId, gerenteId, valor, pagamentoId, clienteNome }, dbOverride = null) {
  const db = dbOverride || await getDb();
  const vNum = parseFloat(valor);
  if (isNaN(vNum) || vNum <= 0) throw new Error('Valor do recebimento deve ser maior que zero.');

  const turno = await obterTurnoPorId(turnoId, gerenteId, db);
  if (!turno || turno.status !== 'aberto') {
    throw new Error('Recebimento em dinheiro exige um caixa aberto e ativo.');
  }

  const novoSaldoEsperado = sumMoney(turno.saldo_esperado_dinheiro, vNum);
  const novoTotalRecebimentos = sumMoney(turno.total_recebimentos_fiado || 0, vNum);
  const now = new Date().toISOString();

  await db.runAsync(
    `UPDATE TurnoCaixa
     SET total_recebimentos_fiado = ?, saldo_esperado_dinheiro = ?
     WHERE id = ? AND gerente_id = ?;`,
    [novoTotalRecebimentos, novoSaldoEsperado, turnoId, gerenteId]
  );

  const mov = {
    turno_caixa_id: turnoId,
    gerente_id: gerenteId,
    operador_id: operadorId,
    tipo_operacao: 'RECEBIMENTO_FIADO',
    valor: vNum,
    saldo_apos: novoSaldoEsperado,
    origem_referencia: `FIADO-PAG-${pagamentoId}`,
    justificativa: `Recebimento de fiado${clienteNome ? ` - ${clienteNome}` : ''}`,
    data_movimentacao: now
  };
  const { hash, codigoAutenticacao } = gerarAssinaturaMovimentacao(mov);

  const res = await db.runAsync(
    `INSERT INTO MovimentacaoCaixa (
      turno_caixa_id, gerente_id, operador_id, tipo_operacao, forma_pagamento, valor, saldo_apos, origem_referencia, justificativa, comprovante_hash, assinatura_digital, data_movimentacao
    ) VALUES (?, ?, ?, 'RECEBIMENTO_FIADO', 'dinheiro', ?, ?, ?, ?, ?, ?, ?);`,
    [turnoId, gerenteId, operadorId, vNum, novoSaldoEsperado, mov.origem_referencia, mov.justificativa, codigoAutenticacao, hash, now]
  );

  const atualizado = await obterTurnoPorId(turnoId, gerenteId, db);
  await syncOrEnqueue('TurnoCaixa', 'upsert', atualizado);
  return { movId: res.lastInsertRowId, turno: atualizado, codigoAutenticacao };
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
    } else if (m.tipo_operacao === 'VENDA' || m.tipo_operacao === 'SUPRIMENTO' || m.tipo_operacao === 'RECEBIMENTO_FIADO') {
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

