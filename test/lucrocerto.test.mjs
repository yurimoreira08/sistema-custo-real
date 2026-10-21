import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

// ============================================================================
// SUÍTE DE TESTES AUTOMATIZADOS: LUCROCERTO (SEMANAS S01 A S04)
// Integrantes:
//   - Francisco Yuri da Silva Mauriz (Financeiro, Taxas, Lucro Real, CMV)
//   - Yuri Kauan Ibiapino Moreira (Vendas, Carrinho, Cancelamento, Devoluções)
//   - José da Luz Coelho Neto (Estoque, Fornecedores, Kardex, PMP, Perdas)
// ============================================================================

function sha256(str) {
  return createHash('sha256').update(String(str)).digest('hex');
}

/**
 * Cria banco SQLite em memória com o esquema completo da base de dados S01 a S04
 */
function setupTestDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');

  // S01: Esquema Base Unificado
  db.exec(`
    CREATE TABLE Usuario (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      senha TEXT NOT NULL,
      cargo TEXT NOT NULL CHECK(cargo IN ('gerente', 'balconista')),
      gerente_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE Cliente (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gerente_id INTEGER NOT NULL,
      nome TEXT NOT NULL,
      cpf_cnpj TEXT,
      telefone TEXT,
      limite_fiado REAL NOT NULL DEFAULT 0.0,
      saldo_devedor REAL NOT NULL DEFAULT 0.0,
      ativo INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE Fornecedor (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gerente_id INTEGER NOT NULL,
      razao_social TEXT NOT NULL,
      nome_fantasia TEXT,
      cnpj_cpf TEXT,
      telefone TEXT,
      email TEXT,
      prazo_pagamento_dias INTEGER DEFAULT 0,
      ativo INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE Produto (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gerente_id INTEGER NOT NULL,
      nome TEXT NOT NULL,
      codigo_barras TEXT,
      categoria TEXT,
      preco_custo REAL NOT NULL DEFAULT 0.0,
      preco_venda REAL NOT NULL DEFAULT 0.0,
      estoque_atual REAL NOT NULL DEFAULT 0.0,
      estoque_minimo REAL NOT NULL DEFAULT 0.0,
      fornecedor_id INTEGER,
      ativo INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (fornecedor_id) REFERENCES Fornecedor(id)
    );

    CREATE TABLE FormaPagamentoConfig (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gerente_id INTEGER NOT NULL,
      codigo TEXT NOT NULL,
      nome TEXT NOT NULL,
      taxa_percentual REAL NOT NULL DEFAULT 0.0,
      taxa_fixa REAL NOT NULL DEFAULT 0.0,
      operadora TEXT,
      dias_repasse INTEGER DEFAULT 0,
      ativo INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(gerente_id, codigo)
    );

    CREATE TABLE Venda (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gerente_id INTEGER NOT NULL,
      usuario_id INTEGER,
      cliente_id INTEGER,
      subtotal REAL NOT NULL DEFAULT 0.0,
      desconto REAL NOT NULL DEFAULT 0.0,
      total REAL NOT NULL DEFAULT 0.0,
      status TEXT NOT NULL DEFAULT 'concluida' CHECK(status IN ('concluida', 'cancelada', 'devolvida_parcial')),
      canal_venda TEXT NOT NULL DEFAULT 'balcao' CHECK(canal_venda IN ('balcao', 'delivery', 'encomenda')),
      observacoes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (cliente_id) REFERENCES Cliente(id)
    );

    CREATE TABLE ItensVenda (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      venda_id INTEGER NOT NULL,
      produto_id INTEGER NOT NULL,
      quantidade REAL NOT NULL,
      preco_unitario REAL NOT NULL,
      custo_unitario_historico REAL NOT NULL DEFAULT 0.0,
      subtotal REAL NOT NULL,
      FOREIGN KEY (venda_id) REFERENCES Venda(id),
      FOREIGN KEY (produto_id) REFERENCES Produto(id)
    );

    CREATE TABLE PagamentoVenda (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      venda_id INTEGER NOT NULL,
      gerente_id INTEGER NOT NULL,
      forma_pagamento TEXT NOT NULL,
      valor_pago REAL NOT NULL,
      taxa_percentual_aplicada REAL NOT NULL DEFAULT 0.0,
      taxa_fixa_aplicada REAL NOT NULL DEFAULT 0.0,
      valor_taxa REAL NOT NULL DEFAULT 0.0,
      valor_liquido REAL NOT NULL DEFAULT 0.0,
      status TEXT NOT NULL DEFAULT 'confirmado' CHECK(status IN ('confirmado', 'estornado', 'pendente')),
      cliente_id INTEGER,
      observacao TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (venda_id) REFERENCES Venda(id)
    );

    CREATE TABLE CancelamentoVenda (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      venda_id INTEGER NOT NULL UNIQUE,
      gerente_id INTEGER NOT NULL,
      gerente_responsavel_id INTEGER NOT NULL,
      motivo_justificativa TEXT NOT NULL,
      data_cancelamento TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (venda_id) REFERENCES Venda(id),
      FOREIGN KEY (gerente_responsavel_id) REFERENCES Usuario(id)
    );

    CREATE TABLE DevolucaoVenda (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      venda_id INTEGER NOT NULL,
      gerente_id INTEGER NOT NULL,
      usuario_id INTEGER,
      valor_estornado REAL NOT NULL,
      motivo TEXT NOT NULL,
      data_devolucao TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (venda_id) REFERENCES Venda(id)
    );

    CREATE TABLE ItensDevolucao (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      devolucao_id INTEGER NOT NULL,
      produto_id INTEGER NOT NULL,
      quantidade REAL NOT NULL,
      valor_unitario REAL NOT NULL,
      subtotal_estornado REAL NOT NULL,
      apto_revenda INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (devolucao_id) REFERENCES DevolucaoVenda(id),
      FOREIGN KEY (produto_id) REFERENCES Produto(id)
    );

    CREATE TABLE EntradaMercadoria (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gerente_id INTEGER NOT NULL,
      fornecedor_id INTEGER,
      numero_nota_fiscal TEXT,
      valor_total REAL NOT NULL DEFAULT 0.0,
      observacoes TEXT,
      data_entrada TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (fornecedor_id) REFERENCES Fornecedor(id)
    );

    CREATE TABLE ItensEntrada (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entrada_id INTEGER NOT NULL,
      produto_id INTEGER NOT NULL,
      quantidade REAL NOT NULL,
      custo_unitario REAL NOT NULL,
      custo_total REAL NOT NULL,
      lote TEXT,
      FOREIGN KEY (entrada_id) REFERENCES EntradaMercadoria(id),
      FOREIGN KEY (produto_id) REFERENCES Produto(id)
    );

    CREATE TABLE MovimentacaoEstoque (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gerente_id INTEGER NOT NULL,
      produto_id INTEGER NOT NULL,
      tipo_operacao TEXT NOT NULL CHECK(tipo_operacao IN ('ENTRADA', 'SAIDA_VENDA', 'PERDA', 'AVARIA', 'DEVOLUCAO', 'CANCELAMENTO_VENDA', 'AJUSTE')),
      quantidade REAL NOT NULL,
      saldo_anterior REAL NOT NULL,
      saldo_novo REAL NOT NULL,
      custo_unitario REAL NOT NULL DEFAULT 0.0,
      origem_referencia TEXT,
      justificativa TEXT,
      usuario_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (produto_id) REFERENCES Produto(id)
    );

    CREATE TABLE PerdaEstoque (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gerente_id INTEGER NOT NULL,
      produto_id INTEGER NOT NULL,
      quantidade REAL NOT NULL,
      motivo_tipo TEXT NOT NULL CHECK(motivo_tipo IN ('quebra', 'extravio', 'furto', 'vencimento', 'avaria')),
      justificativa TEXT NOT NULL,
      custo_unitario_aplicado REAL NOT NULL,
      impacto_financeiro REAL NOT NULL,
      usuario_id INTEGER,
      data_perda TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (produto_id) REFERENCES Produto(id)
    );
  `);

  return db;
}

