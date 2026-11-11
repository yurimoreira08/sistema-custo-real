import { getDb } from '../database/dbInstance';
import { syncOrEnqueue } from '../database/syncService';
import { validarDocumento, validarTelefone, formatarDocumento, formatarTelefone } from '../utils/validators';
import { obterTurnoAtivo, registrarRecebimentoFiadoNoCaixa } from './cashService';

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

    CREATE TABLE IF NOT EXISTS PagamentoDebitoCliente (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gerente_id INTEGER NOT NULL,
      cliente_id INTEGER NOT NULL,
      operador_id INTEGER NOT NULL,
      valor REAL NOT NULL,
      forma_pagamento TEXT NOT NULL DEFAULT 'dinheiro',
      observacoes TEXT,
      saldo_anterior REAL NOT NULL,
      saldo_resultante REAL NOT NULL,
      data_pagamento TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (cliente_id) REFERENCES Cliente(id),
      FOREIGN KEY (operador_id) REFERENCES Usuario(id)
    );
    CREATE INDEX IF NOT EXISTS idx_pag_debito_cliente ON PagamentoDebitoCliente(cliente_id, data_pagamento DESC);
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

  // Sem limitar a zero: se o cliente já pagou parte da dívida, o excedente estornado
  // vira crédito a favor dele (saldo_devedor negativo), abatido na próxima compra fiado.
  await db.runAsync(
    `UPDATE Cliente 
     SET saldo_devedor = ROUND(saldo_devedor - ?, 2), updated_at = datetime('now') 
     WHERE id = ? AND gerente_id = ?;`,
    [valorNum, clienteId, gerenteId]
  );

  const updated = await getClienteById(clienteId, gerenteId, db);
  if (updated) {
    await syncOrEnqueue('Cliente', 'upsert', updated);
  }
}

/**
 * Consulta o extrato de transações de fiado por cliente, exibindo histórico
 * cronológico de compras a prazo, estornos, pagamentos e saldo em aberto acumulado.
 */
