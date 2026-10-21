import { getDb } from '../database/dbInstance';
import { syncOrEnqueue } from '../database/syncService';
import { hashPassword } from '../utils/crypto';
import { 
  validarPagamentosMistos, 
  registrarPagamentosVenda, 
  estornarPagamentosVenda 
} from './paymentService';
import { 
  registrarMovimentacaoKardex 
} from './stockService';
import { estornarFiado } from './clientService';

// ========================================================
// SERVIÇO DE VENDAS, CARRINHO, CANCELAMENTO E DEVOLUÇÕES (S01 A S04)
// Integrante: Yuri Kauan Ibiapino Moreira
// ========================================================

/**
 * Inicializa tabelas adicionais de vendas, cancelamento e devoluções
 */
export async function initSaleTables(db) {
  // Ajusta colunas na tabela Venda existente se necessário
  try {
    await db.execAsync("ALTER TABLE Venda ADD COLUMN canal_venda TEXT NOT NULL DEFAULT 'balcao';");
  } catch (e) {}
  try {
    await db.execAsync("ALTER TABLE Venda ADD COLUMN cliente_id INTEGER;");
  } catch (e) {}
  try {
    await db.execAsync("ALTER TABLE Venda ADD COLUMN valor_bruto REAL NOT NULL DEFAULT 0.0;");
  } catch (e) {}
  try {
    await db.execAsync("ALTER TABLE Venda ADD COLUMN desconto REAL NOT NULL DEFAULT 0.0;");
  } catch (e) {}
  try {
    await db.execAsync("ALTER TABLE Venda ADD COLUMN total_taxas REAL NOT NULL DEFAULT 0.0;");
  } catch (e) {}
  try {
    await db.execAsync("ALTER TABLE Venda ADD COLUMN valor_liquido REAL NOT NULL DEFAULT 0.0;");
  } catch (e) {}
  try {
    await db.execAsync("ALTER TABLE Venda ADD COLUMN status TEXT NOT NULL DEFAULT 'concluida';");
  } catch (e) {}
  try {
    await db.execAsync("ALTER TABLE Venda ADD COLUMN usuario_id INTEGER;");
  } catch (e) {}

  // Ajusta colunas na tabela ItensVenda
  try {
    await db.execAsync("ALTER TABLE ItensVenda ADD COLUMN quantidade_devolvida REAL NOT NULL DEFAULT 0.0;");
  } catch (e) {}
  try {
    await db.execAsync("ALTER TABLE ItensVenda ADD COLUMN desconto_item REAL NOT NULL DEFAULT 0.0;");
  } catch (e) {}
  try {
    await db.execAsync("ALTER TABLE ItensVenda ADD COLUMN subtotal REAL NOT NULL DEFAULT 0.0;");
  } catch (e) {}

  // Tabela de Cancelamento
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS CancelamentoVenda (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gerente_id INTEGER NOT NULL,
      venda_id INTEGER NOT NULL,
      usuario_id INTEGER NOT NULL,
      justificativa TEXT NOT NULL,
      data_cancelamento TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (venda_id) REFERENCES Venda(id) ON DELETE CASCADE,
      FOREIGN KEY (usuario_id) REFERENCES Usuario(id)
    );

    CREATE TABLE IF NOT EXISTS DevolucaoVenda (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gerente_id INTEGER NOT NULL,
      venda_id INTEGER NOT NULL,
      usuario_id INTEGER NOT NULL,
      motivo TEXT NOT NULL,
      valor_estornado REAL NOT NULL,
      cmv_estornado REAL NOT NULL DEFAULT 0.0,
      taxas_estornadas REAL NOT NULL DEFAULT 0.0,
      data_devolucao TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (venda_id) REFERENCES Venda(id) ON DELETE CASCADE,
      FOREIGN KEY (usuario_id) REFERENCES Usuario(id)
    );

    CREATE TABLE IF NOT EXISTS ItensDevolucao (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gerente_id INTEGER NOT NULL,
      devolucao_id INTEGER NOT NULL,
      item_venda_id INTEGER NOT NULL,
      produto_id INTEGER NOT NULL,
      quantidade REAL NOT NULL,
      valor_unitario REAL NOT NULL,
      custo_unitario REAL NOT NULL,
      apto_retorno INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (devolucao_id) REFERENCES DevolucaoVenda(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_venda_status ON Venda(status);
    CREATE INDEX IF NOT EXISTS idx_cancel_venda ON CancelamentoVenda(venda_id);
    CREATE INDEX IF NOT EXISTS idx_devolucao_venda ON DevolucaoVenda(venda_id);
  `);
}

// --------------------------------------------------------
// 1. GESTÃO DE ESTADO DO CARRINHO E SUBTOTAL (Yuri Moreira S02)
// --------------------------------------------------------

/**
 * Recalcula e valida os itens do carrinho no backend utilizando os preços reais cadastrados.
 * Não confia nos preços ou subtotais enviados pelo frontend.
 */
export async function validarERecalcularCarrinho(cartItems, descontoGlobal = 0, gerenteId, dbOverride = null) {
  const db = dbOverride || await getDb();
  if (!Array.isArray(cartItems) || cartItems.length === 0) {
    throw new Error('O carrinho está vazio.');
  }

  let valorBrutoTotal = 0;
  let cmvTotalCalculado = 0;
  const itensValidados = [];

  for (const item of cartItems) {
    const produtoId = item.id || item.produto_id;
    const qtdDesejada = parseFloat(item.quantidade) || 0;

    if (isNaN(qtdDesejada) || qtdDesejada <= 0) {
      throw new Error(`Quantidade inválida para o item "${item.nome || produtoId}".`);
    }

    const prodRows = await db.getAllAsync(
      'SELECT id, nome, preco_custo, preco_venda, estoque FROM Produto WHERE id = ? AND gerente_id = ?;',
      [produtoId, gerenteId]
    );

    if (prodRows.length === 0) {
      throw new Error(`Produto ID ${produtoId} não encontrado no catálogo deste comércio.`);
    }

    const prod = prodRows[0];
    const estoqueAtual = parseFloat(prod.estoque) || 0;

    // Validação estrita de estoque (sem debitar antes da finalização)
    if (qtdDesejada > estoqueAtual) {
      throw new Error(
        `Estoque insuficiente para "${prod.nome}". Disponível: ${estoqueAtual}, Solicitado: ${qtdDesejada}.`
      );
    }

    const precoVendaReal = parseFloat(prod.preco_venda);
    const precoCustoReal = parseFloat(prod.preco_custo);
    const subtotalBrutoItem = parseFloat((precoVendaReal * qtdDesejada).toFixed(2));
    const cmvItem = parseFloat((precoCustoReal * qtdDesejada).toFixed(2));

    valorBrutoTotal += subtotalBrutoItem;
    cmvTotalCalculado += cmvItem;

    itensValidados.push({
      produto_id: prod.id,
      nome: prod.nome,
      quantidade: qtdDesejada,
      preco_unitario: precoVendaReal,
      preco_custo_unitario: precoCustoReal,
      subtotal: subtotalBrutoItem,
      desconto_item: 0.0,
      cmv_total_item: cmvItem,
      estoque_disponivel: estoqueAtual
    });
  }

  valorBrutoTotal = parseFloat(valorBrutoTotal.toFixed(2));
  cmvTotalCalculado = parseFloat(cmvTotalCalculado.toFixed(2));

  const desc = Math.max(0, parseFloat(descontoGlobal) || 0);
  if (desc > valorBrutoTotal) {
    throw new Error(`Desconto (R$ ${desc.toFixed(2)}) não pode ser superior ao valor bruto da venda (R$ ${valorBrutoTotal.toFixed(2)}).`);
  }

  const valorTotalFinal = parseFloat((valorBrutoTotal - desc).toFixed(2));

  return {
    itens: itensValidados,
    totalItensCount: itensValidados.reduce((acc, it) => acc + it.quantidade, 0),
    valorBruto: valorBrutoTotal,
    desconto: desc,
    valorTotal: valorTotalFinal,
    cmvEstimado: cmvTotalCalculado
  };
}

// --------------------------------------------------------
// 2. FINALIZAÇÃO DE VENDA ATÔMICA (Yuri Moreira & Yuri Mauriz S03)
// --------------------------------------------------------

export async function finalizarVendaCompleta(dadosVenda, gerenteId, dbOverride = null) {
  const db = dbOverride || await getDb();
  const {
    carrinho,
    pagamentos,
    clienteId = null,
    descontoGlobal = 0,
    canalVenda = 'balcao',
    usuarioId = null,
    dataVenda = null
  } = dadosVenda;

  // 1. Validação do carrinho no backend
  const carrinhoValidado = await validarERecalcularCarrinho(carrinho, descontoGlobal, gerenteId, db);

  // 2. Validação dos pagamentos mistos e taxas no backend
  const pagamentosValidados = await validarPagamentosMistos(
    pagamentos,
    carrinhoValidado.valorTotal,
    clienteId,
    gerenteId,
    db
  );

  let vendaId = null;
  const now = dataVenda || new Date().toISOString();

  const runInsideTx = async () => {
    // 3. Inserir cabeçalho da Venda
    const resVenda = await db.runAsync(
      `INSERT INTO Venda 
       (gerente_id, usuario_id, cliente_id, canal_venda, data_venda, valor_bruto, desconto, valor_total, total_taxas, valor_liquido, valor_cmv, valor_opex, valor_lucro, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'concluida');`,
      [
        gerenteId,
        usuarioId,
        clienteId || null,
        canalVenda || 'balcao',
        now,
        carrinhoValidado.valorBruto,
        carrinhoValidado.desconto,
        carrinhoValidado.valorTotal,
        pagamentosValidados.totalTaxas,
        pagamentosValidados.totalLiquido,
        carrinhoValidado.cmvEstimado,
        0.0, // OpEx adicional se houver
        parseFloat((pagamentosValidados.totalLiquido - carrinhoValidado.cmvEstimado).toFixed(2))
      ]
    );
    vendaId = resVenda.lastInsertRowId;

    // 4. Inserir itens da venda e dar baixa no estoque com lançamento no Kardex
    for (const item of carrinhoValidado.itens) {
      const prodRows = await db.getAllAsync(
        'SELECT estoque FROM Produto WHERE id = ? AND gerente_id = ?;',
        [item.produto_id, gerenteId]
      );
      const estoqueAtual = parseFloat(prodRows[0]?.estoque) || 0;
      const novoEstoque = parseFloat((estoqueAtual - item.quantidade).toFixed(3));

      if (novoEstoque < 0) {
        throw new Error(`Estoque insuficiente de última hora para "${item.nome}". Saldo: ${estoqueAtual}.`);
      }

      await db.runAsync(
        'UPDATE Produto SET estoque = ?, updated_at = datetime(\'now\') WHERE id = ? AND gerente_id = ?;',
        [novoEstoque, item.produto_id, gerenteId]
      );

      await db.runAsync(
        `INSERT INTO ItensVenda 
         (gerente_id, venda_id, produto_id, quantidade, quantidade_devolvida, preco_unitario, preco_custo_unitario, desconto_item, subtotal)
         VALUES (?, ?, ?, ?, 0.0, ?, ?, ?, ?);`,
        [
          gerenteId,
          vendaId,
          item.produto_id,
          item.quantidade,
          item.preco_unitario,
          item.preco_custo_unitario,
          item.desconto_item,
          item.subtotal
        ]
      );

      // Movimentação no Kardex
      await registrarMovimentacaoKardex({
        gerenteId,
        produtoId: item.produto_id,
        tipoMovimentacao: 'SAIDA_VENDA',
        quantidade: -item.quantidade,
        saldoAnterior: estoqueAtual,
        saldoResultante: novoEstoque,
        custoUnitario: item.preco_custo_unitario,
        origemTipo: 'venda',
        origemId: vendaId,
        justificativa: `Venda #${vendaId} - Canal: ${canalVenda || 'balcao'}`,
        responsavelId: usuarioId,
        dataMovimentacao: now
      }, db);
    }

    // 5. Inserir pagamentos individuais e debitar fiado na caderneta se houver
    await registrarPagamentosVenda(vendaId, pagamentosValidados.pagamentos, clienteId, gerenteId, db);
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
    vendaId,
    dataVenda: now,
    valorTotal: carrinhoValidado.valorTotal,
    cmv: carrinhoValidado.cmvEstimado,
    taxas: pagamentosValidados.totalTaxas,
    valorLiquido: pagamentosValidados.totalLiquido,
    pagamentos: pagamentosValidados.pagamentos,
    itens: carrinhoValidado.itens
  };
}