// ============================================================================
// TESTES UNITÁRIOS E DE REGRAS DE NEGÓCIO
// ============================================================================

test('S01: Integridade Estrutural e Foreign Keys do Banco de Dados', (t) => {
  const db = setupTestDb();
  
  // Valida que o banco recusa inserção com FK inválida
  assert.throws(() => {
    db.prepare(`
      INSERT INTO ItensVenda (venda_id, produto_id, quantidade, preco_unitario, subtotal)
      VALUES (999, 999, 1, 10, 10);
    `).run();
  }, /FOREIGN KEY constraint failed/);

  // Inserção com gerente e produto válidos
  db.prepare(`INSERT INTO Usuario (id, nome, email, senha, cargo) VALUES (1, 'Gerente Teste', 'gerente@teste.com', 'hash', 'gerente');`).run();
  db.prepare(`INSERT INTO Fornecedor (id, gerente_id, razao_social) VALUES (1, 1, 'Distribuidora Central');`).run();
  db.prepare(`INSERT INTO Produto (id, gerente_id, nome, preco_custo, preco_venda, estoque_atual, fornecedor_id) VALUES (1, 1, 'Arroz 5kg', 18.0, 25.0, 50.0, 1);`).run();

  const prod = db.prepare('SELECT * FROM Produto WHERE id = 1').get();
  assert.equal(prod.nome, 'Arroz 5kg');
  assert.equal(prod.estoque_atual, 50.0);
});

test('S02 — Yuri Mauriz: Cálculo de Taxas Percentuais e Fixas por Meio de Pagamento', () => {
  // Regra de taxa: valorTaxa = round2(valor * (taxaPct / 100) + taxaFixa)
  function calcularTaxa(valor, taxaPct, taxaFixa) {
    const vTaxa = Math.round((valor * (taxaPct / 100) + taxaFixa) * 100) / 100;
    const vLiq = Math.round((valor - vTaxa) * 100) / 100;
    return { valorTaxa: vTaxa, valorLiquido: vLiq };
  }

  // Dinheiro (0%)
  const din = calcularTaxa(100.0, 0.0, 0.0);
  assert.equal(din.valorTaxa, 0.0);
  assert.equal(din.valorLiquido, 100.0);

  // PIX (0.99%)
  const pix = calcularTaxa(100.0, 0.99, 0.0);
  assert.equal(pix.valorTaxa, 0.99);
  assert.equal(pix.valorLiquido, 99.01);

  // Cartão de Débito (1.99%)
  const deb = calcularTaxa(150.0, 1.99, 0.0);
  assert.equal(deb.valorTaxa, 2.99);
  assert.equal(deb.valorLiquido, 147.01);

  // Cartão de Crédito (3.49% + R$ 0.30 fixo)
  const cred = calcularTaxa(200.0, 3.49, 0.30);
  // 200 * 0.0349 = 6.98 + 0.30 = 7.28
  assert.equal(cred.valorTaxa, 7.28);
  assert.equal(cred.valorLiquido, 192.72);
});

test('S02 — Yuri Moreira: Gestão de Carrinho e Validação de Preços/Estoque Autorizada pelo Backend', () => {
  const db = setupTestDb();
  db.prepare(`INSERT INTO Usuario (id, nome, email, senha, cargo) VALUES (1, 'Admin', 'admin@teste.com', '123', 'gerente');`).run();
  db.prepare(`INSERT INTO Produto (id, gerente_id, nome, preco_custo, preco_venda, estoque_atual) VALUES (1, 1, 'Feijão Carioca', 6.0, 9.50, 20.0);`).run();
  db.prepare(`INSERT INTO Produto (id, gerente_id, nome, preco_custo, preco_venda, estoque_atual) VALUES (2, 1, 'Óleo de Soja', 4.5, 7.00, 5.0);`).run();

  function validarERecalcularCarrinho(dbInstance, gerenteId, itensCarrinho, descontoInformado = 0) {
    if (!itensCarrinho || itensCarrinho.length === 0) {
      throw new Error('O carrinho está vazio.');
    }

    let subtotalCalculado = 0;
    const itensValidados = [];

    for (const item of itensCarrinho) {
      const prod = dbInstance.prepare('SELECT id, nome, preco_custo, preco_venda, estoque_atual FROM Produto WHERE id = ? AND gerente_id = ?').get(item.produto_id, gerenteId);
      if (!prod) {
        throw new Error(`Produto #${item.produto_id} não encontrado.`);
      }

      if (prod.estoque_atual < item.quantidade) {
        throw new Error(`Estoque insuficiente para o produto "${prod.nome}". Disponível: ${prod.estoque_atual}, Solicitado: ${item.quantidade}`);
      }

      // NÃO confia no preço enviado pelo frontend
      const precoUnitarioOficial = prod.preco_venda;
      const subtotalItem = Math.round(item.quantidade * precoUnitarioOficial * 100) / 100;
      subtotalCalculado += subtotalItem;

      itensValidados.push({
        produto_id: prod.id,
        nome: prod.nome,
        quantidade: item.quantidade,
        preco_unitario: precoUnitarioOficial,
        custo_unitario_historico: prod.preco_custo,
        subtotal: subtotalItem
      });
    }

    subtotalCalculado = Math.round(subtotalCalculado * 100) / 100;
    const descontoAplicado = Math.min(Math.max(0, descontoInformado), subtotalCalculado);
    const totalFinal = Math.round((subtotalCalculado - descontoAplicado) * 100) / 100;

    return {
      subtotal: subtotalCalculado,
      desconto: descontoAplicado,
      total: totalFinal,
      itens: itensValidados
    };
  }

  // 1. Carrinho adulterado pelo frontend (preço enviado R$ 1.00 ao invés do preço oficial R$ 9.50)
  const tentativaAdulterada = [{ produto_id: 1, quantidade: 2, preco_unitario: 1.00 }];
  const validado = validarERecalcularCarrinho(db, 1, tentativaAdulterada, 4.0);
  assert.equal(validado.subtotal, 19.00, 'Subtotal deve usar preço do banco (2 * 9.50 = 19.00)');
  assert.equal(validado.desconto, 4.00);
  assert.equal(validado.total, 15.00);

  // 2. Validação de estoque insuficiente
  assert.throws(() => {
    validarERecalcularCarrinho(db, 1, [{ produto_id: 2, quantidade: 10 }]); // Disponível é 5
  }, /Estoque insuficiente/);
});