export async function fetchExtratoCliente(clienteId, gerenteId, dbOverride = null) {
  const db = dbOverride || await getDb();
  const cliente = await getClienteById(clienteId, gerenteId, db);
  if (!cliente) {
    throw new Error('Cliente não encontrado para gerar extrato.');
  }

  // 1. Busca todas as compras com pagamento em Fiado
  const comprasFiado = await db.getAllAsync(
    `SELECT 
       v.id as venda_id,
       v.data_venda,
       v.canal_venda,
       v.valor_total as venda_valor_total,
       v.status as venda_status,
       pv.id as pagamento_id,
       pv.valor_bruto as valor_fiado,
       pv.estornado
     FROM PagamentoVenda pv
     JOIN Venda v ON v.id = pv.venda_id
     WHERE pv.forma_pagamento = 'fiado' 
       AND v.cliente_id = ? 
       AND v.gerente_id = ?
     ORDER BY v.data_venda ASC, v.id ASC;`,
    [clienteId, gerenteId]
  );

  // 2. Busca estornos de cancelamentos de vendas a prazo
  const cancelamentos = await db.getAllAsync(
    `SELECT 
       c.id as cancelamento_id,
       c.venda_id,
       c.justificativa,
       c.data_cancelamento,
       pv.valor_bruto as valor_estornado
     FROM CancelamentoVenda c
     JOIN Venda v ON v.id = c.venda_id
     JOIN PagamentoVenda pv ON pv.venda_id = v.id AND pv.forma_pagamento = 'fiado'
     WHERE v.cliente_id = ? AND v.gerente_id = ?
     ORDER BY c.data_cancelamento ASC, c.id ASC;`,
    [clienteId, gerenteId]
  );

  // 3. Busca devoluções com abatimento de fiado
  const devolucoes = await db.getAllAsync(
    `SELECT 
       d.id as devolucao_id,
       d.venda_id,
       d.motivo,
       d.valor_estornado,
       d.data_devolucao
     FROM DevolucaoVenda d
     JOIN Venda v ON v.id = d.venda_id
     WHERE v.cliente_id = ? AND v.gerente_id = ?
     ORDER BY d.data_devolucao ASC, d.id ASC;`,
    [clienteId, gerenteId]
  );

  // 4. Busca pagamentos / amortizações diretas de débito
  let pagamentosDebito = [];
  try {
    pagamentosDebito = await db.getAllAsync(
      `SELECT * FROM PagamentoDebitoCliente
       WHERE cliente_id = ? AND gerente_id = ?
       ORDER BY data_pagamento ASC, id ASC;`,
      [clienteId, gerenteId]
    );
  } catch (e) {}

  // 5. Consolida todas as movimentações em ordem cronológica
  const eventos = [];

  for (const c of comprasFiado) {
    eventos.push({
      tipo: 'COMPRA_FIADO',
      tipoOperacao: 'DEBITO', // Aumenta o saldo devedor
      data: c.data_venda,
      valor: parseFloat(c.valor_fiado) || 0,
      referencia: `Venda #${c.venda_id}`,
      vendaId: c.venda_id,
      descricao: `Compra a prazo (${c.canal_venda || 'balcão'}) - Venda #${c.venda_id}`,
      estornado: c.estornado === 1 || c.venda_status === 'cancelada'
    });
  }

  for (const c of cancelamentos) {
    eventos.push({
      tipo: 'CANCELAMENTO_ESTORNO',
      tipoOperacao: 'CREDITO', // Diminui o saldo devedor
      data: c.data_cancelamento,
      valor: parseFloat(c.valor_estornado) || 0,
      referencia: `Cancelamento Venda #${c.venda_id}`,
      vendaId: c.venda_id,
      descricao: `Estorno de venda cancelada: ${c.justificativa || 'Sem justificativa'}`
    });
  }

  for (const d of devolucoes) {
    eventos.push({
      tipo: 'DEVOLUCAO_ESTORNO',
      tipoOperacao: 'CREDITO', // Diminui o saldo devedor
      data: d.data_devolucao,
      valor: parseFloat(d.valor_estornado) || 0,
      referencia: `Devolução Venda #${d.venda_id}`,
      vendaId: d.venda_id,
      descricao: `Estorno devolução parcial: ${d.motivo || 'Devolução de mercadoria'}`
    });
  }

  for (const p of pagamentosDebito) {
    eventos.push({
      tipo: 'PAGAMENTO_DEBITO',
      tipoOperacao: 'CREDITO', // Diminui o saldo devedor
      data: p.data_pagamento,
      valor: parseFloat(p.valor) || 0,
      referencia: `Recibo #${p.id}`,
      descricao: `Amortização de fiado (${p.forma_pagamento.toUpperCase()}): ${p.observacoes || 'Pagamento de conta'}`
    });
  }

  // Ordena cronologicamente para reconstruir o saldo acumulado de forma exata
  eventos.sort((a, b) => new Date(a.data).getTime() - new Date(b.data).getTime());

  let saldoAcumulado = 0;
  let totalComprasFiado = 0;
  let totalEstornos = 0;
  let totalPagamentos = 0;

  const transacoesComSaldo = eventos.map((ev, idx) => {
    if (ev.tipoOperacao === 'DEBITO') {
      saldoAcumulado = Math.round((saldoAcumulado + ev.valor) * 100) / 100;
      totalComprasFiado = Math.round((totalComprasFiado + ev.valor) * 100) / 100;
    } else {
      saldoAcumulado = Math.round((saldoAcumulado - ev.valor) * 100) / 100;
      if (ev.tipo === 'PAGAMENTO_DEBITO') {
        totalPagamentos = Math.round((totalPagamentos + ev.valor) * 100) / 100;
      } else {
        totalEstornos = Math.round((totalEstornos + ev.valor) * 100) / 100;
      }
    }

    return {
      id: idx + 1,
      ...ev,
      saldoAcumuladoApos: saldoAcumulado
    };
  });

  const limite = Number(cliente.limite_fiado) || 0;
  const saldoAtual = Number(cliente.saldo_devedor) || 0;
  const limiteDisponivel = Math.max(0, Math.round((limite - saldoAtual) * 100) / 100);

  // Retorna transações em ordem decrescente (mais recentes primeiro para a UI)
  const transacoesDesc = [...transacoesComSaldo].reverse();

  return {
    cliente: {
      id: cliente.id,
      nome: cliente.nome,
      cpf: cliente.cpf,
      telefone: cliente.telefone,
      email: cliente.email,
      limiteFiado: limite,
      saldoDevedor: saldoAtual,
      bloqueadoInadimplente: cliente.bloqueado_inadimplente === 1,
      motivoBloqueio: cliente.motivo_bloqueio
    },
    totais: {
      totalComprasFiado,
      totalEstornos,
      totalPagamentos,
      saldoDevedorAtual: saldoAtual,
      limiteFiado: limite,
      limiteDisponivel
    },
    transacoes: transacoesDesc
  };
}

