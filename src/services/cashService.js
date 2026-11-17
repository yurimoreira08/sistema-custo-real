import { getDb } from '../database/dbInstance';
import { syncOrEnqueue } from '../database/syncService';
import { round2, sumMoney, subtractMoney, toCents, fromCents } from '../utils/money';
import { hashPassword } from '../utils/crypto';
import { calcularTotalContagem, classificarDiferencaCaixa, TOLERANCIA_PADRAO } from '../utils/fechamentoCaixa';

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
  // S08 — Fechamento cego: contagem física por cédula/moeda e tipificação da diferença
  for (const ddl of [
    'ALTER TABLE TurnoCaixa ADD COLUMN contagem_cega_json TEXT;',
    'ALTER TABLE TurnoCaixa ADD COLUMN tipo_diferenca TEXT;',
    'ALTER TABLE TurnoCaixa ADD COLUMN classificacao_diferenca TEXT;',
    'ALTER TABLE TurnoCaixa ADD COLUMN justificativa_diferenca TEXT;',
  ]) {
    try { await db.execAsync(ddl); } catch (e) {}
  }

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

  // Sincroniza apenas as colunas do turno (o comprovante é só para a tela)
  await syncOrEnqueue('TurnoCaixa', 'upsert', { ...atualizado });

  atualizado.comprovante = comprovante;
  atualizado.ultimoComprovante = comprovante;
  return atualizado;
}

/**
 * Fecha o turno com CONFERÊNCIA CEGA e apuração de quebra de caixa (S08).
 *
 * O operador informa o físico contado — preferencialmente pela contagem de cédulas/moedas
 * (`contagemCedulas`, ex.: { '50': 2, '0.25': 4 }) ou pelo total (`saldoInformado`) — sem ver
 * o saldo contábil. Só depois o sistema compara com o esperado, tipifica (SOBRA/FALTA/CONFERIDO),
 * classifica a gravidade pela tolerância e exige justificativa quando a divergência é GRAVE.
 *
 * @returns {Promise<{ turno, saldoEsperado, saldoInformado, diferenca, situacao, tipo, gravidade,
 *                     descricao, contagem, comprovanteHash, relatorio }>}
 */
export async function fecharTurnoCaixa({
  turnoId,
  operadorId,
  saldoInformado,
  contagemCedulas = null,
  justificativaDiferenca = null,
  tolerancia = TOLERANCIA_PADRAO,
  observacoes = null,
  gerenteId
}, dbOverride = null) {
  const db = dbOverride || await getDb();
  const turno = await obterTurnoPorId(turnoId, gerenteId, db);
  if (!turno) throw new Error('Turno de caixa não encontrado.');
  if (turno.status === 'fechado') throw new Error('Este turno de caixa já foi fechado anteriormente.');

  // 1. Apura o físico contado (a contagem por cédula tem prioridade sobre o total digitado)
  let contagem = null;
  let sInformado;
  if (contagemCedulas && Object.keys(contagemCedulas).length > 0) {
    contagem = calcularTotalContagem(contagemCedulas);
    sInformado = contagem.total;
    if (saldoInformado != null && saldoInformado !== '' && toCents(saldoInformado) !== toCents(sInformado)) {
      throw new Error(
        `O total digitado (R$ ${Number(saldoInformado).toFixed(2)}) não confere com a contagem de cédulas e moedas (R$ ${sInformado.toFixed(2)}).`
      );
    }
  } else {
    sInformado = parseFloat(saldoInformado != null ? saldoInformado : NaN);
    if (isNaN(sInformado) || sInformado < 0) {
      throw new Error('Informe o saldo físico apurado em dinheiro para fechar o caixa.');
    }
    sInformado = round2(sInformado);
  }

  // 2. Compara com o contábil e tipifica a diferença
  const sEsperado = round2(turno.saldo_esperado_dinheiro);
  const diferenca = subtractMoney(sInformado, sEsperado); // Positivo = sobra, negativo = falta/quebra
  const classificacao = classificarDiferencaCaixa(diferenca, tolerancia);
  const justificativa = (justificativaDiferenca || '').trim() || null;

  if (classificacao.exigeJustificativa && !justificativa) {
    throw new Error(
      `${classificacao.tipo === 'SOBRA' ? 'Sobra' : 'Falta'} de R$ ${classificacao.valorAbsoluto.toFixed(2)} acima do limite de tolerância. Informe a justificativa da diferença para encerrar o turno.`
    );
  }

  const now = new Date().toISOString();
  const contagemJson = contagem ? JSON.stringify(contagem.itens) : null;

  // 3. Movimentação de FECHAMENTO assinada (SHA-256), como as demais operações de gaveta
  const mov = {
    turno_caixa_id: turnoId,
    gerente_id: gerenteId,
    operador_id: operadorId,
    tipo_operacao: 'FECHAMENTO',
    valor: sInformado,
    saldo_apos: sInformado,
    origem_referencia: `FECHAMENTO-${turnoId}`,
    justificativa:
      `Fechamento cego. Esperado: R$ ${sEsperado.toFixed(2)}, Contado: R$ ${sInformado.toFixed(2)}, ` +
      `Diferença: R$ ${diferenca.toFixed(2)} — ${classificacao.descricao}` +
      (justificativa ? `. Justificativa: ${justificativa}` : ''),
    data_movimentacao: now
  };
  const { hash, codigoAutenticacao } = gerarAssinaturaMovimentacao(mov);

  const executar = async () => {
    await db.runAsync(
      `UPDATE TurnoCaixa
       SET status = 'fechado', saldo_fechamento_informado = ?, diferenca_fechamento = ?,
           contagem_cega_json = ?, tipo_diferenca = ?, classificacao_diferenca = ?, justificativa_diferenca = ?,
           observacoes = COALESCE(?, observacoes), data_fechamento = ?
       WHERE id = ? AND gerente_id = ?;`,
      [sInformado, diferenca, contagemJson, classificacao.tipo, classificacao.gravidade, justificativa, observacoes, now, turnoId, gerenteId]
    );

    await db.runAsync(
      `INSERT INTO MovimentacaoCaixa (
        turno_caixa_id, gerente_id, operador_id, tipo_operacao, forma_pagamento, valor, saldo_apos, origem_referencia, justificativa, comprovante_hash, assinatura_digital, data_movimentacao
      ) VALUES (?, ?, ?, 'FECHAMENTO', 'dinheiro', ?, ?, ?, ?, ?, ?, ?);`,
      [turnoId, gerenteId, operadorId, sInformado, sInformado, mov.origem_referencia, mov.justificativa, codigoAutenticacao, hash, now]
    );
  };

  if (typeof db.withTransactionAsync === 'function') {
    await db.withTransactionAsync(executar);
  } else {
    await executar();
  }

  const encerrado = await obterTurnoPorId(turnoId, gerenteId, db);
  await syncOrEnqueue('TurnoCaixa', 'upsert', encerrado);

  const relatorio = await gerarRelatorioFechamento(turnoId, gerenteId, db);
  return {
    turno: encerrado,
    saldoEsperado: sEsperado,
    saldoInformado: sInformado,
    diferenca,
    situacao: classificacao.situacao,
    tipo: classificacao.tipo,
    gravidade: classificacao.gravidade,
    descricao: classificacao.descricao,
    contagem,
    comprovanteHash: codigoAutenticacao,
    relatorio
  };
}