test('S02 — Zé Neto: Fornecedores e Rastreabilidade Completa no Kardex', () => {
  const db = setupTestDb();
  db.prepare(`INSERT INTO Fornecedor (id, gerente_id, razao_social, cnpj_cpf) VALUES (1, 10, 'Atacadão Alimentos', '12345678000199');`).run();
  db.prepare(`INSERT INTO Produto (id, gerente_id, nome, preco_custo, estoque_atual, fornecedor_id) VALUES (1, 10, 'Açúcar Cristal 1kg', 3.0, 0, 1);`).run();

  function registrarKardex(dbInst, { gerente_id, produto_id, tipo_operacao, quantidade, saldo_anterior, saldo_novo, custo_unitario, origem_referencia, justificativa }) {
    dbInst.prepare(`
      INSERT INTO MovimentacaoEstoque (
        gerente_id, produto_id, tipo_operacao, quantidade, saldo_anterior, saldo_novo, custo_unitario, origem_referencia, justificativa
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
    `).run(gerente_id, produto_id, tipo_operacao, quantidade, saldo_anterior, saldo_novo, custo_unitario, origem_referencia, justificativa);
  }

  // Entrada de 100 unidades
  registrarKardex(db, {
    gerente_id: 10,
    produto_id: 1,
    tipo_operacao: 'ENTRADA',
    quantidade: 100,
    saldo_anterior: 0,
    saldo_novo: 100,
    custo_unitario: 3.20,
    origem_referencia: 'NF-1044',
    justificativa: 'Compra de reposição'
  });

  // Saída de 30 unidades por venda
  registrarKardex(db, {
    gerente_id: 10,
    produto_id: 1,
    tipo_operacao: 'SAIDA_VENDA',
    quantidade: -30,
    saldo_anterior: 100,
    saldo_novo: 70,
    custo_unitario: 3.20,
    origem_referencia: 'VENDA-1',
    justificativa: 'Venda balcão'
  });

  const movimentacoes = db.prepare('SELECT * FROM MovimentacaoEstoque WHERE produto_id = 1 ORDER BY id ASC').all();
  assert.equal(movimentacoes.length, 2);
  assert.equal(movimentacoes[0].tipo_operacao, 'ENTRADA');
  assert.equal(movimentacoes[0].saldo_novo, 100);
  assert.equal(movimentacoes[1].tipo_operacao, 'SAIDA_VENDA');
  assert.equal(movimentacoes[1].saldo_novo, 70);
});

test('S03 — Yuri Mauriz: Checkout com Pagamentos Mistos e Prevenção de Divergência', () => {
  function validarPagamentosMistos(totalVenda, pagamentos, clienteSaldoDevedor = 0, clienteLimiteFiado = 0) {
    if (!pagamentos || pagamentos.length === 0) {
      throw new Error('Informe ao menos uma forma de pagamento.');
    }

    let somaPagamentos = 0;
    for (const p of pagamentos) {
      if (!p.valor || p.valor <= 0) {
        throw new Error('O valor de cada pagamento deve ser superior a zero.');
      }
      somaPagamentos += Number(p.valor);

      if (p.forma === 'fiado') {
        const novoSaldo = clienteSaldoDevedor + Number(p.valor);
        if (novoSaldo > clienteLimiteFiado) {
          throw new Error(`Limite de fiado excedido! Disponível: R$ ${(clienteLimiteFiado - clienteSaldoDevedor).toFixed(2)}`);
        }
      }
    }

    somaPagamentos = Math.round(somaPagamentos * 100) / 100;
    const diff = Math.abs(somaPagamentos - totalVenda);
    if (diff > 0.01) {
      throw new Error(`Divergência nos pagamentos! Total da venda: R$ ${totalVenda.toFixed(2)}, Soma paga: R$ ${somaPagamentos.toFixed(2)}`);
    }

    return true;
  }

  // Venda de R$ 100,00 dividida em 3 formas: R$ 40 PIX, R$ 30 Dinheiro, R$ 30 Cartão
  assert.equal(
    validarPagamentosMistos(100.0, [
      { forma: 'pix', valor: 40.0 },
      { forma: 'dinheiro', valor: 30.0 },
      { forma: 'cartao_credito', valor: 30.0 }
    ]),
    true
  );

  // Divergência: soma dá R$ 95,00 ao invés de R$ 100,00
  assert.throws(() => {
    validarPagamentosMistos(100.0, [
      { forma: 'pix', valor: 40.0 },
      { forma: 'dinheiro', valor: 30.0 },
      { forma: 'cartao_credito', valor: 25.0 }
    ]);
  }, /Divergência nos pagamentos/);

  // Fiado excedendo limite: limite 50, saldo atual 20, tentativa de fiado 40 (daria 60 > 50)
  assert.throws(() => {
    validarPagamentosMistos(40.0, [{ forma: 'fiado', valor: 40.0 }], 20.0, 50.0);
  }, /Limite de fiado excedido/);
});