/**
 * Registra o recebimento de pagamento de débito/fiado de um cliente
 */
export async function registrarPagamentoDebitoCliente({ clienteId, valor, formaPagamento = 'dinheiro', operadorId, gerenteId, observacoes = null }, dbOverride = null) {
  const db = dbOverride || await getDb();
  const vNum = parseFloat(valor);
  if (isNaN(vNum) || vNum <= 0) {
    throw new Error('Valor do pagamento deve ser maior que zero.');
  }
  if (!operadorId) {
    throw new Error('Operador responsável pelo recebimento não informado.');
  }

  const cliente = await getClienteById(clienteId, gerenteId, db);
  if (!cliente) {
    throw new Error('Cliente não encontrado.');
  }

  const saldoAnt = Number(cliente.saldo_devedor) || 0;
  if (saldoAnt <= 0) {
    throw new Error(`O cliente "${cliente.nome}" não possui saldo devedor em aberto.`);
  }

  // Dinheiro recebido precisa entrar numa gaveta: exige caixa aberto do operador
  let turno = null;
  if (formaPagamento === 'dinheiro') {
    turno = await obterTurnoAtivo(operadorId, gerenteId, db);
    if (!turno || turno.status !== 'aberto') {
      throw new Error('Recebimento em dinheiro bloqueado: abra (ou desbloqueie) o seu caixa para registrar o valor na gaveta.');
    }
  }

  const valorEfetivo = Math.min(vNum, saldoAnt);
  const saldoRes = Math.max(0, Math.round((saldoAnt - valorEfetivo) * 100) / 100);
  const now = new Date().toISOString();

  const executar = async () => {
    const resPag = await db.runAsync(
      `INSERT INTO PagamentoDebitoCliente (
        gerente_id, cliente_id, operador_id, valor, forma_pagamento, observacoes, saldo_anterior, saldo_resultante, data_pagamento
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [gerenteId, clienteId, operadorId, valorEfetivo, formaPagamento, observacoes || 'Amortização de fiado', saldoAnt, saldoRes, now]
    );

    await db.runAsync(
      `UPDATE Cliente 
       SET saldo_devedor = ?, updated_at = datetime('now')
       WHERE id = ? AND gerente_id = ?;`,
      [saldoRes, clienteId, gerenteId]
    );

    if (turno) {
      await registrarRecebimentoFiadoNoCaixa({
        turnoId: turno.id,
        operadorId,
        gerenteId,
        valor: valorEfetivo,
        pagamentoId: resPag.lastInsertRowId,
        clienteNome: cliente.nome
      }, db);
    }
  };

  if (typeof db.withTransactionAsync === 'function') {
    await db.withTransactionAsync(executar);
  } else {
    await executar();
  }

  const updated = await getClienteById(clienteId, gerenteId, db);
  await syncOrEnqueue('Cliente', 'upsert', updated);

  return {
    cliente: updated,
    valorPago: valorEfetivo,
    saldoAnterior: saldoAnt,
    saldoRestante: saldoRes,
    dataPagamento: now,
    turnoCaixaId: turno ? turno.id : null
  };
}