/**
 * Relatório detalhado de encerramento do turno (S08): composição do saldo contábil,
 * vendas por forma de pagamento, movimentações por tipo, conferência cega e auditoria.
 * Funciona também para turnos ainda abertos (sem o bloco de conferência).
 */
export async function gerarRelatorioFechamento(turnoId, gerenteId, dbOverride = null) {
  const db = dbOverride || await getDb();
  const rows = await db.getAllAsync(
    `SELECT tc.*, u.nome as operador_nome
     FROM TurnoCaixa tc LEFT JOIN Usuario u ON u.id = tc.operador_id
     WHERE tc.id = ? AND tc.gerente_id = ? LIMIT 1;`,
    [turnoId, gerenteId]
  );
  const turno = rows[0];
  if (!turno) throw new Error('Turno de caixa não encontrado.');

  // Movimentações agrupadas por tipo (quantidade e total)
  const movsPorTipo = await db.getAllAsync(
    `SELECT tipo_operacao as tipo, COUNT(*) as quantidade, ROUND(COALESCE(SUM(valor), 0), 2) as total
     FROM MovimentacaoCaixa WHERE turno_caixa_id = ? AND gerente_id = ?
     GROUP BY tipo_operacao ORDER BY tipo_operacao;`,
    [turnoId, gerenteId]
  );
  const totalPorTipo = (t) => round2(movsPorTipo.find((m) => m.tipo === t)?.total || 0);

  // Vendas do turno e recebimentos por forma de pagamento (exceto estornados)
  const vendas = await db.getAllAsync(
    `SELECT COUNT(*) as quantidade, ROUND(COALESCE(SUM(valor_total), 0), 2) as total
     FROM Venda WHERE turno_caixa_id = ? AND gerente_id = ? AND COALESCE(status, 'concluida') != 'cancelada';`,
    [turnoId, gerenteId]
  );
  const porForma = await db.getAllAsync(
    `SELECT pv.forma_pagamento as forma, COUNT(*) as quantidade, ROUND(SUM(pv.valor_bruto), 2) as total
     FROM PagamentoVenda pv JOIN Venda v ON v.id = pv.venda_id
     WHERE v.turno_caixa_id = ? AND v.gerente_id = ? AND pv.estornado = 0
     GROUP BY pv.forma_pagamento ORDER BY total DESC;`,
    [turnoId, gerenteId]
  );

  const inicio = new Date(turno.data_abertura).getTime();
  const fim = turno.data_fechamento ? new Date(turno.data_fechamento).getTime() : Date.now();
  const auditoria = await auditarTurnoCaixa(turnoId, gerenteId, db);

  let conferencia = null;
  if (turno.status === 'fechado') {
    const classificacao = classificarDiferencaCaixa(turno.diferenca_fechamento || 0);
    let contagemItens = [];
    try { contagemItens = turno.contagem_cega_json ? JSON.parse(turno.contagem_cega_json) : []; } catch (e) {}
    conferencia = {
      saldoEsperado: round2(turno.saldo_esperado_dinheiro),
      saldoContado: round2(turno.saldo_fechamento_informado),
      diferenca: round2(turno.diferenca_fechamento),
      tipo: turno.tipo_diferenca || classificacao.tipo,
      gravidade: turno.classificacao_diferenca || classificacao.gravidade,
      descricao: classificacao.descricao,
      justificativa: turno.justificativa_diferenca || null,
      contagemPorCedula: contagemItens,
      contagemDetalhada: contagemItens.length > 0
    };
  }

  return {
    turnoId: turno.id,
    status: turno.status,
    operadorId: turno.operador_id,
    operadorNome: turno.operador_nome || 'Operador',
    dataAbertura: turno.data_abertura,
    dataFechamento: turno.data_fechamento,
    duracaoMinutos: Math.max(0, Math.round((fim - inicio) / 60000)),
    composicaoSaldo: {
      fundoTrocoInicial: round2(turno.fundo_troco_inicial),
      vendasDinheiro: round2(turno.total_vendas_dinheiro),
      suprimentos: round2(turno.total_suprimentos),
      recebimentosFiado: round2(turno.total_recebimentos_fiado || 0),
      sangrias: round2(turno.total_sangrias),
      estornos: totalPorTipo('ESTORNO'),
      saldoEsperado: round2(turno.saldo_esperado_dinheiro)
    },
    vendas: {
      quantidade: vendas[0]?.quantidade || 0,
      total: round2(vendas[0]?.total || 0),
      totalOutrosMeios: round2(turno.total_vendas_outros),
      porFormaPagamento: porForma.map((f) => ({ ...f, total: round2(f.total) }))
    },
    movimentacoesPorTipo: movsPorTipo,
    conferencia,
    auditoria: {
      conforme: auditoria.conforme,
      totalMovimentacoes: auditoria.totalMovimentacoes,
      divergencias: auditoria.divergencias
    },
    observacoes: turno.observacoes || null
  };
}