test('S03 — Zé Neto: Entrada de Mercadorias e Recálculo Matemático do Preço Médio Ponderado (PMP)', () => {
  function calcularNovoPMP(qtdAnterior, custoAnterior, qtdEntrada, custoEntrada) {
    if (qtdEntrada <= 0 || custoEntrada < 0) {
      throw new Error('Quantidade ou custo de entrada inválidos.');
    }

    if (qtdAnterior <= 0) {
      return Math.round(custoEntrada * 100) / 100;
    }

    const valorEstoqueAnterior = qtdAnterior * custoAnterior;
    const valorEntrada = qtdEntrada * custoEntrada;
    const qtdTotal = qtdAnterior + qtdEntrada;

    const novoPMP = (valorEstoqueAnterior + valorEntrada) / qtdTotal;
    return Math.round(novoPMP * 100) / 100;
  }

  // Caso 1: Estoque anterior zerado -> Novo PMP deve ser exatamente o custo de entrada
  const pmp1 = calcularNovoPMP(0, 0, 50, 10.0);
  assert.equal(pmp1, 10.00);

  // Caso 2: 10 un a R$ 10,00 (Total R$ 100) + 10 un a R$ 20,00 (Total R$ 200) -> 20 un por R$ 300 = R$ 15,00
  const pmp2 = calcularNovoPMP(10, 10.0, 10, 20.0);
  assert.equal(pmp2, 15.00);

  // Caso 3: 40 un a R$ 5,00 (R$ 200) + 60 un a R$ 7,50 (R$ 450) -> 100 un por R$ 650 = R$ 6,50
  const pmp3 = calcularNovoPMP(40, 5.0, 60, 7.50);
  assert.equal(pmp3, 6.50);

  // Quantidade inválida
  assert.throws(() => {
    calcularNovoPMP(10, 5.0, -5, 7.0);
  }, /inválidos/);
});

test('S04 — Yuri Mauriz: Motor de Apuração de Lucro Real e CMV por Canal', () => {
  function apurarLucroReal(vendasConcluidas, devolucoesParciais, pagamentos, canalFiltro = 'todos') {
    let faturamentoBruto = 0;
    let cmvTotal = 0;
    const porCanal = {};

    for (const v of vendasConcluidas) {
      if (canalFiltro !== 'todos' && v.canal_venda !== canalFiltro) continue;

      if (!porCanal[v.canal_venda]) {
        porCanal[v.canal_venda] = { faturamento: 0, cmv: 0, taxas: 0, resultado: 0 };
      }

      faturamentoBruto += v.total;
      porCanal[v.canal_venda].faturamento += v.total;

      for (const item of v.itens) {
        const itemCMV = item.quantidade * item.custo_unitario_historico;
        cmvTotal += itemCMV;
        porCanal[v.canal_venda].cmv += itemCMV;
      }
    }

    // Abate devoluções
    let valorEstornadoDevolucoes = 0;
    let cmvEstornadoDevolucoes = 0;
    for (const dev of devolucoesParciais) {
      valorEstornadoDevolucoes += dev.valor_estornado;
      for (const itemDev of dev.itens) {
        if (itemDev.apto_revenda) {
          cmvEstornadoDevolucoes += (itemDev.quantidade * itemDev.custo_unitario);
        }
      }
    }

    const faturamentoElegivel = Math.round((faturamentoBruto - valorEstornadoDevolucoes) * 100) / 100;
    const cmvLiquido = Math.round((cmvTotal - cmvEstornadoDevolucoes) * 100) / 100;

    let taxasOperacionais = 0;
    for (const p of pagamentos) {
      if (p.status === 'confirmado') {
        taxasOperacionais += p.valor_taxa;
      }
    }
    taxasOperacionais = Math.round(taxasOperacionais * 100) / 100;

    // Fórmula mestre S04: Resultado = Faturamento Elegível - CMV - Taxas
    const resultadoAposCmvETaxas = Math.round((faturamentoElegivel - cmvLiquido - taxasOperacionais) * 100) / 100;
    const margemContribuicao = faturamentoElegivel > 0 
      ? Math.round((resultadoAposCmvETaxas / faturamentoElegivel) * 1000) / 10 
      : 0;

    return {
      faturamentoElegivel,
      cmvLiquido,
      taxasOperacionais,
      resultadoAposCmvETaxas,
      margemContribuicao,
      porCanal,
      avisoContabil: 'Nota: Margem de contribuição operacional direta. Não representa lucro líquido contábil final.'
    };
  }

  const vendas = [
    {
      id: 1,
      total: 100.0,
      canal_venda: 'balcao',
      itens: [{ quantidade: 2, custo_unitario_historico: 30.0 }] // CMV = 60.0
    },
    {
      id: 2,
      total: 200.0,
      canal_venda: 'delivery',
      itens: [{ quantidade: 4, custo_unitario_historico: 25.0 }] // CMV = 100.0
    }
  ];

  const pagamentos = [
    { id: 1, valor_taxa: 1.0, status: 'confirmado' },
    { id: 2, valor_taxa: 5.0, status: 'confirmado' }
  ];

  const apuracao = apurarLucroReal(vendas, [], pagamentos);
  assert.equal(apuracao.faturamentoElegivel, 300.0);
  assert.equal(apuracao.cmvLiquido, 160.0);
  assert.equal(apuracao.taxasOperacionais, 6.0);
  // Resultado = 300 - 160 - 6 = 134
  assert.equal(apuracao.resultadoAposCmvETaxas, 134.0);
  assert.equal(apuracao.margemContribuicao, 44.7);
  assert.ok(apuracao.porCanal.balcao);
  assert.ok(apuracao.porCanal.delivery);
});

// ============================================================================
// VALIDAÇÃO DOS 6 CENÁRIOS INTEGRADOS OBRIGATÓRIOS (A ATÉ F)
// ============================================================================

