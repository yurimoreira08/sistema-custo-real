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
import { baixarLotesFIFO, restaurarLotesItemVenda } from './stockService';
import { validarCaixaAtivoParaCheckout, registrarVendaNoCaixa, estornarVendaDoCaixa } from './cashService';
import { 
  round2, 
  round3, 
  toCents, 
  fromCents, 
  sumMoney, 
  subtractMoney, 
  multiplyMoney, 
  calcularProporcional 
} from '../utils/money';

// Trava em memória para controle de concorrência por venda (S05 - Yuri Moreira)
const activeSaleLocks = new Set();

export async function withSaleLock(vendaId, fn) {
  if (activeSaleLocks.has(vendaId)) {
    throw new Error(`Operação concorrente bloqueada para a venda #${vendaId}. Uma transação já está em processamento.`);
  }
  activeSaleLocks.add(vendaId);
  try {
    return await fn();
  } finally {
    activeSaleLocks.delete(vendaId);
  }
}

// ========================================================
// SERVIÇO DE VENDAS, CARRINHO, CANCELAMENTO E DEVOLUÇÕES (S01 A S05)
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
    await db.execAsync("ALTER TABLE ItensVenda ADD COLUMN gerente_id INTEGER DEFAULT 1;");
  } catch (e) {}
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

  // 0. Bloqueio do checkout sem caixa ativo (auditoria por operador)
  let turnoCaixa = null;
  if (usuarioId) {
    turnoCaixa = await validarCaixaAtivoParaCheckout(usuarioId, gerenteId, db);
  }

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

  // Garante que ItensVenda possua todas as colunas necessárias em tempo de execução
  try {
    await db.execAsync("ALTER TABLE ItensVenda ADD COLUMN gerente_id INTEGER DEFAULT 1;");
  } catch (e) {}
  try {
    await db.execAsync("ALTER TABLE ItensVenda ADD COLUMN subtotal REAL NOT NULL DEFAULT 0.0;");
  } catch (e) {}
  try {
    await db.execAsync("ALTER TABLE ItensVenda ADD COLUMN desconto_item REAL NOT NULL DEFAULT 0.0;");
  } catch (e) {}
  try {
    await db.execAsync("ALTER TABLE ItensVenda ADD COLUMN quantidade_devolvida REAL NOT NULL DEFAULT 0.0;");
  } catch (e) {}

  let vendaId = null;
  const now = dataVenda || new Date().toISOString();

  const runInsideTx = async () => {
    // 3. Inserir cabeçalho da Venda
    const resVenda = await db.runAsync(
      `INSERT INTO Venda 
       (gerente_id, usuario_id, cliente_id, canal_venda, data_venda, valor_bruto, desconto, valor_total, total_taxas, valor_liquido, valor_cmv, valor_opex, valor_lucro, status, turno_caixa_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'concluida', ?);`,
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
        parseFloat((pagamentosValidados.totalLiquido - carrinhoValidado.cmvEstimado).toFixed(2)),
        turnoCaixa ? turnoCaixa.id : null
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

      const resItem = await db.runAsync(
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

      // Baixa nos lotes pelo algoritmo PEPS/FIFO, rastreada por item para estornos exatos
      await baixarLotesFIFO(item.produto_id, item.quantidade, gerenteId, db, {
        tipo: 'venda',
        id: vendaId,
        itemVendaId: resItem.lastInsertRowId
      });

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

    // 6. Atualiza o caixa com recebimentos em dinheiro e outros meios
    if (turnoCaixa) {
      const valorDinheiro = pagamentosValidados.pagamentos
        .filter(p => p.forma_pagamento === 'dinheiro')
        .reduce((acc, p) => round2(acc + (parseFloat(p.valor_bruto) || 0)), 0);
      const valorOutros = pagamentosValidados.pagamentos
        .filter(p => p.forma_pagamento !== 'dinheiro')
        .reduce((acc, p) => round2(acc + (parseFloat(p.valor_bruto) || 0)), 0);

      await registrarVendaNoCaixa({
        turnoId: turnoCaixa.id,
        vendaId,
        valorDinheiro,
        valorOutros,
        operadorId: usuarioId,
        gerenteId
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
 * Trata concorrência e impede cancelamento duplicado ou de venda já devolvida.
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

  return await withSaleLock(vendaId, async () => {
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
    if (venda.status === 'totalmente_devolvida') {
      throw new Error('Esta venda já teve todos os seus itens devolvidos.');
    }

    const now = new Date().toISOString();

    const runInsideTx = async () => {
      // 1. Atualizar status da Venda para cancelada de forma atômica
      const resUpdate = await db.runAsync(
        'UPDATE Venda SET status = \'cancelada\' WHERE id = ? AND gerente_id = ? AND status NOT IN (\'cancelada\', \'totalmente_devolvida\');',
        [vendaId, gerenteId]
      );
      if (resUpdate && resUpdate.changes === 0) {
        throw new Error('Esta venda já foi cancelada anteriormente.');
      }

      // 2. Registrar na tabela de auditoria de cancelamento
      await db.runAsync(
        `INSERT INTO CancelamentoVenda (gerente_id, venda_id, usuario_id, justificativa, data_cancelamento)
         VALUES (?, ?, ?, ?, ?);`,
        [gerenteId, vendaId, usuarioId, justificativa.trim(), now]
      );

      // 3. Estornar pagamentos e fiado da caderneta (sem duplicidade caso tenha havido devolução prévia)
      const devsAnteriores = await db.getAllAsync(
        'SELECT COALESCE(SUM(valor_estornado), 0) as totalDevolvido FROM DevolucaoVenda WHERE venda_id = ?;',
        [vendaId]
      );
      const totalJaDevolvido = parseFloat(devsAnteriores[0]?.totalDevolvido) || 0;
      const fiadoRestanteEstornar = Math.max(0, (venda.valor_total || 0) - totalJaDevolvido);

      await estornarPagamentosVenda(vendaId, venda.cliente_id, gerenteId, db, fiadoRestanteEstornar);

      // Estornar do caixa os recebimentos em dinheiro refletindo diretamente na gaveta de caixa atual
      const pagsVenda = await db.getAllAsync(
        "SELECT * FROM PagamentoVenda WHERE venda_id = ? AND forma_pagamento = 'dinheiro' AND estornado = 1;",
        [vendaId]
      );
      const valorDinheiroEstorno = pagsVenda.reduce((acc, p) => round2(acc + (parseFloat(p.valor_bruto) || 0)), 0);
      if (valorDinheiroEstorno > 0) {
        await estornarVendaDoCaixa({
          turnoId: venda.turno_caixa_id,
          vendaId,
          valorDinheiro: valorDinheiroEstorno,
          operadorId: usuarioId || gerenteId,
          gerenteId,
          justificativa: justificativa.trim()
        }, db);
      }

      // 4. Reverter o estoque dos itens vendidos via Kardex (apenas o que ainda não foi devolvido)
      const itens = await db.getAllAsync(
        'SELECT * FROM ItensVenda WHERE venda_id = ?;',
        [vendaId]
      );

      for (const item of itens) {
        const qtdRetorno = round3(item.quantidade - (item.quantidade_devolvida || 0));
        if (qtdRetorno <= 0) continue;

        const prodRows = await db.getAllAsync(
          'SELECT estoque FROM Produto WHERE id = ? AND gerente_id = ?;',
          [item.produto_id, gerenteId]
        );
        const saldoAnterior = parseFloat(prodRows[0]?.estoque) || 0;
        const saldoResultante = round3(saldoAnterior + qtdRetorno);

        await db.runAsync(
          'UPDATE Produto SET estoque = ?, updated_at = datetime(\'now\') WHERE id = ? AND gerente_id = ?;',
          [saldoResultante, item.produto_id, gerenteId]
        );

        await restaurarLotesItemVenda(item.id, qtdRetorno, gerenteId, db);

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
  });
}

// --------------------------------------------------------
// 4. DEVOLUÇÃO PARCIAL E ESTORNOS (Yuri Moreira S04 / S05)
// --------------------------------------------------------

/**
 * Processa a devolução parcial de itens de uma venda, com cálculo proporcional
 * de estorno financeiro e decisão de reincorporação ao estoque para revenda (apto vs avariado).
 * Garante concorrência serializada por venda, bloqueia devoluções duplicadas e
 * integra itens avariados na tabela PerdaEstoque.
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

  return await withSaleLock(vendaId, async () => {
    const vendaRows = await db.getAllAsync(
      'SELECT * FROM Venda WHERE id = ? AND gerente_id = ?;',
      [vendaId, gerenteId]
    );
    if (vendaRows.length === 0) throw new Error('Venda não encontrada.');
    const venda = vendaRows[0];
    if (venda.status === 'cancelada') {
      throw new Error('Não é possível realizar devolução de uma venda já cancelada.');
    }
    if (venda.status === 'totalmente_devolvida') {
      throw new Error('Esta venda já teve todos os seus itens devolvidos.');
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
        const qtdDevolver = round3(itemDev.quantidade);
        if (isNaN(qtdDevolver) || qtdDevolver <= 0) {
          throw new Error('Quantidade a devolver deve ser maior que zero.');
        }

        const qtdJaDevolvida = round3(itemVenda.quantidade_devolvida || 0);
        const saldoDevoluvel = round3(itemVenda.quantidade - qtdJaDevolvida);

        if (qtdDevolver > saldoDevoluvel) {
          throw new Error(
            `Quantidade solicitada (${qtdDevolver}) excede o saldo disponível para devolução (${saldoDevoluvel}) para o item ID ${itemDev.itemVendaId}.`
          );
        }

        const valorItemEstornado = multiplyMoney(itemVenda.preco_unitario, qtdDevolver);
        const cmvItemEstornado = multiplyMoney(itemVenda.preco_custo_unitario, qtdDevolver);

        valorTotalEstorno = sumMoney(valorTotalEstorno, valorItemEstornado);
        cmvTotalEstorno = sumMoney(cmvTotalEstorno, cmvItemEstornado);

        itensProcessados.push({
          itemVenda,
          qtdDevolver,
          valorItemEstornado,
          cmvItemEstornado,
          aptoRetorno: itemDev.aptoRetorno !== false
        });
      }

      // Calcula taxas proporcionais a estornar de forma precisa
      const taxasEstornadas = calcularProporcional(venda.total_taxas, valorTotalEstorno, venda.valor_total);

      // 2. Inserir registro de DevolucaoVenda
      const resDev = await db.runAsync(
        `INSERT INTO DevolucaoVenda 
         (gerente_id, venda_id, usuario_id, motivo, valor_estornado, cmv_estornado, taxas_estornadas, data_devolucao)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
        [gerenteId, vendaId, usuarioId, motivo.trim(), valorTotalEstorno, cmvTotalEstorno, taxasEstornadas, now]
      );
      devolucaoId = resDev.lastInsertRowId;

      // 3. Processar cada item devolvido (Kardex, saldo do produto e perdas)
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

        // Atualiza quantidade devolvida no item da venda com verificação atômica
        const resItVenda = await db.runAsync(
          'UPDATE ItensVenda SET quantidade_devolvida = quantidade_devolvida + ? WHERE id = ? AND (quantidade - quantidade_devolvida) >= ?;',
          [qtdDevolver, itemVenda.id, qtdDevolver]
        );
        if (resItVenda && resItVenda.changes === 0) {
          throw new Error(`Concorrência detectada: o saldo para devolução do item #${itemVenda.id} foi alterado por outra operação.`);
        }

        const prodRows = await db.getAllAsync(
          'SELECT estoque, nome FROM Produto WHERE id = ? AND gerente_id = ?;',
          [itemVenda.produto_id, gerenteId]
        );
        const saldoAnterior = parseFloat(prodRows[0]?.estoque) || 0;

        if (aptoRetorno) {
          // Reincorpora ao saldo disponível para revenda
          const saldoResultante = round3(saldoAnterior + qtdDevolver);
          await db.runAsync(
            'UPDATE Produto SET estoque = ?, updated_at = datetime(\'now\') WHERE id = ? AND gerente_id = ?;',
            [saldoResultante, itemVenda.produto_id, gerenteId]
          );

          await restaurarLotesItemVenda(itemVenda.id, qtdDevolver, gerenteId, db);

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
          // Item avariado/impróprio: registra no Kardex E na tabela PerdaEstoque (integrando com Zé Neto)
          await db.runAsync(
            `INSERT INTO PerdaEstoque 
             (gerente_id, produto_id, usuario_id, tipo_perda, quantidade, custo_unitario, impacto_financeiro, justificativa, data_perda)
             VALUES (?, ?, ?, 'avaria', ?, ?, ?, ?, ?);`,
            [
              gerenteId,
              itemVenda.produto_id,
              usuarioId,
              qtdDevolver,
              itemVenda.preco_custo_unitario,
              cmvItemEstornado,
              `Devolução Venda #${vendaId} (Item avariado na devolução): ${motivo.trim()}`,
              now
            ]
          );

          await registrarMovimentacaoKardex({
            gerenteId,
            produtoId: itemVenda.produto_id,
            tipoMovimentacao: 'PERDA_AVARIA',
            quantidade: 0,
            saldoAnterior,
            saldoResultante: saldoAnterior,
            custoUnitario: itemVenda.preco_custo_unitario,
            origemTipo: 'devolucao',
            origemId: devolucaoId,
            justificativa: `Devolução Venda #${vendaId} (Danificado/Avaria): ${motivo.trim()}`,
            responsavelId: usuarioId,
            dataMovimentacao: now
          }, db);
        }
      }

      // 4. Se a venda foi em Fiado, estorna o valor proporcional na caderneta
      if (venda.cliente_id && valorTotalEstorno > 0) {
        await estornarFiado(venda.cliente_id, valorTotalEstorno, gerenteId, db);
      }

      // 4.1 Se a venda teve pagamento em dinheiro, deduz o valor proporcional estornado da gaveta de caixa atual
      const pagsDinheiro = await db.getAllAsync(
        "SELECT COALESCE(SUM(valor_bruto), 0) as totalDinheiro FROM PagamentoVenda WHERE venda_id = ? AND forma_pagamento = 'dinheiro';",
        [vendaId]
      );
      const totalDinheiroVenda = parseFloat(pagsDinheiro[0]?.totalDinheiro) || 0;
      if (totalDinheiroVenda > 0 && valorTotalEstorno > 0 && (venda.valor_total || 0) > 0) {
        const estornoDinheiro = calcularProporcional(totalDinheiroVenda, valorTotalEstorno, venda.valor_total);
        if (estornoDinheiro > 0) {
          await estornarVendaDoCaixa({
            turnoId: venda.turno_caixa_id,
            vendaId,
            valorDinheiro: estornoDinheiro,
            operadorId: usuarioId || gerenteId,
            gerenteId,
            justificativa: `Devolução parcial Venda #${vendaId}: ${motivo.trim()}`,
            origemReferencia: `DEV-PARCIAL-${devolucaoId}`
          }, db);
        }
      }

      // 5. Atualiza status da venda (totalmente vs parcialmente devolvida)
      const itensRestantes = await db.getAllAsync(
        'SELECT SUM(quantidade - quantidade_devolvida) as totalRestante FROM ItensVenda WHERE venda_id = ?;',
        [vendaId]
      );
      const totalRestante = parseFloat(itensRestantes[0]?.totalRestante) || 0;
      const novoStatus = totalRestante <= 0.0001 ? 'totalmente_devolvida' : 'parcialmente_devolvida';

      await db.runAsync(
        'UPDATE Venda SET status = ? WHERE id = ?;',
        [novoStatus, vendaId]
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

    return {
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
  });
}