/**
 * Converte o relatório de encerramento em texto simples (para compartilhar ou imprimir).
 */
export function formatarRelatorioFechamentoTexto(rel) {
  const m = (v) => `R$ ${Number(v || 0).toFixed(2).replace('.', ',')}`;
  const c = rel.composicaoSaldo;
  const linhas = [
    `RELATÓRIO DE FECHAMENTO — TURNO #${rel.turnoId}`,
    `Operador: ${rel.operadorNome}`,
    `Abertura: ${new Date(rel.dataAbertura).toLocaleString('pt-BR')}`,
    rel.dataFechamento ? `Fechamento: ${new Date(rel.dataFechamento).toLocaleString('pt-BR')}` : 'Turno ainda aberto',
    `Duração: ${Math.floor(rel.duracaoMinutos / 60)}h${String(rel.duracaoMinutos % 60).padStart(2, '0')}`,
    '',
    'COMPOSIÇÃO DO SALDO CONTÁBIL (DINHEIRO)',
    `(+) Fundo de troco: ${m(c.fundoTrocoInicial)}`,
    `(+) Vendas em dinheiro (líq. de estornos): ${m(c.vendasDinheiro)}`,
    `(+) Suprimentos: ${m(c.suprimentos)}`,
    `(+) Recebimentos de fiado: ${m(c.recebimentosFiado)}`,
    `(−) Sangrias: ${m(c.sangrias)}`,
    `    Estornos já deduzidos: ${m(c.estornos)}`,
    `(=) Saldo esperado: ${m(c.saldoEsperado)}`,
    '',
    `VENDAS: ${rel.vendas.quantidade} venda(s) — ${m(rel.vendas.total)}`,
    ...rel.vendas.porFormaPagamento.map((f) => `  • ${f.forma}: ${m(f.total)} (${f.quantidade})`),
  ];
  if (rel.conferencia) {
    const k = rel.conferencia;
    linhas.push('', 'CONFERÊNCIA CEGA');
    for (const it of k.contagemPorCedula) linhas.push(`  ${it.rotulo} × ${it.quantidade} = ${m(it.subtotal)}`);
    linhas.push(
      `Contado (físico): ${m(k.saldoContado)}`,
      `Esperado (contábil): ${m(k.saldoEsperado)}`,
      `Diferença: ${m(k.diferenca)} — ${k.descricao}`
    );
    if (k.justificativa) linhas.push(`Justificativa: ${k.justificativa}`);
  }
  linhas.push('', `Auditoria das movimentações: ${rel.auditoria.conforme ? 'CONFORME' : 'DIVERGÊNCIA'} (${rel.auditoria.totalMovimentacoes} mov.)`);
  return linhas.join('\n');
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

    // FECHAMENTO guarda o físico contado em saldo_apos (não o contábil): fica fora da comparação
    if (m.tipo_operacao !== 'FECHAMENTO' && Math.abs(saldoReconstruido - m.saldo_apos) > 0.01) {
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