test('Cenário A — Venda Normal com Carrinho, Pagamento Misto, Baixa no Kardex e CMV', () => {
  const db = setupTestDb();
  
  // 1. Cadastrar produto e configurações
  db.prepare(`INSERT INTO Usuario (id, nome, email, senha, cargo) VALUES (1, 'Gerente A', 'gerenteA@mercado.com', '${sha256('1234')}', 'gerente');`).run();
  db.prepare(`INSERT INTO Produto (id, gerente_id, nome, preco_custo, preco_venda, estoque_atual) VALUES (1, 1, 'Café Torrado 500g', 10.0, 18.0, 40.0);`).run();
  db.prepare(`INSERT INTO FormaPagamentoConfig (gerente_id, codigo, nome, taxa_percentual, taxa_fixa) VALUES (1, 'pix', 'PIX', 1.0, 0.0);`).run();
  db.prepare(`INSERT INTO FormaPagamentoConfig (gerente_id, codigo, nome, taxa_percentual, taxa_fixa) VALUES (1, 'dinheiro', 'Dinheiro', 0.0, 0.0);`).run();

  // 2. Adicionar 2 cafés ao carrinho (2 * 18 = R$ 36,00)
  const qtdVendida = 2;
  const prod = db.prepare('SELECT * FROM Produto WHERE id = 1').get();
  assert.ok(prod.estoque_atual >= qtdVendida);

  const subtotal = qtdVendida * prod.preco_venda; // 36.00
  const desconto = 0;
  const total = subtotal - desconto; // 36.00

  // 3. Pagamento misto: R$ 20 no PIX (taxa 1% = 0.20) + R$ 16 no Dinheiro (taxa 0)
  const pagamentos = [
    { forma: 'pix', valor: 20.0, taxa_pct: 1.0, taxa_fixa: 0.0, valor_taxa: 0.20, valor_liquido: 19.80 },
    { forma: 'dinheiro', valor: 16.0, taxa_pct: 0.0, taxa_fixa: 0.0, valor_taxa: 0.0, valor_liquido: 16.00 }
  ];
  const somaPaga = pagamentos.reduce((acc, p) => acc + p.valor, 0);
  assert.equal(somaPaga, total);

  // 4. Grava a Venda atomicamente
  db.prepare(`
    INSERT INTO Venda (id, gerente_id, usuario_id, subtotal, desconto, total, status, canal_venda)
    VALUES (1, 1, 1, ?, ?, ?, 'concluida', 'balcao');
  `).run(subtotal, desconto, total);

  db.prepare(`
    INSERT INTO ItensVenda (venda_id, produto_id, quantidade, preco_unitario, custo_unitario_historico, subtotal)
    VALUES (1, 1, ?, ?, ?, ?);
  `).run(qtdVendida, prod.preco_venda, prod.preco_custo, subtotal);

  for (const p of pagamentos) {
    db.prepare(`
      INSERT INTO PagamentoVenda (venda_id, gerente_id, forma_pagamento, valor_pago, taxa_percentual_aplicada, taxa_fixa_aplicada, valor_taxa, valor_liquido, status)
      VALUES (1, 1, ?, ?, ?, ?, ?, ?, 'confirmado');
    `).run(p.forma, p.valor, p.taxa_pct, p.taxa_fixa, p.valor_taxa, p.valor_liquido);
  }

  // 5. Atualiza estoque e registra no Kardex
  const novoEstoque = prod.estoque_atual - qtdVendida; // 38.0
  db.prepare('UPDATE Produto SET estoque_atual = ? WHERE id = 1').run(novoEstoque);

  db.prepare(`
    INSERT INTO MovimentacaoEstoque (gerente_id, produto_id, tipo_operacao, quantidade, saldo_anterior, saldo_novo, custo_unitario, origem_referencia, justificativa)
    VALUES (1, 1, 'SAIDA_VENDA', ?, ?, ?, ?, 'VENDA-1', 'Venda realizada no caixa');
  `).run(-qtdVendida, prod.estoque_atual, novoEstoque, prod.preco_custo);

  // Verificações
  const prodAtualizado = db.prepare('SELECT estoque_atual FROM Produto WHERE id = 1').get();
  assert.equal(prodAtualizado.estoque_atual, 38.0);

  const kardex = db.prepare("SELECT * FROM MovimentacaoEstoque WHERE origem_referencia = 'VENDA-1'").get();
  assert.equal(kardex.tipo_operacao, 'SAIDA_VENDA');
  assert.equal(kardex.saldo_novo, 38.0);

  const pagRec = db.prepare('SELECT SUM(valor_taxa) as totalTaxa, SUM(valor_liquido) as totalLiq FROM PagamentoVenda WHERE venda_id = 1').get();
  assert.equal(pagRec.totalTaxa, 0.20);
  assert.equal(pagRec.totalLiq, 35.80);
});

test('Cenário B — Recebimento de Mercadoria, Atualização de Estoque, PMP e Kardex', () => {
  const db = setupTestDb();
  db.prepare(`INSERT INTO Usuario (id, nome, email, senha, cargo) VALUES (1, 'Admin', 'adm@mercado.com', 'hash', 'gerente');`).run();
  db.prepare(`INSERT INTO Fornecedor (id, gerente_id, razao_social) VALUES (1, 1, 'Laticínios Sul');`).run();
  
  // Produto existente: 20 unidades a R$ 5,00 cada (Valor total = R$ 100,00)
  db.prepare(`INSERT INTO Produto (id, gerente_id, nome, preco_custo, preco_venda, estoque_atual, fornecedor_id) VALUES (1, 1, 'Leite Integral 1L', 5.0, 7.50, 20.0, 1);`).run();

  // Entrada recebida: 30 unidades a R$ 6,00 cada (Valor da entrada = R$ 180,00)
  const qtdEntrada = 30;
  const custoEntrada = 6.0;
  const prodAnt = db.prepare('SELECT * FROM Produto WHERE id = 1').get();

  // Novo PMP = (20 * 5.0 + 30 * 6.0) / (20 + 30) = (100 + 180) / 50 = 280 / 50 = R$ 5,60
  const novoPMP = (prodAnt.estoque_atual * prodAnt.preco_custo + qtdEntrada * custoEntrada) / (prodAnt.estoque_atual + qtdEntrada);
  const novoSaldoEstoque = prodAnt.estoque_atual + qtdEntrada; // 50.0

  // Grava entrada
  db.prepare(`
    INSERT INTO EntradaMercadoria (id, gerente_id, fornecedor_id, numero_nota_fiscal, valor_total)
    VALUES (1, 1, 1, 'NF-8821', ?);
  `).run(qtdEntrada * custoEntrada);

  db.prepare(`
    INSERT INTO ItensEntrada (entrada_id, produto_id, quantidade, custo_unitario, custo_total, lote)
    VALUES (1, 1, ?, ?, ?, 'LOTE-A1');
  `).run(qtdEntrada, custoEntrada, qtdEntrada * custoEntrada);

  // Atualiza saldo e PMP no produto
  db.prepare(`
    UPDATE Produto 
    SET estoque_atual = ?, preco_custo = ?
    WHERE id = 1;
  `).run(novoSaldoEstoque, novoPMP);

  // Registra Kardex
  db.prepare(`
    INSERT INTO MovimentacaoEstoque (gerente_id, produto_id, tipo_operacao, quantidade, saldo_anterior, saldo_novo, custo_unitario, origem_referencia, justificativa)
    VALUES (1, 1, 'ENTRADA', ?, ?, ?, ?, 'NF-8821', 'Recebimento de mercadoria');
  `).run(qtdEntrada, prodAnt.estoque_atual, novoSaldoEstoque, custoEntrada);

  const prodAtual = db.prepare('SELECT * FROM Produto WHERE id = 1').get();
  assert.equal(prodAtual.estoque_atual, 50.0);
  assert.equal(prodAtual.preco_custo, 5.60, 'Preço Médio Ponderado deve ser exatamente 5.60');

  const mov = db.prepare("SELECT * FROM MovimentacaoEstoque WHERE origem_referencia = 'NF-8821'").get();
  assert.equal(mov.saldo_novo, 50.0);
  assert.equal(mov.tipo_operacao, 'ENTRADA');
});