// --------------------------------------------------------
// 3. CANCELAMENTO DE VENDAS COM SENHA GERENCIAL (Yuri Moreira S03)
// --------------------------------------------------------

/**
 * Cancela uma venda finalizada, exigindo credencial de gerente,
 * justificativa obrigatória, estornando pagamentos (e fiado) e
 * reincorporando estoque com registro no Kardex.
 */
export async function cancelarVendaComAutorizacao(dadosCancelamento, dbOverride = null) {
  const db = dbOverride || await getDb();
  const {
    vendaId,
    gerenteId,
    usuarioId,
    senhaGerente,
    justificativa
  } = dadosCancelamento;

  if (!vendaId) throw new Error('ID da venda é obrigatório.');
  if (!justificativa || justificativa.trim().length < 5) {
    throw new Error('Justificativa é obrigatória e deve ter pelo menos 5 caracteres.');
  }

  // Validação segura da credencial gerencial
  const gerentes = await db.getAllAsync(
    'SELECT * FROM Usuario WHERE id = ? AND cargo = \'gerente\';',
    [usuarioId]
  );
  if (gerentes.length === 0) {
    throw new Error('Apenas usuários com cargo de Gerente podem autorizar o cancelamento de vendas.');
  }

  const gerente = gerentes[0];
  const hash = hashPassword(senhaGerente || '');
  if (gerente.senha !== hash) {
    throw new Error('Senha gerencial incorreta. Cancelamento não autorizado.');
  }

  // Verifica se a venda existe e seu status atual
  const vendaRows = await db.getAllAsync(
    'SELECT * FROM Venda WHERE id = ? AND gerente_id = ?;',
    [vendaId, gerenteId]
  );
  if (vendaRows.length === 0) {
    throw new Error('Venda não encontrada.');
  }
  const venda = vendaRows[0];
  if (venda.status === 'cancelada') {
    throw new Error('Esta venda já foi cancelada anteriormente.');
  }

  const now = new Date().toISOString();

  const runInsideTx = async () => {
    // 1. Atualizar status da Venda para cancelada
    await db.runAsync(
      'UPDATE Venda SET status = \'cancelada\' WHERE id = ? AND gerente_id = ?;',
      [vendaId, gerenteId]
    );

    // 2. Registrar na tabela de auditoria de cancelamento
    await db.runAsync(
      `INSERT INTO CancelamentoVenda (gerente_id, venda_id, usuario_id, justificativa, data_cancelamento)
       VALUES (?, ?, ?, ?, ?);`,
      [gerenteId, vendaId, usuarioId, justificativa.trim(), now]
    );

    // 3. Estornar pagamentos e fiado da caderneta
    await estornarPagamentosVenda(vendaId, venda.cliente_id, gerenteId, db);

    // 4. Reverter o estoque dos itens vendidos via Kardex
    const itens = await db.getAllAsync(
      'SELECT * FROM ItensVenda WHERE venda_id = ?;',
      [vendaId]
    );

    for (const item of itens) {
      // Devolve apenas a quantidade que não foi devolvida anteriormente
      const qtdRetorno = item.quantidade - (item.quantidade_devolvida || 0);
      if (qtdRetorno <= 0) continue;

      const prodRows = await db.getAllAsync(
        'SELECT estoque FROM Produto WHERE id = ? AND gerente_id = ?;',
        [item.produto_id, gerenteId]
      );
      const saldoAnterior = parseFloat(prodRows[0]?.estoque) || 0;
      const saldoResultante = parseFloat((saldoAnterior + qtdRetorno).toFixed(3));

      await db.runAsync(
        'UPDATE Produto SET estoque = ?, updated_at = datetime(\'now\') WHERE id = ? AND gerente_id = ?;',
        [saldoResultante, item.produto_id, gerenteId]
      );

      await registrarMovimentacaoKardex({
        gerenteId,
        produtoId: item.produto_id,
        tipoMovimentacao: 'ESTORNO_VENDA',
        quantidade: qtdRetorno,
        saldoAnterior,
        saldoResultante,
        custoUnitario: item.preco_custo_unitario,
        origemTipo: 'cancelamento',
        origemId: vendaId,
        justificativa: `Cancelamento Venda #${vendaId}: ${justificativa.trim()}`,
        responsavelId: usuarioId,
        dataMovimentacao: now
      }, db);
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
    sucesso: true,
    vendaId,
    status: 'cancelada',
    dataCancelamento: now,
    responsavel: gerente.nome
  };
}

// --------------------------------------------------------
// 4. DEVOLUÇÃO PARCIAL E ESTORNOS (Yuri Moreira S04)
// --------------------------------------------------------

/**
 * Processa a devolução parcial de itens de uma venda, com cálculo proporcional
 * de estorno financeiro e decisão de reincorporação ao estoque para revenda (apto vs avariado).
 */
export async function processarDevolucaoParcial(dadosDevolucao, gerenteId, dbOverride = null) {
  const db = dbOverride || await getDb();
  const {
    vendaId,
    usuarioId,
    motivo,
    itensDevolver // [{ itemVendaId, quantidade, aptoRetorno }]
  } = dadosDevolucao;

  if (!vendaId) throw new Error('Venda não informada.');
  if (!motivo || motivo.trim().length < 5) {
    throw new Error('Motivo da devolução é obrigatório e deve ter ao menos 5 caracteres.');
  }
  if (!Array.isArray(itensDevolver) || itensDevolver.length === 0) {
    throw new Error('Informe ao menos um item para devolução.');
  }

  const vendaRows = await db.getAllAsync(
    'SELECT * FROM Venda WHERE id = ? AND gerente_id = ?;',
    [vendaId, gerenteId]
  );
  if (vendaRows.length === 0) throw new Error('Venda não encontrada.');
  const venda = vendaRows[0];
  if (venda.status === 'cancelada') {
    throw new Error('Não é possível realizar devolução de uma venda já cancelada.');
  }

  let devolucaoId = null;
  let valorTotalEstorno = 0;
  let cmvTotalEstorno = 0;
  const itensProcessados = [];
  const now = new Date().toISOString();

  const runInsideTx = async () => {
    // 1. Validação de cada item
    for (const itemDev of itensDevolver) {
      const itemRows = await db.getAllAsync(
        'SELECT * FROM ItensVenda WHERE id = ? AND venda_id = ?;',
        [itemDev.itemVendaId, vendaId]
      );
      if (itemRows.length === 0) {
        throw new Error(`Item de venda ID ${itemDev.itemVendaId} não pertence à venda #${vendaId}.`);
      }
      const itemVenda = itemRows[0];
      const qtdDevolver = parseFloat(itemDev.quantidade);
      if (isNaN(qtdDevolver) || qtdDevolver <= 0) {
        throw new Error('Quantidade a devolver deve ser maior que zero.');
      }

      const qtdJaDevolvida = parseFloat(itemVenda.quantidade_devolvida) || 0;
      const saldoDevoluvel = parseFloat((itemVenda.quantidade - qtdJaDevolvida).toFixed(3));

      if (qtdDevolver > saldoDevoluvel) {
        throw new Error(
          `Quantidade solicitada (${qtdDevolver}) excede o saldo disponível para devolução (${saldoDevoluvel}) para o item ID ${itemDev.itemVendaId}.`
        );
      }

      const valorItemEstornado = parseFloat((qtdDevolver * itemVenda.preco_unitario).toFixed(2));
      const cmvItemEstornado = parseFloat((qtdDevolver * itemVenda.preco_custo_unitario).toFixed(2));

      valorTotalEstorno += valorItemEstornado;
      cmvTotalEstorno += cmvItemEstornado;

      itensProcessados.push({
        itemVenda,
        qtdDevolver,
        valorItemEstornado,
        cmvItemEstornado,
        aptoRetorno: itemDev.aptoRetorno !== false
      });
    }

    valorTotalEstorno = parseFloat(valorTotalEstorno.toFixed(2));
    cmvTotalEstorno = parseFloat(cmvTotalEstorno.toFixed(2));

    // Calcula taxas proporcionais a estornar
    const proporcaoEstorno = venda.valor_total > 0 ? (valorTotalEstorno / venda.valor_total) : 0;
    const taxasEstornadas = parseFloat((venda.total_taxas * proporcaoEstorno).toFixed(2));

    // 2. Inserir registro de DevolucaoVenda
    const resDev = await db.runAsync(
      `INSERT INTO DevolucaoVenda 
       (gerente_id, venda_id, usuario_id, motivo, valor_estornado, cmv_estornado, taxas_estornadas, data_devolucao)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      [gerenteId, vendaId, usuarioId, motivo.trim(), valorTotalEstorno, cmvTotalEstorno, taxasEstornadas, now]
    );
    devolucaoId = resDev.lastInsertRowId;

    // 3. Processar cada item devolvido (Kardex e saldo do produto)
    for (const proc of itensProcessados) {
      const { itemVenda, qtdDevolver, valorItemEstornado, cmvItemEstornado, aptoRetorno } = proc;

      // Registra em ItensDevolucao
      await db.runAsync(
        `INSERT INTO ItensDevolucao 
         (gerente_id, devolucao_id, item_venda_id, produto_id, quantidade, valor_unitario, custo_unitario, apto_retorno)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          gerenteId,
          devolucaoId,
          itemVenda.id,
          itemVenda.produto_id,
          qtdDevolver,
          itemVenda.preco_unitario,
          itemVenda.preco_custo_unitario,
          aptoRetorno ? 1 : 0
        ]
      );

      // Atualiza quantidade devolvida no item da venda
      await db.runAsync(
        'UPDATE ItensVenda SET quantidade_devolvida = quantidade_devolvida + ? WHERE id = ?;',
        [qtdDevolver, itemVenda.id]
      );

      const prodRows = await db.getAllAsync(
        'SELECT estoque, nome FROM Produto WHERE id = ? AND gerente_id = ?;',
        [itemVenda.produto_id, gerenteId]
      );
      const saldoAnterior = parseFloat(prodRows[0]?.estoque) || 0;

      if (aptoRetorno) {
        // Reincorpora ao saldo disponível para revenda
        const saldoResultante = parseFloat((saldoAnterior + qtdDevolver).toFixed(3));
        await db.runAsync(
          'UPDATE Produto SET estoque = ?, updated_at = datetime(\'now\') WHERE id = ? AND gerente_id = ?;',
          [saldoResultante, itemVenda.produto_id, gerenteId]
        );

        await registrarMovimentacaoKardex({
          gerenteId,
          produtoId: itemVenda.produto_id,
          tipoMovimentacao: 'DEVOLUCAO_CLIENTE',
          quantidade: qtdDevolver,
          saldoAnterior,
          saldoResultante,
          custoUnitario: itemVenda.preco_custo_unitario,
          origemTipo: 'devolucao',
          origemId: devolucaoId,
          justificativa: `Devolução Venda #${vendaId} (Apto para revenda): ${motivo.trim()}`,
          responsavelId: usuarioId,
          dataMovimentacao: now
        }, db);
      } else {
        // Item avariado/impróprio: NÃO aumenta estoque vendável, registra no Kardex como perda por avaria
        await registrarMovimentacaoKardex({
          gerenteId,
          produtoId: itemVenda.produto_id,
          tipoMovimentacao: 'PERDA_AVARIA',
          quantidade: 0, // Não altera estoque vendável mas registra o evento de avaria no Kardex
          saldoAnterior,
          saldoResultante: saldoAnterior,
          custoUnitario: itemVenda.preco_custo_unitario,
          origemTipo: 'devolucao',
          origemId: devolucaoId,
          justificativa: `Devolução Venda #${vendaId} (Danificado/Descartado): ${motivo.trim()}`,
          responsavelId: usuarioId,
          dataMovimentacao: now
        }, db);
      }
    }

    // 4. Se a venda foi em Fiado, estorna o valor proporcional na caderneta
    if (venda.cliente_id && valorTotalEstorno > 0) {
      await estornarFiado(venda.cliente_id, valorTotalEstorno, gerenteId, db);
    }

    // 5. Atualiza status da venda caso tenha sido devolução parcial
    await db.runAsync(
      'UPDATE Venda SET status = \'parcialmente_devolvida\' WHERE id = ? AND status = \'concluida\';',
      [vendaId]
    );
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

  // Gera dados do comprovante atualizado da operação
  const comprovante = {
    titulo: 'COMPROVANTE DE DEVOLUÇÃO',
    devolucaoId,
    vendaId,
    dataDevolucao: now,
    motivo: motivo.trim(),
    valorTotalEstornado: valorTotalEstorno,
    cmvEstornado: cmvTotalEstorno,
    itens: itensProcessados.map(p => ({
      produtoId: p.itemVenda.produto_id,
      quantidade: p.qtdDevolver,
      precoUnitario: p.itemVenda.preco_unitario,
      subtotal: p.valorItemEstornado,
      aptoRetorno: p.aptoRetorno
    }))
  };

  return comprovante;
}