test('Cenário C — Cancelamento de Venda com Autorização Gerencial, Estorno de Estoque e Pagamentos', () => {
  const db = setupTestDb();
  const senhaGerenteHash = sha256('gerente123');
  db.prepare(`INSERT INTO Usuario (id, nome, email, senha, cargo) VALUES (1, 'Gerente Geral', 'gerente@mercado.com', '${senhaGerenteHash}', 'gerente');`).run();
  db.prepare(`INSERT INTO Cliente (id, gerente_id, nome, limite_fiado, saldo_devedor) VALUES (1, 1, 'Carlos Lima', 200.0, 50.0);`).run();
  db.prepare(`INSERT INTO Produto (id, gerente_id, nome, preco_custo, preco_venda, estoque_atual) VALUES (1, 1, 'Detergente Neutro', 2.0, 3.50, 15.0);`).run();

  // Venda realizada: 5 unidades (R$ 17,50) pagas em fiado
  db.prepare(`INSERT INTO Venda (id, gerente_id, cliente_id, subtotal, total, status) VALUES (1, 1, 1, 17.50, 17.50, 'concluida');`).run();
  db.prepare(`INSERT INTO ItensVenda (venda_id, produto_id, quantidade, preco_unitario, custo_unitario_historico, subtotal) VALUES (1, 1, 5, 3.50, 2.0, 17.50);`).run();
  db.prepare(`INSERT INTO PagamentoVenda (venda_id, gerente_id, forma_pagamento, valor_pago, status, cliente_id) VALUES (1, 1, 'fiado', 17.50, 'confirmado', 1);`).run();
  // Atualiza saldo fiado e estoque
  db.prepare(`UPDATE Cliente SET saldo_devedor = saldo_devedor + 17.50 WHERE id = 1;`).run(); // 67.50
  db.prepare(`UPDATE Produto SET estoque_atual = estoque_atual - 5 WHERE id = 1;`).run(); // 10.0

  // --- PROCESSO DE CANCELAMENTO ---
  function cancelarVenda(vendaId, gerenteId, senhaGerente, justificativa) {
    if (!justificativa || justificativa.trim().length < 5) {
      throw new Error('Justificativa obrigatória (mínimo 5 caracteres).');
    }

    // 1. Autenticação gerencial
    const user = db.prepare('SELECT id, senha, cargo FROM Usuario WHERE id = ?').get(gerenteId);
    if (!user || user.cargo !== 'gerente' || user.senha !== sha256(senhaGerente)) {
      throw new Error('Credenciais gerenciais inválidas para autorização de cancelamento.');
    }

    // 2. Localiza a venda
    const venda = db.prepare('SELECT * FROM Venda WHERE id = ?').get(vendaId);
    if (!venda) throw new Error('Venda não encontrada.');
    if (venda.status === 'cancelada') throw new Error('Venda já cancelada anteriormente.');

    // 3. Atualiza status da venda
    db.prepare("UPDATE Venda SET status = 'cancelada' WHERE id = ?").run(vendaId);

    // 4. Registra auditoria do cancelamento
    db.prepare(`
      INSERT INTO CancelamentoVenda (venda_id, gerente_id, gerente_responsavel_id, motivo_justificativa)
      VALUES (?, ?, ?, ?);
    `).run(vendaId, venda.gerente_id, gerenteId, justificativa);

    // 5. Reverte estoque e gera Kardex
    const itens = db.prepare('SELECT * FROM ItensVenda WHERE venda_id = ?').all(vendaId);
    for (const item of itens) {
      const p = db.prepare('SELECT estoque_atual FROM Produto WHERE id = ?').get(item.produto_id);
      const saldoNovo = p.estoque_atual + item.quantidade;
      db.prepare('UPDATE Produto SET estoque_atual = ? WHERE id = ?').run(saldoNovo, item.produto_id);

      db.prepare(`
        INSERT INTO MovimentacaoEstoque (gerente_id, produto_id, tipo_operacao, quantidade, saldo_anterior, saldo_novo, custo_unitario, origem_referencia, justificativa)
        VALUES (?, ?, 'CANCELAMENTO_VENDA', ?, ?, ?, ?, ?, ?);
      `).run(venda.gerente_id, item.produto_id, item.quantidade, p.estoque_atual, saldoNovo, item.custo_unitario_historico, `CANCEL-VENDA-${vendaId}`, justificativa);
    }

    // 6. Estorna pagamentos e caderneta
    const pagamentos = db.prepare('SELECT * FROM PagamentoVenda WHERE venda_id = ?').all(vendaId);
    for (const pag of pagamentos) {
      db.prepare("UPDATE PagamentoVenda SET status = 'estornado' WHERE id = ?").run(pag.id);
      if (pag.forma_pagamento === 'fiado' && pag.cliente_id) {
        db.prepare('UPDATE Cliente SET saldo_devedor = MAX(0, saldo_devedor - ?) WHERE id = ?').run(pag.valor_pago, pag.cliente_id);
      }
    }

    return true;
  }

  // Falha: senha gerencial incorreta
  assert.throws(() => {
    cancelarVenda(1, 1, 'senha_errada', 'Cliente desistiu');
  }, /Credenciais gerenciais inválidas/);

  // Sucesso com senha correta
  const sucesso = cancelarVenda(1, 1, 'gerente123', 'Cliente desistiu da compra antes de retirar');
  assert.equal(sucesso, true);

  // Verificações
  const vendaCancelada = db.prepare('SELECT status FROM Venda WHERE id = 1').get();
  assert.equal(vendaCancelada.status, 'cancelada');

  const prodRevertido = db.prepare('SELECT estoque_atual FROM Produto WHERE id = 1').get();
  assert.equal(prodRevertido.estoque_atual, 15.0, 'Estoque deve voltar a 15.0 unidades');

  const clienteRevertido = db.prepare('SELECT saldo_devedor FROM Cliente WHERE id = 1').get();
  assert.equal(clienteRevertido.saldo_devedor, 50.0, 'Dívida de fiado de R$ 17.50 deve ser estornada');

  // Prevenção de duplicidade: não pode cancelar de novo
  assert.throws(() => {
    cancelarVenda(1, 1, 'gerente123', 'Tentando cancelar novamente');
  }, /já cancelada/);
});

test('Cenário D — Devolução Parcial com Triagem de Apto/Avaria, Estorno Proporcional e Comprovante', () => {
  const db = setupTestDb();
  db.prepare(`INSERT INTO Usuario (id, nome, email, senha, cargo) VALUES (1, 'Vendedor 1', 'v1@mercado.com', 'hash', 'balconista');`).run();
  db.prepare(`INSERT INTO Produto (id, gerente_id, nome, preco_custo, preco_venda, estoque_atual) VALUES (1, 1, 'Biscoito Recheado', 2.0, 4.00, 10.0);`).run();

  // Venda de 4 biscoitos (4 * 4.00 = R$ 16,00). Estoque vai para 6
  db.prepare(`INSERT INTO Venda (id, gerente_id, subtotal, total, status) VALUES (1, 1, 16.0, 16.0, 'concluida');`).run();
  db.prepare(`INSERT INTO ItensVenda (id, venda_id, produto_id, quantidade, preco_unitario, custo_unitario_historico, subtotal) VALUES (1, 1, 1, 4, 4.00, 2.0, 16.0);`).run();
  db.prepare(`UPDATE Produto SET estoque_atual = 6.0 WHERE id = 1;`).run();

  // Devolução parcial: Cliente traz de volta 2 biscoitos:
  // - 1 apto para revenda (deve voltar ao estoque de 6 -> 7)
  // - 1 quebrado/avariado (NÃO deve voltar ao estoque para venda, deve ser registrado como avaria)
  function processarDevolucao(vendaId, itensParaDevolver, motivo) {
    let valorTotalEstorno = 0;

    // Cria registro mestre da devolução
    db.prepare(`
      INSERT INTO DevolucaoVenda (id, venda_id, gerente_id, valor_estornado, motivo)
      VALUES (1, ?, 1, 0, ?);
    `).run(vendaId, motivo);

    for (const itemDev of itensParaDevolver) {
      const itemOrig = db.prepare('SELECT * FROM ItensVenda WHERE venda_id = ? AND produto_id = ?').get(vendaId, itemDev.produto_id);
      if (!itemOrig) throw new Error('Item não pertence à venda.');

      // Validação de quantidade máxima devolvível
      const devAnteriores = db.prepare(`
        SELECT COALESCE(SUM(id_dev.quantidade), 0) as jaDevolvido
        FROM ItensDevolucao id_dev
        JOIN DevolucaoVenda dv ON dv.id = id_dev.devolucao_id
        WHERE dv.venda_id = ? AND id_dev.produto_id = ? AND dv.id != 1;
      `).get(vendaId, itemDev.produto_id);

      const maxPermitido = itemOrig.quantidade - (devAnteriores?.jaDevolvido || 0);
      if (itemDev.quantidade > maxPermitido) {
        throw new Error(`Quantidade a devolver (${itemDev.quantidade}) excede o saldo da venda (${maxPermitido}).`);
      }

      const valorUnitario = itemOrig.preco_unitario;
      const subtotalEstorno = itemDev.quantidade * valorUnitario;
      valorTotalEstorno += subtotalEstorno;

      db.prepare(`
        INSERT INTO ItensDevolucao (devolucao_id, produto_id, quantidade, valor_unitario, subtotal_estornado, apto_revenda)
        VALUES (1, ?, ?, ?, ?, ?);
      `).run(itemDev.produto_id, itemDev.quantidade, valorUnitario, subtotalEstorno, itemDev.apto_revenda ? 1 : 0);

      // Reincorporação condicional ao estoque
      const prod = db.prepare('SELECT estoque_atual FROM Produto WHERE id = ?').get(itemDev.produto_id);
      if (itemDev.apto_revenda) {
        const saldoNovo = prod.estoque_atual + itemDev.quantidade;
        db.prepare('UPDATE Produto SET estoque_atual = ? WHERE id = ?').run(saldoNovo, itemDev.produto_id);
        db.prepare(`
          INSERT INTO MovimentacaoEstoque (gerente_id, produto_id, tipo_operacao, quantidade, saldo_anterior, saldo_novo, origem_referencia, justificativa)
          VALUES (1, ?, 'DEVOLUCAO', ?, ?, ?, 'DEV-VENDA-1', 'Item devolvido apto para revenda');
        `).run(itemDev.produto_id, itemDev.quantidade, prod.estoque_atual, saldoNovo);
      } else {
        // Não aumenta estoque vendível; registra avaria
        db.prepare(`
          INSERT INTO MovimentacaoEstoque (gerente_id, produto_id, tipo_operacao, quantidade, saldo_anterior, saldo_novo, origem_referencia, justificativa)
          VALUES (1, ?, 'AVARIA', 0, ?, ?, 'DEV-VENDA-1', 'Item devolvido avariado / impróprio');
        `).run(itemDev.produto_id, prod.estoque_atual, prod.estoque_atual);
      }
    }

    db.prepare('UPDATE DevolucaoVenda SET valor_estornado = ? WHERE id = 1').run(valorTotalEstorno);
    db.prepare("UPDATE Venda SET status = 'devolvida_parcial' WHERE id = ?").run(vendaId);

    return {
      comprovante: {
        devolucao_id: 1,
        venda_id: vendaId,
        valor_estornado: valorTotalEstorno,
        data: new Date().toISOString()
      }
    };
  }

  // Devolve 1 apto e 1 não apto
  const resultado = processarDevolucao(1, [
    { produto_id: 1, quantidade: 1, apto_revenda: true },
    { produto_id: 1, quantidade: 1, apto_revenda: false }
  ], 'Cliente comprou sabor trocado');

  assert.equal(resultado.comprovante.valor_estornado, 8.00); // 2 * 4.00 = R$ 8,00

  // Estoque deve ser 6 + 1 (apto) = 7. O não apto NÃO reincorpora ao estoque vendível!
  const prodFinal = db.prepare('SELECT estoque_atual FROM Produto WHERE id = 1').get();
  assert.equal(prodFinal.estoque_atual, 7.00, 'Apenas itens aptos devem ser reincorporados ao estoque');

  const vendaStatus = db.prepare('SELECT status FROM Venda WHERE id = 1').get();
  assert.equal(vendaStatus.status, 'devolvida_parcial');
});

test('Cenário E — Registro de Baixa de Estoque por Perda/Avaria com Kardex e Custo', () => {
  const db = setupTestDb();
  db.prepare(`INSERT INTO Usuario (id, nome, email, senha, cargo) VALUES (1, 'Auditor', 'auditor@mercado.com', 'hash', 'gerente');`).run();
  db.prepare(`INSERT INTO Produto (id, gerente_id, nome, preco_custo, preco_venda, estoque_atual) VALUES (1, 1, 'Vinho Tinto Seco', 25.0, 45.0, 8.0);`).run();

  function registrarPerda(produtoId, quantidade, motivoTipo, justificativa, usuarioId) {
    const prod = db.prepare('SELECT * FROM Produto WHERE id = ?').get(produtoId);
    if (!prod) throw new Error('Produto não encontrado.');

    if (quantidade <= 0) throw new Error('Quantidade inválida.');
    if (prod.estoque_atual < quantidade) {
      throw new Error(`Saldo insuficiente para baixa! Disponível: ${prod.estoque_atual}, Informado: ${quantidade}`);
    }

    const custoAplicado = prod.preco_custo;
    const impactoFinanceiro = Math.round(quantidade * custoAplicado * 100) / 100;
    const saldoNovo = prod.estoque_atual - quantidade;

    // Atualiza estoque
    db.prepare('UPDATE Produto SET estoque_atual = ? WHERE id = ?').run(saldoNovo, produtoId);

    // Registra Perda
    db.prepare(`
      INSERT INTO PerdaEstoque (gerente_id, produto_id, quantidade, motivo_tipo, justificativa, custo_unitario_aplicado, impacto_financeiro, usuario_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?);
    `).run(prod.gerente_id, produtoId, quantidade, motivoTipo, justificativa, custoAplicado, impactoFinanceiro, usuarioId);

    // Registra Kardex
    db.prepare(`
      INSERT INTO MovimentacaoEstoque (gerente_id, produto_id, tipo_operacao, quantidade, saldo_anterior, saldo_novo, custo_unitario, origem_referencia, justificativa, usuario_id)
      VALUES (?, ?, 'PERDA', ?, ?, ?, ?, 'BAIXA_PERDA', ?, ?);
    `).run(prod.gerente_id, produtoId, -quantidade, prod.estoque_atual, saldoNovo, custoAplicado, justificativa, usuarioId);

    return { impactoFinanceiro, saldoNovo };
  }

  // Falha: tenta baixar 10 garrafas quando só existem 8
  assert.throws(() => {
    registrarPerda(1, 10, 'quebra', 'Garrafa caiu no chão da adega', 1);
  }, /Saldo insuficiente/);

  // Sucesso: baixa de 2 garrafas quebradas (Impacto: 2 * 25.00 = R$ 50,00)
  const res = registrarPerda(1, 2, 'quebra', 'Garrafa caiu da prateleira ao repor', 1);
  assert.equal(res.impactoFinanceiro, 50.0);
  assert.equal(res.saldoNovo, 6.0);

  const prodPos = db.prepare('SELECT estoque_atual FROM Produto WHERE id = 1').get();
  assert.equal(prodPos.estoque_atual, 6.0);

  const perdaRegistrada = db.prepare('SELECT * FROM PerdaEstoque WHERE produto_id = 1').get();
  assert.equal(perdaRegistrada.motivo_tipo, 'quebra');
  assert.equal(perdaRegistrada.impacto_financeiro, 50.0);

  const kardex = db.prepare("SELECT * FROM MovimentacaoEstoque WHERE tipo_operacao = 'PERDA'").get();
  assert.equal(kardex.saldo_novo, 6.0);
  assert.equal(kardex.quantidade, -2.0);
});

test('Cenário F — Dashboard Financeiro Consolidado com Canais e Dedução de Canceladas', () => {
  const db = setupTestDb();
  
  // Venda 1: Balcão Concluída (R$ 100, CMV R$ 60, Taxa R$ 2)
  db.prepare(`INSERT INTO Venda (id, gerente_id, total, status, canal_venda) VALUES (1, 1, 100.0, 'concluida', 'balcao');`).run();
  db.prepare(`INSERT INTO PagamentoVenda (venda_id, gerente_id, forma_pagamento, valor_pago, valor_taxa, status) VALUES (1, 1, 'pix', 100.0, 2.0, 'confirmado');`).run();

  // Venda 2: Delivery Concluída (R$ 150, CMV R$ 80, Taxa R$ 5)
  db.prepare(`INSERT INTO Venda (id, gerente_id, total, status, canal_venda) VALUES (2, 1, 150.0, 'concluida', 'delivery');`).run();
  db.prepare(`INSERT INTO PagamentoVenda (venda_id, gerente_id, forma_pagamento, valor_pago, valor_taxa, status) VALUES (2, 1, 'cartao_credito', 150.0, 5.0, 'confirmado');`).run();

  // Venda 3: CANCELADA (R$ 200) -> NÃO PODE entrar no faturamento nem nas taxas elegíveis!
  db.prepare(`INSERT INTO Venda (id, gerente_id, total, status, canal_venda) VALUES (3, 1, 200.0, 'cancelada', 'balcao');`).run();
  db.prepare(`INSERT INTO PagamentoVenda (venda_id, gerente_id, forma_pagamento, valor_pago, valor_taxa, status) VALUES (3, 1, 'dinheiro', 200.0, 0.0, 'estornado');`).run();

  // Query de faturamento elegível
  const faturamento = db.prepare(`
    SELECT 
      SUM(total) as faturamentoElegivel,
      COUNT(id) as totalVendas
    FROM Venda 
    WHERE status != 'cancelada' AND gerente_id = 1;
  `).get();

  assert.equal(faturamento.faturamentoElegivel, 250.0, 'Faturamento elegível deve ser 100 + 150 = 250 (excluindo os 200 da cancelada)');
  assert.equal(faturamento.totalVendas, 2);

  // Query de taxas ativas
  const taxas = db.prepare(`
    SELECT SUM(pv.valor_taxa) as totalTaxas
    FROM PagamentoVenda pv
    JOIN Venda v ON v.id = pv.venda_id
    WHERE v.status != 'cancelada' AND pv.status = 'confirmado' AND v.gerente_id = 1;
  `).get();

  assert.equal(taxas.totalTaxas, 7.0, 'Taxas operacionais elegíveis: 2 + 5 = 7.0');

  // Agregação por canal de venda
  const porCanal = db.prepare(`
    SELECT 
      canal_venda, 
      SUM(total) as totalCanal 
    FROM Venda 
    WHERE status != 'cancelada' AND gerente_id = 1 
    GROUP BY canal_venda;
  `).all();

  const mapaCanais = Object.fromEntries(porCanal.map(c => [c.canal_venda, c.totalCanal]));
  assert.equal(mapaCanais['balcao'], 100.0);
  assert.equal(mapaCanais['delivery'], 150.0);
  assert.equal(mapaCanais['encomenda'], undefined);
});
