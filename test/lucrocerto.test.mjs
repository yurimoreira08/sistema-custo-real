import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { 
  round2, 
  round3, 
  toCents, 
  fromCents, 
  sumMoney, 
  subtractMoney, 
  multiplyMoney, 
  calcularTaxaMonetaria, 
  validarIgualdadeMonetaria, 
  calcularProporcional 
} from '../src/utils/money.js';
import { 
  validarCPF, 
  validarCNPJ, 
  validarDocumento, 
  validarTelefone, 
  formatarDocumento, 
  formatarTelefone 
} from '../src/utils/validators.js';

// ============================================================================
// SUÍTE DE TESTES AUTOMATIZADOS: LUCROCERTO (SEMANAS S01 A S05)
// Integrantes:
//   - Francisco Yuri da Silva Mauriz (Financeiro, Taxas, Lucro Real, Auditoria Contábil)
//   - Yuri Kauan Ibiapino Moreira (Vendas, Carrinho, Cancelamento, Devoluções, Integridade)
//   - José da Luz Coelho Neto (Estoque, Fornecedores, Kardex, PMP, Auditoria Kardex e Perdas)
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
      bloqueado_inadimplente INTEGER NOT NULL DEFAULT 0,
      motivo_bloqueio TEXT,
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
      status TEXT NOT NULL DEFAULT 'concluida' CHECK(status IN ('concluida', 'cancelada', 'devolvida_parcial', 'totalmente_devolvida')),
      canal_venda TEXT NOT NULL DEFAULT 'balcao' CHECK(canal_venda IN ('balcao', 'delivery', 'encomenda')),
      observacoes TEXT,
      turno_caixa_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (cliente_id) REFERENCES Cliente(id)
    );

    CREATE TABLE ItensVenda (
      gerente_id INTEGER NOT NULL DEFAULT 1,
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
      turno_caixa_id INTEGER,
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
      data_validade TEXT,
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

    CREATE TABLE TurnoCaixa (
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
      data_abertura TEXT DEFAULT CURRENT_TIMESTAMP,
      data_bloqueio TEXT,
      data_fechamento TEXT,
      FOREIGN KEY (operador_id) REFERENCES Usuario(id)
    );

    CREATE TABLE MovimentacaoCaixa (
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
      comprovante_hash TEXT,
      assinatura_digital TEXT,
      data_movimentacao TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (turno_caixa_id) REFERENCES TurnoCaixa(id),
      FOREIGN KEY (operador_id) REFERENCES Usuario(id)
    );

    CREATE TABLE PagamentoDebitoCliente (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gerente_id INTEGER NOT NULL,
      cliente_id INTEGER NOT NULL,
      operador_id INTEGER NOT NULL,
      valor REAL NOT NULL,
      forma_pagamento TEXT NOT NULL DEFAULT 'dinheiro',
      observacoes TEXT,
      saldo_anterior REAL NOT NULL,
      saldo_resultante REAL NOT NULL,
      data_pagamento TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (cliente_id) REFERENCES Cliente(id),
      FOREIGN KEY (operador_id) REFERENCES Usuario(id)
    );

    CREATE TABLE LoteEstoque (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gerente_id INTEGER NOT NULL,
      produto_id INTEGER NOT NULL,
      entrada_id INTEGER,
      item_entrada_id INTEGER,
      numero_lote TEXT NOT NULL,
      data_entrada TEXT DEFAULT CURRENT_TIMESTAMP,
      data_validade TEXT,
      quantidade_inicial REAL NOT NULL,
      quantidade_saldo REAL NOT NULL,
      custo_unitario REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'ativo' CHECK(status IN ('ativo', 'esgotado', 'vencido')),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (produto_id) REFERENCES Produto(id)
    );

    CREATE VIEW IF NOT EXISTS vw_triagem_validade_lotes AS
    SELECT 
      le.id,
      le.gerente_id,
      le.produto_id,
      p.nome AS produto_nome,
      p.categoria AS produto_categoria,
      le.numero_lote,
      le.data_entrada,
      le.data_validade,
      le.quantidade_saldo,
      le.custo_unitario,
      ROUND(le.quantidade_saldo * le.custo_unitario, 2) AS capital_parado,
      CASE 
        WHEN DATE(le.data_validade) < DATE('now') THEN 'VENCIDO'
        WHEN DATE(le.data_validade) <= DATE('now', '+7 days') THEN 'RISCO_CRITICO'
        WHEN DATE(le.data_validade) <= DATE('now', '+15 days') THEN 'RISCO_MEDIO'
        WHEN DATE(le.data_validade) <= DATE('now', '+30 days') THEN 'ALERTA'
        ELSE 'SEGURO'
      END AS faixa_risco
    FROM LoteEstoque le
    JOIN Produto p ON p.id = le.produto_id
    WHERE le.quantidade_saldo > 0 AND le.status = 'ativo' AND le.data_validade IS NOT NULL;
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

// ============================================================================
// TESTES ESPECÍFICOS: SEMANA S05
// ============================================================================

test('S05 — Francisco Yuri Mauriz: Precisão Decimal, Arredondamento e Consistência Contábil', () => {
  // 1. Precisão decimal estrita e eliminação de drift binário
  assert.equal(round2(0.1 + 0.2), 0.30, '0.1 + 0.2 deve arredondar para exatamente 0.30');
  assert.equal(round2(10.005), 10.01, 'Arredondamento determinístico de meio centavo');
  assert.equal(toCents(19.99), 1999);
  assert.equal(fromCents(1999), 19.99);
  assert.equal(sumMoney(10.15, 20.25, 30.33), 60.73);
  assert.equal(subtractMoney(100.00, 33.33, 33.33), 33.34);

  // 2. Cálculo determinístico de taxas percentuais e fixas
  // Exemplo fracionário: R$ 33,33 com taxa percentual de 2,75% e taxa fixa de R$ 0,15
  const calcFrac = calcularTaxaMonetaria(33.33, 2.75, 0.15);
  // 3333 centavos * 2.75% = 91.6575 -> 92 centavos variáveis + 15 centavos fixos = 107 centavos (R$ 1.07)
  assert.equal(calcFrac.valorTaxa, 1.07);
  assert.equal(calcFrac.valorLiquido, 32.26);
  assert.equal(sumMoney(calcFrac.valorTaxa, calcFrac.valorLiquido), 33.33, 'Soma de taxa e líquido deve ser idêntica ao bruto');

  // 3. Validação de pagamentos mistos divididos com ajuste de centavos
  const vendaTotal = 100.00;
  const pagamentosValidos = [
    { valor: 33.33 },
    { valor: 33.33 },
    { valor: 33.34 }
  ];
  const checagemOk = validarIgualdadeMonetaria(vendaTotal, pagamentosValidos);
  assert.equal(checagemOk.valido, true);
  assert.equal(checagemOk.recebido, 100.00);

  // Diferença de 1 centavo deve ser rejeitada
  const pagamentosComDiferenca = [
    { valor: 33.33 },
    { valor: 33.33 },
    { valor: 33.33 }
  ];
  const checagemErro = validarIgualdadeMonetaria(vendaTotal, pagamentosComDiferenca);
  assert.equal(checagemErro.valido, false);
  assert.equal(checagemErro.diferenca, -0.01);

  // 4. Rotina de Auditoria Contábil
  const db = setupTestDb();
  db.prepare(`INSERT INTO Usuario (id, nome, email, senha, cargo) VALUES (1, 'Gerente', 'gerente@teste.com', 'hash', 'gerente');`).run();

  // Venda 1: Válida e Conforme (R$ 100,00, sem desconto)
  db.prepare(`
    INSERT INTO Venda (id, gerente_id, subtotal, desconto, total, status, canal_venda)
    VALUES (1, 1, 100.0, 0.0, 100.0, 'concluida', 'balcao');
  `).run();
  db.prepare(`
    INSERT INTO PagamentoVenda (venda_id, gerente_id, forma_pagamento, valor_pago, valor_taxa, valor_liquido, status)
    VALUES (1, 1, 'pix', 100.0, 1.0, 99.0, 'confirmado');
  `).run();

  // Venda 2: Cancelada com Pagamento Estornado e Auditoria Registrada
  db.prepare(`
    INSERT INTO Venda (id, gerente_id, subtotal, desconto, total, status, canal_venda)
    VALUES (2, 1, 50.0, 0.0, 50.0, 'cancelada', 'balcao');
  `).run();
  db.prepare(`
    INSERT INTO PagamentoVenda (venda_id, gerente_id, forma_pagamento, valor_pago, valor_taxa, valor_liquido, status)
    VALUES (2, 1, 'dinheiro', 50.0, 0.0, 50.0, 'estornado');
  `).run();
  db.prepare(`
    INSERT INTO CancelamentoVenda (id, venda_id, gerente_id, gerente_responsavel_id, motivo_justificativa)
    VALUES (1, 2, 1, 1, 'Cancelamento solicitado pelo cliente');
  `).run();

  function auditarContabil(dbInst, gerenteId) {
    const vendas = dbInst.prepare('SELECT * FROM Venda WHERE gerente_id = ?').all(gerenteId);
    let conformes = 0;
    const divergencias = [];

    for (const v of vendas) {
      let ok = true;
      const pagamentos = dbInst.prepare('SELECT * FROM PagamentoVenda WHERE venda_id = ?').all(v.id);
      const somaPag = pagamentos.reduce((acc, p) => acc + toCents(p.valor_pago), 0);
      
      if (somaPag !== toCents(v.total)) {
        ok = false;
        divergencias.push({ vendaId: v.id, motivo: 'SOMA_PAGAMENTOS_DIVERGENTE' });
      }

      for (const p of pagamentos) {
        if (toCents(p.valor_taxa) + toCents(p.valor_liquido) !== toCents(p.valor_pago)) {
          ok = false;
          divergencias.push({ vendaId: v.id, motivo: 'TAXA_MAIS_LIQUIDO_DIVERGE' });
        }
      }

      if (v.status === 'cancelada') {
        const naoEstornados = pagamentos.filter(p => p.status !== 'estornado');
        if (naoEstornados.length > 0) {
          ok = false;
          divergencias.push({ vendaId: v.id, motivo: 'PAGAMENTO_CANCELADO_ATIVO' });
        }
        const canc = dbInst.prepare('SELECT id FROM CancelamentoVenda WHERE venda_id = ?').get(v.id);
        if (!canc) {
          ok = false;
          divergencias.push({ vendaId: v.id, motivo: 'SEM_REGISTRO_CANCELAMENTO' });
        }
      }

      if (ok) conformes++;
    }

    return {
      totalVendasAuditadas: vendas.length,
      vendasConformes: conformes,
      vendasComDivergencia: divergencias.length,
      divergencias,
      statusGeral: divergencias.length === 0 ? 'CONFORME' : 'DIVERGENCIA_ENCONTRADA'
    };
  }

  const resAuditoria1 = auditarContabil(db, 1);
  assert.equal(resAuditoria1.statusGeral, 'CONFORME');
  assert.equal(resAuditoria1.totalVendasAuditadas, 2);
  assert.equal(resAuditoria1.vendasConformes, 2);
  assert.equal(resAuditoria1.vendasComDivergencia, 0);

  // Introduz anomalia intencional: Venda 3 cancelada, mas com pagamento ainda como 'confirmado'
  db.prepare(`
    INSERT INTO Venda (id, gerente_id, subtotal, desconto, total, status, canal_venda)
    VALUES (3, 1, 80.0, 0.0, 80.0, 'cancelada', 'balcao');
  `).run();
  db.prepare(`
    INSERT INTO PagamentoVenda (venda_id, gerente_id, forma_pagamento, valor_pago, valor_taxa, valor_liquido, status)
    VALUES (3, 1, 'pix', 80.0, 0.80, 79.20, 'confirmado');
  `).run();

  const resAuditoria2 = auditarContabil(db, 1);
  assert.equal(resAuditoria2.statusGeral, 'DIVERGENCIA_ENCONTRADA');
  assert.equal(resAuditoria2.vendasComDivergencia > 0, true);
  assert.equal(resAuditoria2.divergencias.some(d => d.vendaId === 3), true);
});

test('S05 — Yuri Kauan Ibiapino Moreira: Integridade de Fluxo, Cancelamento Único, Devoluções e Concorrência', () => {
  const db = setupTestDb();
  db.prepare(`INSERT INTO Usuario (id, nome, email, senha, cargo) VALUES (1, 'Gerente', 'gerente@teste.com', 'hash', 'gerente');`).run();
  db.prepare(`INSERT INTO Produto (id, gerente_id, nome, preco_custo, preco_venda, estoque_atual) VALUES (1, 1, 'Produto Teste', 10.0, 20.0, 50.0);`).run();

  // Venda inicial de 5 unidades
  db.prepare(`INSERT INTO Venda (id, gerente_id, total, status) VALUES (1, 1, 100.0, 'concluida');`).run();
  db.prepare(`INSERT INTO ItensVenda (id, venda_id, produto_id, quantidade, preco_unitario, subtotal) VALUES (1, 1, 1, 5, 20.0, 100.0);`).run();
  db.prepare(`INSERT INTO PagamentoVenda (id, venda_id, gerente_id, forma_pagamento, valor_pago, valor_taxa, status) VALUES (1, 1, 1, 'dinheiro', 100.0, 0.0, 'confirmado');`).run();

  // 1. Cancelamento com bloqueio de duplicidade
  function cancelarVenda(vendaId, justificativa) {
    const venda = db.prepare('SELECT * FROM Venda WHERE id = ?').get(vendaId);
    if (!venda) throw new Error('Venda não encontrada.');
    if (venda.status === 'cancelada') {
      throw new Error('Esta venda já foi cancelada anteriormente.');
    }
    if (venda.status === 'totalmente_devolvida') {
      throw new Error('Esta venda já teve todos os seus itens devolvidos.');
    }

    db.prepare("UPDATE Venda SET status = 'cancelada' WHERE id = ?").run(vendaId);
    db.prepare("UPDATE PagamentoVenda SET status = 'estornado' WHERE venda_id = ?").run(vendaId);
    db.prepare(`
      INSERT INTO CancelamentoVenda (venda_id, gerente_id, gerente_responsavel_id, motivo_justificativa)
      VALUES (?, 1, 1, ?);
    `).run(vendaId, justificativa);

    return { sucesso: true };
  }

  // Primeiro cancelamento: deve ter sucesso
  const canc1 = cancelarVenda(1, 'Cliente desistiu');
  assert.equal(canc1.sucesso, true);

  // Segundo cancelamento da MESMA venda: deve ser estritamente impedido
  assert.throws(() => {
    cancelarVenda(1, 'Tentativa duplicada');
  }, /Esta venda já foi cancelada anteriormente/);

  // 2. Impedir devolução sobre venda cancelada
  function processarDevolucaoItem(vendaId, produtoId, qtdDevolver, aptoRevenda) {
    const venda = db.prepare('SELECT status FROM Venda WHERE id = ?').get(vendaId);
    if (!venda) throw new Error('Venda não encontrada.');
    if (venda.status === 'cancelada') {
      throw new Error('Não é possível realizar devolução de uma venda já cancelada.');
    }
    if (venda.status === 'totalmente_devolvida') {
      throw new Error('Esta venda já teve todos os seus itens devolvidos.');
    }
    return true;
  }

  assert.throws(() => {
    processarDevolucaoItem(1, 1, 1, true);
  }, /Não é possível realizar devolução de uma venda já cancelada/);

  // 3. Devoluções sucessivas respeitando o teto original (Venda 2 com 5 unidades)
  db.prepare(`INSERT INTO Venda (id, gerente_id, total, status) VALUES (2, 1, 100.0, 'concluida');`).run();
  db.prepare(`INSERT INTO ItensVenda (id, venda_id, produto_id, quantidade, preco_unitario, subtotal) VALUES (2, 2, 1, 5, 20.0, 100.0);`).run();

  function devolucoesSucessivas(vendaId, produtoId, qtdDevolver) {
    const itemOrig = db.prepare('SELECT * FROM ItensVenda WHERE venda_id = ? AND produto_id = ?').get(vendaId, produtoId);
    const devsAnteriores = db.prepare(`
      SELECT COALESCE(SUM(id_dev.quantidade), 0) as jaDevolvido
      FROM ItensDevolucao id_dev
      JOIN DevolucaoVenda dv ON dv.id = id_dev.devolucao_id
      WHERE dv.venda_id = ? AND id_dev.produto_id = ?;
    `).get(vendaId, produtoId);

    const saldoDevoluvel = itemOrig.quantidade - (devsAnteriores?.jaDevolvido || 0);
    if (qtdDevolver > saldoDevoluvel) {
      throw new Error(`Quantidade solicitada (${qtdDevolver}) excede o saldo disponível para devolução (${saldoDevoluvel}).`);
    }

    // Registra devolução
    const resDev = db.prepare(`
      INSERT INTO DevolucaoVenda (venda_id, gerente_id, valor_estornado, motivo)
      VALUES (?, 1, ?, 'Devolução parcial');
    `).run(vendaId, qtdDevolver * itemOrig.preco_unitario);

    db.prepare(`
      INSERT INTO ItensDevolucao (devolucao_id, produto_id, quantidade, valor_unitario, subtotal_estornado, apto_revenda)
      VALUES (?, ?, ?, ?, ?, 1);
    `).run(resDev.lastInsertRowid, produtoId, qtdDevolver, itemOrig.preco_unitario, qtdDevolver * itemOrig.preco_unitario);

    const novoSaldo = saldoDevoluvel - qtdDevolver;
    if (novoSaldo <= 0) {
      db.prepare("UPDATE Venda SET status = 'totalmente_devolvida' WHERE id = ?").run(vendaId);
    } else {
      db.prepare("UPDATE Venda SET status = 'devolvida_parcial' WHERE id = ?").run(vendaId);
    }

    return { saldoRestante: novoSaldo };
  }

  // Devolução 1: devolve 2 unidades (saldo passa a ser 3)
  const d1 = devolucoesSucessivas(2, 1, 2);
  assert.equal(d1.saldoRestante, 3);

  // Devolução 2: devolve 3 unidades (saldo passa a ser 0 e status vira totalmente_devolvida)
  const d2 = devolucoesSucessivas(2, 1, 3);
  assert.equal(d2.saldoRestante, 0);

  // Devolução 3: tenta devolver mais 1 unidade -> deve falhar
  assert.throws(() => {
    devolucoesSucessivas(2, 1, 1);
  }, /excede o saldo disponível/);

  // 4. Teste de trava de concorrência por venda (mutex)
  const activeLocks = new Set();
  function withTestLock(vendaId, fn) {
    if (activeLocks.has(vendaId)) {
      throw new Error(`Operação concorrente bloqueada para a venda #${vendaId}.`);
    }
    activeLocks.add(vendaId);
    try {
      return fn();
    } finally {
      activeLocks.delete(vendaId);
    }
  }

  // Primeira operação adquire trava
  activeLocks.add(99);
  // Segunda operação concorrente deve ser rejeitada
  assert.throws(() => {
    withTestLock(99, () => 'executou');
  }, /Operação concorrente bloqueada/);
  activeLocks.delete(99);

  // 5. Teste de Rollback em falha de operação
  db.exec('BEGIN TRANSACTION;');
  try {
    db.prepare("INSERT INTO Venda (id, gerente_id, total, status) VALUES (999, 1, 50.0, 'concluida');").run();
    // Simula erro forçado
    throw new Error('Falha simulada durante processamento');
  } catch (err) {
    db.exec('ROLLBACK;');
  }

  // Verifica que a venda 999 NÃO foi persistida
  const vendaOrfa = db.prepare('SELECT * FROM Venda WHERE id = 999').get();
  assert.equal(vendaOrfa, undefined, 'A transação com falha deve ter sofrido rollback completo sem deixar dados órfãos');
});

test('S05 — José da Luz Coelho Neto: Auditoria de Kardex, Reconstrução de Saldo e Relatório Gerencial de Perdas e Avarias', () => {
  const db = setupTestDb();
  db.prepare(`INSERT INTO Usuario (id, nome, email, senha, cargo) VALUES (1, 'Auditor Zé Neto', 'zeneto@teste.com', 'hash', 'gerente');`).run();
  db.prepare(`INSERT INTO Fornecedor (id, gerente_id, razao_social) VALUES (1, 1, 'Distribuidora Premium');`).run();
  db.prepare(`INSERT INTO Produto (id, gerente_id, nome, preco_custo, preco_venda, estoque_atual, fornecedor_id, categoria) VALUES (1, 1, 'Suco de Uva 1L', 8.0, 14.0, 0, 1, 'Bebidas');`).run();

  function lancarKardex(produtoId, tipo, qtd, saldoAnt, saldoNovo, custo, just) {
    db.prepare(`
      INSERT INTO MovimentacaoEstoque (gerente_id, produto_id, tipo_operacao, quantidade, saldo_anterior, saldo_novo, custo_unitario, justificativa)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?);
    `).run(produtoId, tipo, qtd, saldoAnt, saldoNovo, custo, just);
  }

  // Sequência de eventos no estoque:
  // 1. Entrada de 100 unidades (0 -> 100)
  lancarKardex(1, 'ENTRADA', 100, 0, 100, 8.0, 'Entrada de compra NF-100');
  // 2. Venda de 30 unidades (100 -> 70)
  lancarKardex(1, 'SAIDA_VENDA', -30, 100, 70, 8.0, 'Venda balcão');
  // 3. Cancelamento de venda com estorno de 10 unidades (70 -> 80)
  lancarKardex(1, 'CANCELAMENTO_VENDA', 10, 70, 80, 8.0, 'Estorno cancelamento');
  // 4. Perda por avaria de 5 unidades (80 -> 75)
  lancarKardex(1, 'PERDA', -5, 80, 75, 8.0, 'Quebra no transporte');
  // 5. Devolução de cliente de 2 unidades aptas (75 -> 77)
  lancarKardex(1, 'DEVOLUCAO', 2, 75, 77, 8.0, 'Devolução cliente apto');

  // Atualiza estoque atual para 77
  db.prepare('UPDATE Produto SET estoque_atual = 77 WHERE id = 1').run();

  // Rotina de auditoria de reconstrução de saldo
  function auditarProdutoKardex(produtoId) {
    const prod = db.prepare('SELECT * FROM Produto WHERE id = ?').get(produtoId);
    const movs = db.prepare('SELECT * FROM MovimentacaoEstoque WHERE produto_id = ? ORDER BY id ASC').all(produtoId);

    let saldoReconstruido = 0;
    const errosContinuidade = [];
    let ultimoSaldo = null;

    if (movs.length > 0) {
      saldoReconstruido = movs[0].saldo_anterior;
      ultimoSaldo = saldoReconstruido;

      for (let i = 0; i < movs.length; i++) {
        const m = movs[i];
        if (i > 0 && Math.abs(m.saldo_anterior - ultimoSaldo) > 0.001) {
          errosContinuidade.push({ movId: m.id, tipo: 'SALTO_DE_SALDO' });
        }
        const calcNovo = round3(m.saldo_anterior + m.quantidade);
        if (Math.abs(calcNovo - m.saldo_novo) > 0.001) {
          errosContinuidade.push({ movId: m.id, tipo: 'CALCULO_RESULTANTE_INVALIDO' });
        }
        saldoReconstruido = m.saldo_novo;
        ultimoSaldo = m.saldo_novo;
      }
    } else {
      saldoReconstruido = prod.estoque_atual;
    }

    const divergencia = round3(prod.estoque_atual - saldoReconstruido);
    return {
      produtoId: prod.id,
      nome: prod.nome,
      estoqueAtual: prod.estoque_atual,
      saldoReconstruido,
      divergencia,
      conforme: Math.abs(divergencia) < 0.001 && errosContinuidade.length === 0,
      errosContinuidade
    };
  }

  // Auditoria 1: Deve certificar conformidade 100%
  const aud1 = auditarProdutoKardex(1);
  assert.equal(aud1.conforme, true);
  assert.equal(aud1.saldoReconstruido, 77);
  assert.equal(aud1.estoqueAtual, 77);
  assert.equal(aud1.divergencia, 0);

  // Auditoria 2: Detecção não-destrutiva de desvio físico (estoque adulterado para 60)
  db.prepare('UPDATE Produto SET estoque_atual = 60 WHERE id = 1').run();
  const aud2 = auditarProdutoKardex(1);
  assert.equal(aud2.conforme, false);
  assert.equal(aud2.divergencia, -17, 'Deve detectar desfalque físico de 17 unidades');
  // Verifica que a auditoria não alterou o estoque nem excluiu histórico
  const prodCheck = db.prepare('SELECT estoque_atual FROM Produto WHERE id = 1').get();
  assert.equal(prodCheck.estoque_atual, 60, 'Auditoria é analítica e não destrutiva');

  // Relatório Gerencial de Perdas e Avarias por Período e Categoria
  db.prepare(`
    INSERT INTO PerdaEstoque (gerente_id, produto_id, quantidade, motivo_tipo, justificativa, custo_unitario_aplicado, impacto_financeiro, usuario_id)
    VALUES (1, 1, 5, 'quebra', 'Quebra de garrafa na prateleira', 8.0, 40.0, 1);
  `).run();

  db.prepare(`INSERT INTO Produto (id, gerente_id, nome, preco_custo, preco_venda, estoque_atual, categoria) VALUES (2, 1, 'Iogurte Natural', 3.5, 6.0, 20.0, 'Laticínios');`).run();
  db.prepare(`
    INSERT INTO PerdaEstoque (gerente_id, produto_id, quantidade, motivo_tipo, justificativa, custo_unitario_aplicado, impacto_financeiro, usuario_id)
    VALUES (1, 2, 4, 'vencimento', 'Validade expirada', 3.5, 14.0, 1);
  `).run();

  function gerarRelatorioPerdas(gerenteId) {
    const rows = db.prepare(`
      SELECT 
        pe.*,
        p.nome as produto_nome,
        p.categoria as produto_categoria
      FROM PerdaEstoque pe
      JOIN Produto p ON p.id = pe.produto_id
      WHERE pe.gerente_id = ?
    `).all(gerenteId);

    const porTipo = {};
    const porCategoria = {};
    let totalFinanceiro = 0;
    let totalItens = 0;

    for (const r of rows) {
      totalFinanceiro = sumMoney(totalFinanceiro, r.impacto_financeiro);
      totalItens = round3(totalItens + r.quantidade);

      porTipo[r.motivo_tipo] = sumMoney(porTipo[r.motivo_tipo] || 0, r.impacto_financeiro);
      const cat = r.produto_categoria || 'Sem categoria';
      porCategoria[cat] = sumMoney(porCategoria[cat] || 0, r.impacto_financeiro);
    }

    return {
      totalRegistros: rows.length,
      totalItens,
      totalFinanceiro,
      porTipo,
      porCategoria,
      linhas: rows
    };
  }

  const relPerdas = gerarRelatorioPerdas(1);
  assert.equal(relPerdas.totalRegistros, 2);
  assert.equal(relPerdas.totalItens, 9.0);
  assert.equal(relPerdas.totalFinanceiro, 54.0, 'Impacto financeiro consolidado: 40 + 14 = 54.0');
  assert.equal(relPerdas.porTipo['quebra'], 40.0);
  assert.equal(relPerdas.porTipo['vencimento'], 14.0);
  assert.equal(relPerdas.porCategoria['Bebidas'], 40.0);
  assert.equal(relPerdas.porCategoria['Laticínios'], 14.0);
});

test('S05 — Integração Ponta a Ponta: Ciclo Completo com Auditorias, Cancelamento e Relatórios', () => {
  const db = setupTestDb();
  db.prepare(`INSERT INTO Usuario (id, nome, email, senha, cargo) VALUES (1, 'Super Gerente', 'super@teste.com', 'hash', 'gerente');`).run();
  db.prepare(`INSERT INTO Fornecedor (id, gerente_id, razao_social) VALUES (1, 1, 'Distribuidora Global');`).run();
  
  // Produto com PMP inicial R$ 10,00 e estoque 20
  db.prepare(`INSERT INTO Produto (id, gerente_id, nome, preco_custo, preco_venda, estoque_atual, fornecedor_id, categoria) VALUES (1, 1, 'Café Torrado 500g', 10.0, 16.0, 20.0, 1, 'Matinais');`).run();

  // 1. Venda de 5 unidades por R$ 80,00 (5 * 16.00) com pagamento misto (R$ 50 PIX + R$ 30 Dinheiro)
  db.prepare(`INSERT INTO Venda (id, gerente_id, subtotal, desconto, total, status, canal_venda) VALUES (1, 1, 80.0, 0.0, 80.0, 'concluida', 'balcao');`).run();
  db.prepare(`INSERT INTO ItensVenda (id, venda_id, produto_id, quantidade, preco_unitario, subtotal) VALUES (1, 1, 1, 5, 16.0, 80.0);`).run();
  db.prepare(`INSERT INTO PagamentoVenda (id, venda_id, gerente_id, forma_pagamento, valor_pago, valor_taxa, valor_liquido, status) VALUES (1, 1, 1, 'pix', 50.0, 0.50, 49.50, 'confirmado');`).run();
  db.prepare(`INSERT INTO PagamentoVenda (id, venda_id, gerente_id, forma_pagamento, valor_pago, valor_taxa, valor_liquido, status) VALUES (2, 1, 1, 'dinheiro', 30.0, 0.0, 30.0, 'confirmado');`).run();
  db.prepare(`INSERT INTO MovimentacaoEstoque (gerente_id, produto_id, tipo_operacao, quantidade, saldo_anterior, saldo_novo, custo_unitario, justificativa) VALUES (1, 1, 'SAIDA_VENDA', -5, 20, 15, 10.0, 'Venda #1');`).run();
  db.prepare('UPDATE Produto SET estoque_atual = 15 WHERE id = 1').run();

  // 2. Venda 2 com Cartão de Crédito (R$ 48,00 = 3 un * 16.00)
  db.prepare(`INSERT INTO Venda (id, gerente_id, subtotal, desconto, total, status, canal_venda) VALUES (2, 1, 48.0, 0.0, 48.0, 'concluida', 'delivery');`).run();
  db.prepare(`INSERT INTO ItensVenda (id, venda_id, produto_id, quantidade, preco_unitario, subtotal) VALUES (2, 2, 1, 3, 16.0, 48.0);`).run();
  // Taxa cartão: 3.49% de 48 + 0.30 fixo = 1.68 + 0.30 = 1.98. Líquido = 46.02
  const calcCred = calcularTaxaMonetaria(48.0, 3.49, 0.30);
  assert.equal(calcCred.valorTaxa, 1.98);
  assert.equal(calcCred.valorLiquido, 46.02);
  db.prepare(`INSERT INTO PagamentoVenda (id, venda_id, gerente_id, forma_pagamento, valor_pago, valor_taxa, valor_liquido, status) VALUES (3, 2, 1, 'cartao_credito', 48.0, 1.98, 46.02, 'confirmado');`).run();
  db.prepare(`INSERT INTO MovimentacaoEstoque (gerente_id, produto_id, tipo_operacao, quantidade, saldo_anterior, saldo_novo, custo_unitario, justificativa) VALUES (1, 1, 'SAIDA_VENDA', -3, 15, 12, 10.0, 'Venda #2');`).run();
  db.prepare('UPDATE Produto SET estoque_atual = 12 WHERE id = 1').run();

  // 3. Cancelamento da Venda 2 com retorno ao estoque e estorno de taxas
  db.prepare("UPDATE Venda SET status = 'cancelada' WHERE id = 2").run();
  db.prepare("UPDATE PagamentoVenda SET status = 'estornado' WHERE venda_id = 2").run();
  db.prepare(`INSERT INTO CancelamentoVenda (venda_id, gerente_id, gerente_responsavel_id, motivo_justificativa) VALUES (2, 1, 1, 'Cancelado pelo delivery');`).run();
  db.prepare(`INSERT INTO MovimentacaoEstoque (gerente_id, produto_id, tipo_operacao, quantidade, saldo_anterior, saldo_novo, custo_unitario, justificativa) VALUES (1, 1, 'CANCELAMENTO_VENDA', 3, 12, 15, 10.0, 'Cancelamento Venda #2');`).run();
  db.prepare('UPDATE Produto SET estoque_atual = 15 WHERE id = 1').run();

  // 4. Devolução parcial na Venda 1: 1 unidade apta para revenda e 1 unidade avariada
  db.prepare(`INSERT INTO DevolucaoVenda (id, venda_id, gerente_id, valor_estornado, motivo) VALUES (1, 1, 1, 32.0, 'Devolução mista');`).run();
  db.prepare(`INSERT INTO ItensDevolucao (devolucao_id, produto_id, quantidade, valor_unitario, subtotal_estornado, apto_revenda) VALUES (1, 1, 1, 16.0, 16.0, 1);`).run();
  db.prepare(`INSERT INTO ItensDevolucao (devolucao_id, produto_id, quantidade, valor_unitario, subtotal_estornado, apto_revenda) VALUES (1, 1, 1, 16.0, 16.0, 0);`).run();
  
  // Apto volta ao estoque (15 -> 16)
  db.prepare(`INSERT INTO MovimentacaoEstoque (gerente_id, produto_id, tipo_operacao, quantidade, saldo_anterior, saldo_novo, custo_unitario, justificativa) VALUES (1, 1, 'DEVOLUCAO', 1, 15, 16, 10.0, 'Devolução apta');`).run();
  db.prepare('UPDATE Produto SET estoque_atual = 16 WHERE id = 1').run();

  // Avariado é registrado como PerdaEstoque (custo unitário 10.0, impacto 10.0) e no Kardex informativo
  db.prepare(`
    INSERT INTO PerdaEstoque (gerente_id, produto_id, quantidade, motivo_tipo, justificativa, custo_unitario_aplicado, impacto_financeiro, usuario_id)
    VALUES (1, 1, 1, 'avaria', 'Pacote furado na devolução', 10.0, 10.0, 1);
  `).run();
  db.prepare(`INSERT INTO MovimentacaoEstoque (gerente_id, produto_id, tipo_operacao, quantidade, saldo_anterior, saldo_novo, custo_unitario, justificativa) VALUES (1, 1, 'AVARIA', 0, 16, 16, 10.0, 'Avaria em devolução');`).run();
  db.prepare("UPDATE Venda SET status = 'devolvida_parcial' WHERE id = 1").run();

  // 5. Validação da Auditoria do Kardex (Saldo reconstruído deve bater exatamente com estoque_atual = 16)
  const movs = db.prepare('SELECT * FROM MovimentacaoEstoque WHERE produto_id = 1 ORDER BY id ASC').all();
  let saldoReconst = movs[0].saldo_anterior;
  for (const m of movs) {
    saldoReconst = round3(saldoReconst + m.quantidade);
  }
  const prodAtual = db.prepare('SELECT estoque_atual FROM Produto WHERE id = 1').get();
  assert.equal(prodAtual.estoque_atual, 16.0);
  assert.equal(saldoReconst, 16.0, 'Kardex reconstruído deve coincidir rigorosamente com saldo físico atual (16.0)');

  // 6. Validação Contábil do Faturamento Elegível e Taxas
  const fatElegivel = db.prepare(`SELECT SUM(total) as fat FROM Venda WHERE status != 'cancelada'`).get();
  assert.equal(fatElegivel.fat, 80.0, 'Venda cancelada (R$ 48) não pode compor o faturamento');

  const taxasElegiveis = db.prepare(`
    SELECT SUM(pv.valor_taxa) as taxas
    FROM PagamentoVenda pv
    JOIN Venda v ON v.id = pv.venda_id
    WHERE v.status != 'cancelada' AND pv.status = 'confirmado';
  `).get();
  assert.equal(taxasElegiveis.taxas, 0.50, 'Apenas taxa do PIX (0.50) da Venda 1 é elegível; taxa do cartão (1.98) foi estornada');

  // 7. Validação do Relatório de Perdas consolidado
  const perdaDev = db.prepare('SELECT * FROM PerdaEstoque WHERE produto_id = 1').get();
  assert.equal(perdaDev.motivo_tipo, 'avaria');
  assert.equal(perdaDev.impacto_financeiro, 10.0);
  assert.equal(perdaDev.custo_unitario_aplicado, 10.0);
});



// ============================================================================
// NOVAS REGRAS DE NEGÓCIO E TESTES INTEGRADOS (S06)
// ============================================================================

test('S06 — Item 1: Abertura e Turnos de Caixa (Ciclo de Vida, Fundo de Troco, Auditoria por Operador e Bloqueio de Checkout)', () => {
  const db = setupTestDb();
  db.prepare(`INSERT INTO Usuario (id, nome, email, senha, cargo) VALUES (1, 'Gerente Geral', 'gerente@mercado.com', '${sha256('1234')}', 'gerente');`).run();
  db.prepare(`INSERT INTO Usuario (id, nome, email, senha, cargo, gerente_id) VALUES (2, 'Operador Caixa 1', 'operador1@mercado.com', '${sha256('1234')}', 'balconista', 1);`).run();
  db.prepare(`INSERT INTO Produto (id, gerente_id, nome, preco_custo, preco_venda, estoque_atual) VALUES (1, 1, 'Refrigerante 2L', 5.0, 9.0, 100.0);`).run();

  // 1. Funções do Ciclo de Vida do Caixa
  function abrirCaixa(operadorId, gerenteId, fundoTrocoInicial, obs = '') {
    const ativo = db.prepare("SELECT id FROM TurnoCaixa WHERE operador_id = ? AND gerente_id = ? AND status IN ('aberto', 'bloqueado')").get(operadorId, gerenteId);
    if (ativo) {
      throw new Error(`Operador já possui um turno de caixa ativo (Turno #${ativo.id}).`);
    }
    const res = db.prepare(`
      INSERT INTO TurnoCaixa (gerente_id, operador_id, status, fundo_troco_inicial, saldo_esperado_dinheiro, observacoes)
      VALUES (?, ?, 'aberto', ?, ?, ?);
    `).run(gerenteId, operadorId, fundoTrocoInicial, fundoTrocoInicial, obs);

    const turnoId = Number(res.lastInsertRowid);
    db.prepare(`
      INSERT INTO MovimentacaoCaixa (turno_caixa_id, gerente_id, operador_id, tipo_operacao, forma_pagamento, valor, saldo_apos, origem_referencia, justificativa)
      VALUES (?, ?, ?, 'ABERTURA', 'dinheiro', ?, ?, ?, 'Abertura com fundo de troco inicial');
    `).run(turnoId, gerenteId, operadorId, fundoTrocoInicial, fundoTrocoInicial, `ABERTURA-${turnoId}`);

    return db.prepare('SELECT * FROM TurnoCaixa WHERE id = ?').get(turnoId);
  }

  function bloquearCaixa(turnoId, operadorId, gerenteId, motivo) {
    if (!motivo || motivo.trim().length === 0) throw new Error('Informe o motivo do bloqueio.');
    const t = db.prepare('SELECT * FROM TurnoCaixa WHERE id = ?').get(turnoId);
    if (!t || t.status === 'fechado') throw new Error('Caixa inexistente ou fechado.');
    if (t.status === 'bloqueado') throw new Error('Caixa já está bloqueado.');

    db.prepare("UPDATE TurnoCaixa SET status = 'bloqueado', motivo_bloqueio = ? WHERE id = ?").run(motivo, turnoId);
    db.prepare(`
      INSERT INTO MovimentacaoCaixa (turno_caixa_id, gerente_id, operador_id, tipo_operacao, forma_pagamento, valor, saldo_apos, origem_referencia, justificativa)
      VALUES (?, ?, ?, 'BLOQUEIO', 'dinheiro', 0.0, ?, ?, ?);
    `).run(turnoId, gerenteId, operadorId, t.saldo_esperado_dinheiro, `BLOQUEIO-${turnoId}`, motivo);

    return db.prepare('SELECT * FROM TurnoCaixa WHERE id = ?').get(turnoId);
  }

  function desbloquearCaixa(turnoId, operadorId, gerenteId) {
    const t = db.prepare('SELECT * FROM TurnoCaixa WHERE id = ?').get(turnoId);
    if (!t || t.status !== 'bloqueado') throw new Error('Caixa não está bloqueado.');

    db.prepare("UPDATE TurnoCaixa SET status = 'aberto', motivo_bloqueio = NULL WHERE id = ?").run(turnoId);
    db.prepare(`
      INSERT INTO MovimentacaoCaixa (turno_caixa_id, gerente_id, operador_id, tipo_operacao, forma_pagamento, valor, saldo_apos, origem_referencia, justificativa)
      VALUES (?, ?, ?, 'DESBLOQUEIO', 'dinheiro', 0.0, ?, ?, 'Desbloqueio autorizado');
    `).run(turnoId, gerenteId, operadorId, t.saldo_esperado_dinheiro, `DESBLOQUEIO-${turnoId}`);

    return db.prepare('SELECT * FROM TurnoCaixa WHERE id = ?').get(turnoId);
  }

  function movimentarCaixa(turnoId, operadorId, gerenteId, tipo, valor, justificativa) {
    const t = db.prepare("SELECT * FROM TurnoCaixa WHERE id = ? AND status = 'aberto'").get(turnoId);
    if (!t) throw new Error('Caixa deve estar aberto para movimentações.');

    let novoSaldo = t.saldo_esperado_dinheiro;
    if (tipo === 'SANGRIA') {
      if (valor > t.saldo_esperado_dinheiro) {
        throw new Error(`Saldo insuficiente para sangria (Disponível: ${t.saldo_esperado_dinheiro}, Solicitado: ${valor}).`);
      }
      novoSaldo = subtractMoney(t.saldo_esperado_dinheiro, valor);
      db.prepare('UPDATE TurnoCaixa SET total_sangrias = total_sangrias + ?, saldo_esperado_dinheiro = ? WHERE id = ?').run(valor, novoSaldo, turnoId);
    } else if (tipo === 'SUPRIMENTO') {
      novoSaldo = sumMoney(t.saldo_esperado_dinheiro, valor);
      db.prepare('UPDATE TurnoCaixa SET total_suprimentos = total_suprimentos + ?, saldo_esperado_dinheiro = ? WHERE id = ?').run(valor, novoSaldo, turnoId);
    }

    db.prepare(`
      INSERT INTO MovimentacaoCaixa (turno_caixa_id, gerente_id, operador_id, tipo_operacao, forma_pagamento, valor, saldo_apos, origem_referencia, justificativa)
      VALUES (?, ?, ?, ?, 'dinheiro', ?, ?, ?, ?);
    `).run(turnoId, gerenteId, operadorId, tipo, valor, novoSaldo, `${tipo}-${turnoId}`, justificativa);

    return db.prepare('SELECT * FROM TurnoCaixa WHERE id = ?').get(turnoId);
  }

  function validarCheckout(operadorId, gerenteId) {
    const t = db.prepare("SELECT * FROM TurnoCaixa WHERE operador_id = ? AND gerente_id = ? AND status IN ('aberto', 'bloqueado') ORDER BY id DESC LIMIT 1").get(operadorId, gerenteId);
    if (!t) {
      throw new Error('Checkout bloqueado: Não há caixa aberto para o operador.');
    }
    if (t.status === 'bloqueado') {
      throw new Error(`Checkout bloqueado: Caixa está BLOQUEADO (${t.motivo_bloqueio}).`);
    }
    return t;
  }

  function fecharCaixa(turnoId, operadorId, gerenteId, saldoFisicoInformado) {
    const t = db.prepare('SELECT * FROM TurnoCaixa WHERE id = ?').get(turnoId);
    if (!t || t.status === 'fechado') throw new Error('Caixa já encerrado.');

    const diferenca = subtractMoney(saldoFisicoInformado, t.saldo_esperado_dinheiro);
    db.prepare(`
      UPDATE TurnoCaixa 
      SET status = 'fechado', saldo_fechamento_informado = ?, diferenca_fechamento = ?, data_fechamento = CURRENT_TIMESTAMP
      WHERE id = ?;
    `).run(saldoFisicoInformado, diferenca, turnoId);

    db.prepare(`
      INSERT INTO MovimentacaoCaixa (turno_caixa_id, gerente_id, operador_id, tipo_operacao, forma_pagamento, valor, saldo_apos, origem_referencia, justificativa)
      VALUES (?, ?, ?, 'FECHAMENTO', 'dinheiro', ?, ?, ?, ?);
    `).run(turnoId, gerenteId, operadorId, saldoFisicoInformado, saldoFisicoInformado, `FECHAMENTO-${turnoId}`, `Fechamento. Diferença: ${diferenca}`);

    return {
      turno: db.prepare('SELECT * FROM TurnoCaixa WHERE id = ?').get(turnoId),
      saldoEsperado: t.saldo_esperado_dinheiro,
      saldoFisicoInformado,
      diferenca
    };
  }

  // --- CENÁRIO 1: TENTATIVA DE CHECKOUT SEM CAIXA ATIVO (DEVE FALHAR) ---
  assert.throws(() => {
    validarCheckout(2, 1);
  }, /Checkout bloqueado: Não há caixa aberto/);

  // --- CENÁRIO 2: ABERTURA DO CAIXA COM FUNDO DE TROCO (R$ 150,00) ---
  const turnoAberto = abrirCaixa(2, 1, 150.0, 'Troco inicial notas pequenas');
  assert.equal(turnoAberto.status, 'aberto');
  assert.equal(turnoAberto.fundo_troco_inicial, 150.0);
  assert.equal(turnoAberto.saldo_esperado_dinheiro, 150.0);

  // Tentativa de abrir segundo caixa para o mesmo operador sem fechar o primeiro
  assert.throws(() => {
    abrirCaixa(2, 1, 200.0);
  }, /Operador já possui um turno de caixa ativo/);

  // Agora o checkout é permitido
  const caixaValido = validarCheckout(2, 1);
  assert.equal(caixaValido.id, turnoAberto.id);

  // --- CENÁRIO 3: BLOQUEIO TEMPORÁRIO DO CAIXA E BLOQUEIO DE CHECKOUT ---
  bloquearCaixa(turnoAberto.id, 2, 1, 'Pausa para almoço');
  const tBloqueado = db.prepare('SELECT status FROM TurnoCaixa WHERE id = ?').get(turnoAberto.id);
  assert.equal(tBloqueado.status, 'bloqueado');

  // Checkout deve ser terminantemente bloqueado enquanto o caixa estiver bloqueado
  assert.throws(() => {
    validarCheckout(2, 1);
  }, /Checkout bloqueado: Caixa está BLOQUEADO/);

  // --- CENÁRIO 4: DESBLOQUEIO E REATIVAÇÃO DO CAIXA ---
  desbloquearCaixa(turnoAberto.id, 2, 1);
  const tReativado = db.prepare('SELECT status FROM TurnoCaixa WHERE id = ?').get(turnoAberto.id);
  assert.equal(tReativado.status, 'aberto');
  assert.doesNotThrow(() => validarCheckout(2, 1));

  // --- CENÁRIO 5: SUPRIMENTO E SANGRIA ---
  // Suprimento de R$ 50,00 -> saldo esperado passa de 150 para 200
  const tAposSuprimento = movimentarCaixa(turnoAberto.id, 2, 1, 'SUPRIMENTO', 50.0, 'Reforço de moedas');
  assert.equal(tAposSuprimento.saldo_esperado_dinheiro, 200.0);
  assert.equal(tAposSuprimento.total_suprimentos, 50.0);

  // Sangria de R$ 80,00 -> saldo esperado passa de 200 para 120
  const tAposSangria = movimentarCaixa(turnoAberto.id, 2, 1, 'SANGRIA', 80.0, 'Recolhimento para cofre');
  assert.equal(tAposSangria.saldo_esperado_dinheiro, 120.0);
  assert.equal(tAposSangria.total_sangrias, 80.0);

  // Sangria de valor maior que o saldo em dinheiro (R$ 150 > R$ 120) -> rejeitada!
  assert.throws(() => {
    movimentarCaixa(turnoAberto.id, 2, 1, 'SANGRIA', 150.0, 'Tentativa excessiva');
  }, /Saldo insuficiente para sangria/);

  // --- CENÁRIO 6: VENDA NO CHECKOUT COM RECEBIMENTO EM DINHEIRO E OUTROS ---
  // Venda: R$ 36,00 (2 refrigerantes a R$ 18,00), pago R$ 20,00 em dinheiro e R$ 16,00 no PIX
  const vId = 101;
  db.prepare(`
    INSERT INTO Venda (id, gerente_id, usuario_id, subtotal, total, status, canal_venda, turno_caixa_id)
    VALUES (?, 1, 2, 36.0, 36.0, 'concluida', 'balcao', ?);
  `).run(vId, turnoAberto.id);

  // Atualiza caixa: Dinheiro R$ 20,00 -> saldo esperado de 120 vai para 140
  db.prepare(`
    UPDATE TurnoCaixa 
    SET total_vendas_dinheiro = total_vendas_dinheiro + 20.0,
        total_vendas_outros = total_vendas_outros + 16.0,
        saldo_esperado_dinheiro = saldo_esperado_dinheiro + 20.0
    WHERE id = ?;
  `).run(turnoAberto.id);

  db.prepare(`
    INSERT INTO MovimentacaoCaixa (turno_caixa_id, gerente_id, operador_id, tipo_operacao, forma_pagamento, valor, saldo_apos, origem_referencia, justificativa)
    VALUES (?, 1, 2, 'VENDA', 'dinheiro', 20.0, 140.0, ?, 'Venda balcão');
  `).run(turnoAberto.id, `VENDA-${vId}`);

  const tAposVenda = db.prepare('SELECT * FROM TurnoCaixa WHERE id = ?').get(turnoAberto.id);
  assert.equal(tAposVenda.saldo_esperado_dinheiro, 140.0);
  assert.equal(tAposVenda.total_vendas_dinheiro, 20.0);
  assert.equal(tAposVenda.total_vendas_outros, 16.0);

  // --- CENÁRIO 7: FECHAMENTO DE CAIXA E AUDITORIA MATEMÁTICA ---
  // Saldo esperado é R$ 140,00. Suponha conferência cega informou R$ 140,00 (Exato)
  const fechamento = fecharCaixa(turnoAberto.id, 2, 1, 140.0);
  assert.equal(fechamento.turno.status, 'fechado');
  assert.equal(fechamento.diferenca, 0.0);
  assert.equal(fechamento.saldoFisicoInformado, 140.0);

  // Tentativa de checkout após caixa fechado -> bloqueado novamente!
  assert.throws(() => {
    validarCheckout(2, 1);
  }, /Checkout bloqueado: Não há caixa aberto/);

  // Auditoria: Reconstruir o saldo de todas as movimentações do turno
  const movs = db.prepare('SELECT * FROM MovimentacaoCaixa WHERE turno_caixa_id = ? ORDER BY id ASC').all(turnoAberto.id);
  let saldoReconst = 0;
  for (const m of movs) {
    if (m.tipo_operacao === 'ABERTURA') saldoReconst = m.valor;
    else if (m.tipo_operacao === 'SUPRIMENTO' || m.tipo_operacao === 'VENDA') saldoReconst = sumMoney(saldoReconst, m.valor);
    else if (m.tipo_operacao === 'SANGRIA') saldoReconst = subtractMoney(saldoReconst, m.valor);
  }
  // 150 (abertura) + 50 (suprimento) - 80 (sangria) + 20 (venda dinheiro) = 140
  assert.equal(saldoReconst, 140.0);
  assert.equal(saldoReconst, fechamento.saldoEsperado);
});

test('S06 — Item 2: Cadastro de Clientes & Limite (Validação de Documento, Contato, Teto de Crédito e Bloqueio Preventivo de Inadimplentes)', () => {
  const db = setupTestDb();
  db.prepare(`INSERT INTO Usuario (id, nome, email, senha, cargo) VALUES (1, 'Gerente', 'gerente@teste.com', 'hash', 'gerente');`).run();

  // 1. Validação de Documento (CPF / CNPJ)
  // CPF válido gerado conforme algoritmo oficial (módulo 11)
  assert.equal(validarCPF('52998224725'), true);
  assert.equal(validarCPF('11144477735'), true);
  // CPF inválido por dígito verificador incorreto
  assert.equal(validarCPF('11144477736'), false);
  // CPF inválido por sequência repetida
  assert.equal(validarCPF('11111111111'), false);
  assert.equal(validarCPF('00000000000'), false);

  // CNPJ válido
  assert.equal(validarCNPJ('11222333000181'), true);
  // CNPJ inválido
  assert.equal(validarCNPJ('11222333000182'), false);
  assert.equal(validarCNPJ('00000000000000'), false);

  // Validador universal
  const docCpf = validarDocumento('111.444.777-35');
  assert.equal(docCpf.valido, true);
  assert.equal(docCpf.tipo, 'CPF');
  assert.equal(formatarDocumento('11144477735'), '111.444.777-35');

  const docInvalido = validarDocumento('12345');
  assert.equal(docInvalido.valido, false);

  // 2. Validação de Contato Telefônico
  assert.equal(validarTelefone('86999887766').valido, true); // Celular 11 dígitos
  assert.equal(validarTelefone('8632321234').valido, true);  // Fixo 10 dígitos
  assert.equal(validarTelefone('086999887766').valido, false); // Começando com 0
  assert.equal(validarTelefone('12345').valido, false);        // Menos de 10 dígitos
  assert.equal(formatarTelefone('86999887766'), '(86) 99988-7766');

  // 3. Regra de Negócio: Teto de Crédito Personalizável
  function cadastrarCliente(dados) {
    if (!dados.nome) throw new Error('Nome é obrigatório.');
    if (dados.cpf) {
      const v = validarDocumento(dados.cpf);
      if (!v.valido) throw new Error(`Documento inválido: ${v.mensagem}`);
    }
    if (dados.telefone) {
      const t = validarTelefone(dados.telefone);
      if (!t.valido) throw new Error(`Telefone inválido: ${t.mensagem}`);
    }
    const limite = Math.max(0, parseFloat(dados.limite_fiado || 0));

    const res = db.prepare(`
      INSERT INTO Cliente (gerente_id, nome, cpf_cnpj, telefone, limite_fiado, saldo_devedor, bloqueado_inadimplente, motivo_bloqueio)
      VALUES (1, ?, ?, ?, ?, 0.0, ?, ?);
    `).run(dados.nome, dados.cpf || null, dados.telefone || null, limite, dados.bloqueado_inadimplente ? 1 : 0, dados.motivo_bloqueio || null);

    return db.prepare('SELECT * FROM Cliente WHERE id = ?').get(res.lastInsertRowid);
  }

  function autorizarCompraFiado(clienteId, valor) {
    const cli = db.prepare('SELECT * FROM Cliente WHERE id = ?').get(clienteId);
    if (!cli) throw new Error('Cliente não encontrado.');

    // Bloqueio preventivo de inadimplentes
    if (cli.bloqueado_inadimplente === 1) {
      throw new Error(`Venda a prazo bloqueada: Cliente "${cli.nome}" com bloqueio preventivo de crédito. Motivo: ${cli.motivo_bloqueio || 'Inadimplência'}.`);
    }

    const novoSaldo = cli.saldo_devedor + valor;
    if (cli.limite_fiado > 0 && novoSaldo > (cli.limite_fiado + 0.001)) {
      throw new Error(`Teto de crédito excedido para "${cli.nome}"! Limite: R$ ${cli.limite_fiado.toFixed(2)}, Saldo atual: R$ ${cli.saldo_devedor.toFixed(2)}, Tentativa: R$ ${valor.toFixed(2)}.`);
    }

    db.prepare('UPDATE Cliente SET saldo_devedor = ? WHERE id = ?').run(novoSaldo, clienteId);
    return { autorizado: true, novoSaldo };
  }

  // Falha: cadastro com CPF incorreto
  assert.throws(() => {
    cadastrarCliente({ nome: 'João da Silva', cpf: '123.456.789-00', telefone: '86999887766' });
  }, /Documento inválido/);

  // Falha: cadastro com telefone incorreto
  assert.throws(() => {
    cadastrarCliente({ nome: 'Maria', cpf: '11144477735', telefone: '123' });
  }, /Telefone inválido/);

  // Sucesso: cadastro de cliente com teto de crédito de R$ 300,00
  const cli1 = cadastrarCliente({
    nome: 'Carlos Eduardo',
    cpf: '11144477735',
    telefone: '86999887766',
    limite_fiado: 300.0,
    bloqueado_inadimplente: 0
  });
  assert.equal(cli1.limite_fiado, 300.0);
  assert.equal(cli1.saldo_devedor, 0.0);

  // Compra a prazo de R$ 250,00 -> autorizada
  const c1 = autorizarCompraFiado(cli1.id, 250.0);
  assert.equal(c1.autorizado, true);
  assert.equal(c1.novoSaldo, 250.0);

  // Tentativa de compra adicional de R$ 60,00 (totalizaria R$ 310 > R$ 300 teto) -> BLOQUEADA!
  assert.throws(() => {
    autorizarCompraFiado(cli1.id, 60.0);
  }, /Teto de crédito excedido/);

  // 4. Bloqueio Preventivo de Inadimplência
  const cli2 = cadastrarCliente({
    nome: 'Empresa Inadimplente ME',
    cpf: '11222333000181',
    telefone: '8632321234',
    limite_fiado: 1000.0,
    bloqueado_inadimplente: 1,
    motivo_bloqueio: 'Título protestado em cartório'
  });
  assert.equal(cli2.bloqueado_inadimplente, 1);

  // Mesmo tendo saldo zero e limite de R$ 1000,00, a compra no fiado é terminantemente bloqueada!
  assert.throws(() => {
    autorizarCompraFiado(cli2.id, 50.0);
  }, /Título protestado em cartório/);

  // Ao remover o bloqueio preventivo, volta a poder comprar normalmente
  db.prepare("UPDATE Cliente SET bloqueado_inadimplente = 0, motivo_bloqueio = NULL WHERE id = ?").run(cli2.id);
  const c2Liberado = autorizarCompraFiado(cli2.id, 100.0);
  assert.equal(c2Liberado.autorizado, true);
  assert.equal(c2Liberado.novoSaldo, 100.0);
});

test('S06 — Item 3: Lotes & Controle de Validade (Prazos de Validade Vinculados a Entradas e Algoritmo de Saída PEPS/FIFO)', () => {
  const db = setupTestDb();
  db.prepare(`INSERT INTO Usuario (id, nome, email, senha, cargo) VALUES (1, 'Gerente', 'gerente@mercado.com', 'hash', 'gerente');`).run();
  db.prepare(`INSERT INTO Fornecedor (id, gerente_id, razao_social) VALUES (1, 1, 'Distribuidora Lácteos');`).run();
  db.prepare(`INSERT INTO Produto (id, gerente_id, nome, preco_custo, preco_venda, estoque_atual) VALUES (1, 1, 'Iogurte Grego 500g', 4.0, 8.0, 0.0);`).run();

  // 1. Vinculação de Lotes e Prazos de Validade às Entradas de Mercadoria
  function registrarLoteEntrada(produtoId, numeroLote, dataEntrada, dataValidade, quantidade, custo) {
    const res = db.prepare(`
      INSERT INTO LoteEstoque (
        gerente_id, produto_id, numero_lote, data_entrada, data_validade,
        quantidade_inicial, quantidade_saldo, custo_unitario, status
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, 'ativo');
    `).run(produtoId, numeroLote, dataEntrada, dataValidade, quantidade, quantidade, custo);

    // Atualiza estoque do produto
    db.prepare('UPDATE Produto SET estoque_atual = estoque_atual + ? WHERE id = ?').run(quantidade, produtoId);
    return Number(res.lastInsertRowid);
  }

  // Entrada 1: 20 unidades, Lote "LOTE-A", entrou em 2026-10-01, validade: 2027-02-01 (Custo R$ 4.00)
  registrarLoteEntrada(1, 'LOTE-A', '2026-10-01', '2027-02-01', 20.0, 4.00);

  // Entrada 2: 30 unidades, Lote "LOTE-B", entrou em 2026-10-15, validade: 2027-05-15 (Custo R$ 4.50)
  registrarLoteEntrada(1, 'LOTE-B', '2026-10-15', '2027-05-15', 30.0, 4.50);

  // Entrada 3: 15 unidades, Lote "LOTE-C", entrou em 2026-10-20, mas com validade mais próxima: 2026-12-15!
  registrarLoteEntrada(1, 'LOTE-C', '2026-10-20', '2026-12-15', 15.0, 4.20);

  // Estoque total: 20 + 30 + 15 = 65 unidades
  const prodEstoque = db.prepare('SELECT estoque_atual FROM Produto WHERE id = 1').get();
  assert.equal(prodEstoque.estoque_atual, 65.0);

  // 2. Algoritmo de Sugestão de Saída PEPS / FIFO (com prioridade FEFO para validades mais próximas)
  function sugerirSaidaPEPS(produtoId, quantidadeSolicitada, dataHoje = '2026-11-04') {
    const lotes = db.prepare(`
      SELECT * FROM LoteEstoque 
      WHERE produto_id = ? AND quantidade_saldo > 0 AND status = 'ativo'
      ORDER BY 
        CASE WHEN data_validade IS NOT NULL AND data_validade != '' THEN 0 ELSE 1 END,
        data_validade ASC,
        data_entrada ASC,
        id ASC;
    `).all(produtoId);

    let restante = quantidadeSolicitada;
    const sugestoes = [];
    const alertas = [];

    for (const lote of lotes) {
      if (restante <= 0.0001) break;

      const qtdAlocar = Math.min(restante, lote.quantidade_saldo);

      let statusValidade = 'ok';
      if (lote.data_validade) {
        if (lote.data_validade < dataHoje) {
          statusValidade = 'vencido';
          alertas.push(`ATENÇÃO: Lote ${lote.numero_lote} VENCIDO em ${lote.data_validade}!`);
        }
      }

      sugestoes.push({
        loteId: lote.id,
        numeroLote: lote.numero_lote,
        dataValidade: lote.data_validade,
        dataEntrada: lote.data_entrada,
        quantidadeSugerida: qtdAlocar,
        saldoLote: lote.quantidade_saldo,
        statusValidade
      });

      restante = round3(restante - qtdAlocar);
    }

    return {
      quantidadeSolicitada,
      quantidadeAtendida: round3(quantidadeSolicitada - restante),
      sugestoes,
      alertas
    };
  }

  // Solicitação de saída de 25 unidades:
  // Deve sugerir:
  // 1º: Lote C (15 un, validade mais próxima: 2026-12-15)
  // 2º: Lote A (10 un, validade seguinte: 2027-02-01)
  const sugestao1 = sugerirSaidaPEPS(1, 25.0);
  assert.equal(sugestao1.quantidadeAtendida, 25.0);
  assert.equal(sugestao1.sugestoes.length, 2);

  assert.equal(sugestao1.sugestoes[0].numeroLote, 'LOTE-C');
  assert.equal(sugestao1.sugestoes[0].quantidadeSugerida, 15.0);

  assert.equal(sugestao1.sugestoes[1].numeroLote, 'LOTE-A');
  assert.equal(sugestao1.sugestoes[1].quantidadeSugerida, 10.0);

  // 3. Efetivação da Baixa no Modelo PEPS / FIFO
  function baixarLotesPEPS(produtoId, quantidade) {
    const sug = sugerirSaidaPEPS(produtoId, quantidade);
    for (const s of sug.sugestoes) {
      const novoSaldo = round3(s.saldoLote - s.quantidadeSugerida);
      const novoStatus = novoSaldo <= 0 ? 'esgotado' : 'ativo';
      db.prepare('UPDATE LoteEstoque SET quantidade_saldo = ?, status = ? WHERE id = ?').run(novoSaldo, novoStatus, s.loteId);
    }
    db.prepare('UPDATE Produto SET estoque_atual = estoque_atual - ? WHERE id = ?').run(quantidade, produtoId);
  }

  baixarLotesPEPS(1, 25.0);

  // Verificações pós-baixa:
  // Lote C (15 un) foi totalmente consumido -> status = 'esgotado', saldo = 0
  const loteCFinal = db.prepare("SELECT * FROM LoteEstoque WHERE numero_lote = 'LOTE-C'").get();
  assert.equal(loteCFinal.status, 'esgotado');
  assert.equal(loteCFinal.quantidade_saldo, 0.0);

  // Lote A (20 un originais - 10 un baixadas = 10 un restantes) -> status = 'ativo'
  const loteAFinal = db.prepare("SELECT * FROM LoteEstoque WHERE numero_lote = 'LOTE-A'").get();
  assert.equal(loteAFinal.status, 'ativo');
  assert.equal(loteAFinal.quantidade_saldo, 10.0);

  // Lote B permaneceu intocado com 30 un
  const loteBFinal = db.prepare("SELECT * FROM LoteEstoque WHERE numero_lote = 'LOTE-B'").get();
  assert.equal(loteBFinal.status, 'ativo');
  assert.equal(loteBFinal.quantidade_saldo, 30.0);

  // Estoque restante no produto: 65 - 25 = 40 unidades
  const prodRestante = db.prepare('SELECT estoque_atual FROM Produto WHERE id = 1').get();
  assert.equal(prodRestante.estoque_atual, 40.0);

  // 4. Detecção e Alerta de Lote Vencido
  // Insere lote vencido intencionalmente para teste de prevenção
  registrarLoteEntrada(1, 'LOTE-VENCIDO', '2026-01-01', '2026-05-01', 5.0, 3.0);
  const sugComVencido = sugerirSaidaPEPS(1, 10.0, '2026-11-04');
  assert.ok(sugComVencido.alertas.some(a => a.includes('VENCIDO')));
});

// ============================================================================
// SUÍTE DE TESTES AUTOMATIZADOS: SEMANA 07 (S07)
// Módulos: Financeiro/Caixa, Vendas/Fiado e Estoque/Validade
// ============================================================================

test('S07 — Item 1: Módulo Financeiro & Caixa (Sangrias, Suprimentos com Comprovante Assinado Digitalmente SHA-256 e Integração com Estornos na Gaveta Atual)', () => {
  const db = setupTestDb();
  db.prepare(`INSERT INTO Usuario (id, nome, email, senha, cargo) VALUES (1, 'Gerente Geral', 'gerente@mercado.com', '${sha256('1234')}', 'gerente');`).run();
  db.prepare(`INSERT INTO Usuario (id, nome, email, senha, cargo, gerente_id) VALUES (2, 'Operador Caixa', 'operador@mercado.com', '${sha256('1234')}', 'balconista', 1);`).run();
  db.prepare(`INSERT INTO Produto (id, gerente_id, nome, preco_custo, preco_venda, estoque_atual) VALUES (1, 1, 'Arroz 5kg', 15.0, 25.0, 50.0);`).run();

  // 1. Funções de Movimentação com Comprovante Assinado Digitalmente
  function gerarAssinatura(mov) {
    const payload = [
      mov.turno_caixa_id,
      mov.gerente_id,
      mov.operador_id,
      mov.tipo_operacao,
      Number(mov.valor || 0).toFixed(2),
      Number(mov.saldo_apos || 0).toFixed(2),
      mov.origem_referencia || '',
      mov.justificativa || '',
      mov.data_movimentacao || ''
    ].join('|');
    const hash = sha256(payload);
    const cod = `LC-${mov.tipo_operacao.substring(0, 3)}-${hash.substring(0, 12).toUpperCase()}`;
    return { hash, cod, payload };
  }

  function validarAssinatura(mov) {
    if (!mov || !mov.assinatura_digital) return false;
    const calc = gerarAssinatura(mov);
    return calc.hash === mov.assinatura_digital;
  }

  function abrirTurno(operadorId, gerenteId, fundoTroco) {
    const res = db.prepare(`
      INSERT INTO TurnoCaixa (gerente_id, operador_id, status, fundo_troco_inicial, saldo_esperado_dinheiro)
      VALUES (?, ?, 'aberto', ?, ?);
    `).run(gerenteId, operadorId, fundoTroco, fundoTroco);
    const turnoId = Number(res.lastInsertRowid);

    const mov = {
      turno_caixa_id: turnoId,
      gerente_id: gerenteId,
      operador_id: operadorId,
      tipo_operacao: 'ABERTURA',
      valor: fundoTroco,
      saldo_apos: fundoTroco,
      origem_referencia: `ABERTURA-${turnoId}`,
      justificativa: 'Fundo de troco inicial',
      data_movimentacao: '2026-11-10 08:00:00'
    };
    const { hash, cod } = gerarAssinatura(mov);
    db.prepare(`
      INSERT INTO MovimentacaoCaixa (turno_caixa_id, gerente_id, operador_id, tipo_operacao, forma_pagamento, valor, saldo_apos, origem_referencia, justificativa, comprovante_hash, assinatura_digital, data_movimentacao)
      VALUES (?, ?, ?, 'ABERTURA', 'dinheiro', ?, ?, ?, ?, ?, ?, ?);
    `).run(turnoId, gerenteId, operadorId, fundoTroco, fundoTroco, mov.origem_referencia, mov.justificativa, cod, hash, mov.data_movimentacao);

    return db.prepare('SELECT * FROM TurnoCaixa WHERE id = ?').get(turnoId);
  }

  function lancarMovimentacao(turnoId, operadorId, gerenteId, tipo, valor, justificativa) {
    const t = db.prepare("SELECT * FROM TurnoCaixa WHERE id = ? AND status = 'aberto'").get(turnoId);
    if (!t) throw new Error('Turno deve estar aberto para movimentações.');

    let novoSaldo = t.saldo_esperado_dinheiro;
    if (tipo === 'SANGRIA') {
      if (valor > t.saldo_esperado_dinheiro) {
        throw new Error(`Saldo insuficiente na gaveta para sangria. Disponível: ${t.saldo_esperado_dinheiro}, Solicitado: ${valor}`);
      }
      novoSaldo = subtractMoney(t.saldo_esperado_dinheiro, valor);
      db.prepare('UPDATE TurnoCaixa SET total_sangrias = total_sangrias + ?, saldo_esperado_dinheiro = ? WHERE id = ?').run(valor, novoSaldo, turnoId);
    } else if (tipo === 'SUPRIMENTO') {
      novoSaldo = sumMoney(t.saldo_esperado_dinheiro, valor);
      db.prepare('UPDATE TurnoCaixa SET total_suprimentos = total_suprimentos + ?, saldo_esperado_dinheiro = ? WHERE id = ?').run(valor, novoSaldo, turnoId);
    }

    const mov = {
      turno_caixa_id: turnoId,
      gerente_id: gerenteId,
      operador_id: operadorId,
      tipo_operacao: tipo,
      valor,
      saldo_apos: novoSaldo,
      origem_referencia: `${tipo}-${turnoId}`,
      justificativa,
      data_movimentacao: '2026-11-10 10:30:00'
    };

    const { hash, cod } = gerarAssinatura(mov);

    const res = db.prepare(`
      INSERT INTO MovimentacaoCaixa (
        turno_caixa_id, gerente_id, operador_id, tipo_operacao, forma_pagamento, valor, saldo_apos,
        origem_referencia, justificativa, comprovante_hash, assinatura_digital, data_movimentacao
      ) VALUES (?, ?, ?, ?, 'dinheiro', ?, ?, ?, ?, ?, ?, ?);
    `).run(turnoId, gerenteId, operadorId, tipo, valor, novoSaldo, mov.origem_referencia, justificativa, cod, hash, mov.data_movimentacao);

    const movRegistrada = db.prepare('SELECT * FROM MovimentacaoCaixa WHERE id = ?').get(res.lastInsertRowid);
    return {
      turno: db.prepare('SELECT * FROM TurnoCaixa WHERE id = ?').get(turnoId),
      movimentacao: movRegistrada,
      comprovante: {
        id: movRegistrada.id,
        tipo,
        valor,
        saldoAnterior: t.saldo_esperado_dinheiro,
        saldoApos: novoSaldo,
        codigoAutenticacao: cod,
        assinaturaDigital: hash,
        valido: validarAssinatura(movRegistrada)
      }
    };
  }

  // Abre turno com R$ 100,00 de troco
  const turno1 = abrirTurno(2, 1, 100.0);
  assert.equal(turno1.saldo_esperado_dinheiro, 100.0);

  // Cenário 1: Suprimento (Aporte de Capital/Troco) de R$ 50,00
  const supRes = lancarMovimentacao(turno1.id, 2, 1, 'SUPRIMENTO', 50.0, 'Reforço de moedas para troco');
  assert.equal(supRes.turno.saldo_esperado_dinheiro, 150.0);
  assert.equal(supRes.turno.total_suprimentos, 50.0);
  assert.equal(supRes.comprovante.valido, true);
  assert.match(supRes.comprovante.codigoAutenticacao, /^LC-SUP-[A-F0-9]{12}$/);
  assert.equal(validarAssinatura(supRes.movimentacao), true);

  // Cenário 2: Sangria (Retirada de Segurança) de R$ 70,00
  const sangRes = lancarMovimentacao(turno1.id, 2, 1, 'SANGRIA', 70.0, 'Sangria periódica para o cofre central');
  assert.equal(sangRes.turno.saldo_esperado_dinheiro, 80.0);
  assert.equal(sangRes.turno.total_sangrias, 70.0);
  assert.equal(sangRes.comprovante.valido, true);
  assert.match(sangRes.comprovante.codigoAutenticacao, /^LC-SAN-[A-F0-9]{12}$/);

  // Cenário 3: Sangria que excede saldo da gaveta (R$ 100 > R$ 80) é estritamente bloqueada
  assert.throws(() => {
    lancarMovimentacao(turno1.id, 2, 1, 'SANGRIA', 100.0, 'Tentativa de retirada acima do saldo');
  }, /Saldo insuficiente na gaveta/);

  // Cenário 4: Registro de Venda de R$ 50,00 em dinheiro na gaveta
  db.prepare(`
    INSERT INTO Venda (id, gerente_id, usuario_id, subtotal, total, status, canal_venda, turno_caixa_id)
    VALUES (201, 1, 2, 50.0, 50.0, 'concluida', 'balcao', ?);
  `).run(turno1.id);
  db.prepare(`
    INSERT INTO PagamentoVenda (venda_id, gerente_id, forma_pagamento, valor_pago, status)
    VALUES (201, 1, 'dinheiro', 50.0, 'confirmado');
  `).run();
  // Atualiza saldo gaveta: 80 + 50 = 130
  db.prepare('UPDATE TurnoCaixa SET total_vendas_dinheiro = total_vendas_dinheiro + 50.0, saldo_esperado_dinheiro = saldo_esperado_dinheiro + 50.0 WHERE id = ?').run(turno1.id);
  const tAposVenda = db.prepare('SELECT * FROM TurnoCaixa WHERE id = ?').get(turno1.id);
  assert.equal(tAposVenda.saldo_esperado_dinheiro, 130.0);

  // Cenário 5: Integração com Estorno/Cancelamento de Venda
  // Quando a venda 201 for cancelada, os R$ 50,00 em dinheiro DEVEM ser estornados diretamente da gaveta atual
  function estornarVenda(vendaId, gerenteId, operadorId, motivo) {
    const v = db.prepare('SELECT * FROM Venda WHERE id = ?').get(vendaId);
    if (!v) throw new Error('Venda não encontrada');
    
    // Verifica pagamento em dinheiro
    const pagDinheiro = db.prepare("SELECT SUM(valor_pago) as total FROM PagamentoVenda WHERE venda_id = ? AND forma_pagamento = 'dinheiro' AND status = 'confirmado'").get(vendaId);
    const valDinheiro = pagDinheiro.total || 0;

    // Localiza turno de caixa ativo (se o turno original estiver fechado, usa o turno ativo atual)
    let turnoAlvo = db.prepare("SELECT * FROM TurnoCaixa WHERE id = ? AND status = 'aberto'").get(v.turno_caixa_id);
    if (!turnoAlvo) {
      turnoAlvo = db.prepare("SELECT * FROM TurnoCaixa WHERE gerente_id = ? AND status = 'aberto' ORDER BY id DESC LIMIT 1").get(gerenteId);
    }
    if (!turnoAlvo) throw new Error('Nenhum turno de caixa aberto encontrado para abater estorno em dinheiro.');

    // Abate da gaveta de caixa atual
    const novoSaldo = subtractMoney(turnoAlvo.saldo_esperado_dinheiro, valDinheiro);
    const novoTotalVendas = Math.max(0, subtractMoney(turnoAlvo.total_vendas_dinheiro, valDinheiro));

    db.prepare('UPDATE TurnoCaixa SET total_vendas_dinheiro = ?, saldo_esperado_dinheiro = ? WHERE id = ?').run(novoTotalVendas, novoSaldo, turnoAlvo.id);
    db.prepare("UPDATE Venda SET status = 'cancelada' WHERE id = ?").run(vendaId);
    db.prepare("UPDATE PagamentoVenda SET status = 'estornado' WHERE venda_id = ?").run(vendaId);

    const mov = {
      turno_caixa_id: turnoAlvo.id,
      gerente_id: gerenteId,
      operador_id: operadorId,
      tipo_operacao: 'ESTORNO',
      valor: valDinheiro,
      saldo_apos: novoSaldo,
      origem_referencia: `CANCEL-VENDA-${vendaId}`,
      justificativa: motivo,
      data_movimentacao: '2026-11-10 11:00:00'
    };
    const { hash, cod } = gerarAssinatura(mov);
    db.prepare(`
      INSERT INTO MovimentacaoCaixa (turno_caixa_id, gerente_id, operador_id, tipo_operacao, forma_pagamento, valor, saldo_apos, origem_referencia, justificativa, comprovante_hash, assinatura_digital, data_movimentacao)
      VALUES (?, ?, ?, 'ESTORNO', 'dinheiro', ?, ?, ?, ?, ?, ?, ?);
    `).run(turnoAlvo.id, gerenteId, operadorId, valDinheiro, novoSaldo, mov.origem_referencia, motivo, cod, hash, mov.data_movimentacao);

    return db.prepare('SELECT * FROM TurnoCaixa WHERE id = ?').get(turnoAlvo.id);
  }

  const tAposEstorno = estornarVenda(201, 1, 2, 'Cliente desistiu da compra');
  // Saldo anterior 130 - 50 estornado = 80
  assert.equal(tAposEstorno.saldo_esperado_dinheiro, 80.0);
  assert.equal(tAposEstorno.total_vendas_dinheiro, 0.0);

  // Cenário 6: Estorno de venda de turno anterior fechado reflete no turno ativo atual
  // Fecha o turno 1
  db.prepare("UPDATE TurnoCaixa SET status = 'fechado' WHERE id = ?").run(turno1.id);
  // Abre o turno 2 com fundo de troco R$ 200,00
  const turno2 = abrirTurno(2, 1, 200.0);
  assert.equal(turno2.saldo_esperado_dinheiro, 200.0);

  // Cria uma venda 202 que foi realizada no turno 1 (fechado) com R$ 30,00 em dinheiro
  db.prepare(`
    INSERT INTO Venda (id, gerente_id, usuario_id, subtotal, total, status, canal_venda, turno_caixa_id)
    VALUES (202, 1, 2, 30.0, 30.0, 'concluida', 'balcao', ?);
  `).run(turno1.id);
  db.prepare(`
    INSERT INTO PagamentoVenda (venda_id, gerente_id, forma_pagamento, valor_pago, status)
    VALUES (202, 1, 'dinheiro', 30.0, 'confirmado');
  `).run();

  // Agora cancela a venda 202 hoje (turno 1 já está fechado). O estorno deve deduzir do Turno 2 ATIVO!
  const t2AposEstorno = estornarVenda(202, 1, 2, 'Devolução no dia seguinte com caixa anterior já fechado');
  assert.equal(t2AposEstorno.id, turno2.id, 'Dedução deve ocorrer no turno aberto atual');
  assert.equal(t2AposEstorno.saldo_esperado_dinheiro, 170.0, '200 - 30 estornado = 170');
});

test('S07 — Item 2: Módulo de Vendas & Fiado (Fiado no Checkout, Abate de Limite em Tempo Real e Extrato Consolidado da Caderneta)', () => {
  const db = setupTestDb();
  db.prepare(`INSERT INTO Usuario (id, nome, email, senha, cargo) VALUES (1, 'Gerente', 'gerente@mercado.com', '${sha256('1234')}', 'gerente');`).run();
  db.prepare(`INSERT INTO Usuario (id, nome, email, senha, cargo, gerente_id) VALUES (2, 'Operador', 'balcao@mercado.com', '${sha256('1234')}', 'balconista', 1);`).run();

  // 1. Cadastra Cliente com Teto de Crédito de R$ 200,00
  db.prepare(`
    INSERT INTO Cliente (id, gerente_id, nome, cpf_cnpj, telefone, limite_fiado, saldo_devedor, bloqueado_inadimplente)
    VALUES (1, 1, 'Severino do Ramo', '11144477735', '(86) 99988-7766', 200.0, 0.0, 0);
  `).run();

  // Função de validação e débito em tempo real
  function realizarVendaFiado(clienteId, valorVenda, vendaId) {
    const cli = db.prepare('SELECT * FROM Cliente WHERE id = ?').get(clienteId);
    if (!cli) throw new Error('Cliente não encontrado.');
    if (cli.bloqueado_inadimplente === 1) {
      throw new Error(`Venda bloqueada: Cliente "${cli.nome}" com bloqueio preventivo de crédito.`);
    }

    const novoSaldo = round2(cli.saldo_devedor + valorVenda);
    if (cli.limite_fiado > 0 && novoSaldo > (cli.limite_fiado + 0.001)) {
      const disponivel = Math.max(0, cli.limite_fiado - cli.saldo_devedor);
      throw new Error(`Teto de crédito excedido para "${cli.nome}". Limite: ${cli.limite_fiado}, Débito atual: ${cli.saldo_devedor}, Disponível: ${disponivel}, Tentativa: ${valorVenda}`);
    }

    // Registra Venda
    db.prepare(`
      INSERT INTO Venda (id, gerente_id, usuario_id, cliente_id, subtotal, total, status, canal_venda, created_at)
      VALUES (?, 1, 2, ?, ?, ?, 'concluida', 'balcao', CURRENT_TIMESTAMP);
    `).run(vendaId, clienteId, valorVenda, valorVenda);

    // Registra Pagamento Fiado
    db.prepare(`
      INSERT INTO PagamentoVenda (venda_id, gerente_id, forma_pagamento, valor_pago, cliente_id, status)
      VALUES (?, 1, 'fiado', ?, ?, 'confirmado');
    `).run(vendaId, valorVenda, clienteId);

    // Abate crédito (aumenta saldo devedor) em tempo real
    db.prepare('UPDATE Cliente SET saldo_devedor = ? WHERE id = ?').run(novoSaldo, clienteId);

    return db.prepare('SELECT * FROM Cliente WHERE id = ?').get(clienteId);
  }

  // 1ª Compra a Prazo: R$ 80,00 -> saldo_devedor = 80.0, disponível = 120.0
  const cliAposVenda1 = realizarVendaFiado(1, 80.0, 301);
  assert.equal(cliAposVenda1.saldo_devedor, 80.0);

  // 2ª Compra a Prazo: R$ 70,00 -> saldo_devedor = 150.0, disponível = 50.0
  const cliAposVenda2 = realizarVendaFiado(1, 70.0, 302);
  assert.equal(cliAposVenda2.saldo_devedor, 150.0);

  // 3ª Compra Tentativa: R$ 60,00 -> totalizaria R$ 210,00 > R$ 200,00 (BLOQUEIO EM TEMPO REAL NO CHECKOUT!)
  assert.throws(() => {
    realizarVendaFiado(1, 60.0, 303);
  }, /Teto de crédito excedido/);

  // Saldo permaneceu em R$ 150,00
  const cliPosTentativa = db.prepare('SELECT saldo_devedor FROM Cliente WHERE id = 1').get();
  assert.equal(cliPosTentativa.saldo_devedor, 150.0);

  // Amortização de fiado: Cliente paga R$ 50,00 em dinheiro na caderneta
  function registrarPagamentoConta(clienteId, valorPago, forma) {
    const cli = db.prepare('SELECT * FROM Cliente WHERE id = ?').get(clienteId);
    if (!cli) throw new Error('Cliente não encontrado');
    const saldoAnt = cli.saldo_devedor;
    const vEfetivo = Math.min(valorPago, saldoAnt);
    const saldoRes = subtractMoney(saldoAnt, vEfetivo);

    db.prepare(`
      INSERT INTO PagamentoDebitoCliente (gerente_id, cliente_id, operador_id, valor, forma_pagamento, observacoes, saldo_anterior, saldo_resultante)
      VALUES (1, ?, 2, ?, ?, 'Amortização no balcão', ?, ?);
    `).run(clienteId, vEfetivo, forma, saldoAnt, saldoRes);

    db.prepare('UPDATE Cliente SET saldo_devedor = ? WHERE id = ?').run(saldoRes, clienteId);
    return db.prepare('SELECT * FROM Cliente WHERE id = ?').get(clienteId);
  }

  const cliAposPag = registrarPagamentoConta(1, 50.0, 'dinheiro');
  // Saldo devedor cai de 150 para 100
  assert.equal(cliAposPag.saldo_devedor, 100.0);

  // Agora cliente tem R$ 100 de crédito disponível e pode fazer a compra de R$ 60 que antes fora bloqueada!
  const cliCompraLiberada = realizarVendaFiado(1, 60.0, 304);
  assert.equal(cliCompraLiberada.saldo_devedor, 160.0);

  // Consulta do Extrato Consolidado da Caderneta
  function consultarExtrato(clienteId) {
    const cli = db.prepare('SELECT * FROM Cliente WHERE id = ?').get(clienteId);
    const compras = db.prepare(`
      SELECT v.id as venda_id, v.created_at, pv.valor_pago, v.status
      FROM PagamentoVenda pv
      JOIN Venda v ON v.id = pv.venda_id
      WHERE pv.forma_pagamento = 'fiado' AND v.cliente_id = ?
      ORDER BY v.id ASC;
    `).all(clienteId);

    const pagamentos = db.prepare(`
      SELECT * FROM PagamentoDebitoCliente WHERE cliente_id = ? ORDER BY id ASC;
    `).all(clienteId);

    let saldo = 0;
    const eventos = [];
    for (const c of compras) {
      saldo = sumMoney(saldo, c.valor_pago);
      eventos.push({ tipo: 'COMPRA_FIADO', valor: c.valor_pago, saldoApos: saldo, ref: `Venda #${c.venda_id}` });
    }
    for (const p of pagamentos) {
      saldo = subtractMoney(saldo, p.valor);
      eventos.push({ tipo: 'PAGAMENTO_DEBITO', valor: p.valor, saldoApos: saldo, ref: `Recibo #${p.id}` });
    }

    return {
      cliente: cli,
      totalComprasFiado: compras.reduce((acc, c) => acc + c.valor_pago, 0),
      totalPagamentos: pagamentos.reduce((acc, p) => acc + p.valor, 0),
      saldoDevedorAtual: cli.saldo_devedor,
      limiteDisponivel: Math.max(0, cli.limite_fiado - cli.saldo_devedor),
      eventos
    };
  }

  const extrato = consultarExtrato(1);
  // Total de compras no fiado: 80 + 70 + 60 = 210
  assert.equal(extrato.totalComprasFiado, 210.0);
  // Total pago: 50
  assert.equal(extrato.totalPagamentos, 50.0);
  // Saldo em aberto acumulado: 210 - 50 = 160
  assert.equal(extrato.saldoDevedorAtual, 160.0);
  // Limite restante disponível: 200 - 160 = 40
  assert.equal(extrato.limiteDisponivel, 40.0);
});

test('S07 — Item 3: Módulo de Estoque (Triagem de Vencimento Crítico nas 4 Faixas de Risco e Apuração do Capital Parado sob Risco)', () => {
  const db = setupTestDb();
  db.prepare(`INSERT INTO Usuario (id, nome, email, senha, cargo) VALUES (1, 'Gerente', 'gerente@mercado.com', 'hash', 'gerente');`).run();
  db.prepare(`INSERT INTO Fornecedor (id, gerente_id, razao_social) VALUES (1, 1, 'Distribuidora Alimentos');`).run();

  // Produtos
  db.prepare(`INSERT INTO Produto (id, gerente_id, nome, categoria, preco_custo, preco_venda, estoque_atual) VALUES (1, 1, 'Queijo Prato 500g', 'Frios', 18.0, 28.0, 40.0);`).run();
  db.prepare(`INSERT INTO Produto (id, gerente_id, nome, categoria, preco_custo, preco_venda, estoque_atual) VALUES (2, 1, 'Iogurte Morango 1L', 'Laticínios', 6.0, 11.0, 50.0);`).run();
  db.prepare(`INSERT INTO Produto (id, gerente_id, nome, categoria, preco_custo, preco_venda, estoque_atual) VALUES (3, 1, 'Pão de Forma', 'Padaria', 4.5, 7.5, 20.0);`).run();
  db.prepare(`INSERT INTO Produto (id, gerente_id, nome, categoria, preco_custo, preco_venda, estoque_atual) VALUES (4, 1, 'Biscoito Recheado', 'Mercearia', 2.0, 3.5, 100.0);`).run();

  // Data de referência de teste: '2026-11-10'
  const dataRef = '2026-11-10';

  // Lote 1: VENCIDO (validade: 2026-11-05 < 2026-11-10) -> 10 un a R$ 18.00 = R$ 180,00
  db.prepare(`
    INSERT INTO LoteEstoque (gerente_id, produto_id, numero_lote, data_validade, quantidade_inicial, quantidade_saldo, custo_unitario, status)
    VALUES (1, 1, 'LOTE-VENC-01', '2026-11-05', 10, 10, 18.0, 'ativo');
  `).run();

  // Lote 2: RISCO CRÍTICO (validade: 2026-11-14 -> 4 dias <= 7) -> 20 un a R$ 6.00 = R$ 120,00
  db.prepare(`
    INSERT INTO LoteEstoque (gerente_id, produto_id, numero_lote, data_validade, quantidade_inicial, quantidade_saldo, custo_unitario, status)
    VALUES (1, 2, 'LOTE-CRIT-01', '2026-11-14', 20, 20, 6.0, 'ativo');
  `).run();

  // Lote 3: RISCO MÉDIO (validade: 2026-11-22 -> 12 dias <= 15) -> 15 un a R$ 4.50 = R$ 67,50
  db.prepare(`
    INSERT INTO LoteEstoque (gerente_id, produto_id, numero_lote, data_validade, quantidade_inicial, quantidade_saldo, custo_unitario, status)
    VALUES (1, 3, 'LOTE-MED-01', '2026-11-22', 15, 15, 4.50, 'ativo');
  `).run();

  // Lote 4: ALERTA (validade: 2026-12-05 -> 25 dias <= 30) -> 30 un a R$ 6.00 = R$ 180,00
  db.prepare(`
    INSERT INTO LoteEstoque (gerente_id, produto_id, numero_lote, data_validade, quantidade_inicial, quantidade_saldo, custo_unitario, status)
    VALUES (1, 2, 'LOTE-ALE-01', '2026-12-05', 30, 30, 6.0, 'ativo');
  `).run();

  // Lote 5: SEGURO / NORMAL (validade: 2027-04-10 -> > 30 dias) -> 100 un a R$ 2.00 = R$ 200,00
  db.prepare(`
    INSERT INTO LoteEstoque (gerente_id, produto_id, numero_lote, data_validade, quantidade_inicial, quantidade_saldo, custo_unitario, status)
    VALUES (1, 4, 'LOTE-SEG-01', '2027-04-10', 100, 100, 2.0, 'ativo');
  `).run();

  // Lote 6: ESGOTADO (saldo = 0) -> NÃO DEVE ENTRAR NO CAPITAL PARADO SOB RISCO
  db.prepare(`
    INSERT INTO LoteEstoque (gerente_id, produto_id, numero_lote, data_validade, quantidade_inicial, quantidade_saldo, custo_unitario, status)
    VALUES (1, 1, 'LOTE-ZERADO', '2026-11-12', 10, 0, 18.0, 'esgotado');
  `).run();

  // Função do Motor de Triagem de Validade e Cálculo Dinâmico de Capital Parado
  function processarTriagem(hoje) {
    const lotes = db.prepare(`
      SELECT le.*, p.nome as produto_nome, p.categoria as produto_categoria
      FROM LoteEstoque le
      JOIN Produto p ON p.id = le.produto_id
      WHERE le.quantidade_saldo > 0 AND le.status = 'ativo' AND le.data_validade IS NOT NULL
      ORDER BY le.data_validade ASC;
    `).all();

    const hojeTime = new Date(hoje + 'T00:00:00Z').getTime();

    const faixas = {
      vencidos: { lotes: [], capitalParado: 0.0, totalItens: 0 },
      critico: { lotes: [], capitalParado: 0.0, totalItens: 0 },
      medio: { lotes: [], capitalParado: 0.0, totalItens: 0 },
      alerta: { lotes: [], capitalParado: 0.0, totalItens: 0 },
      seguro: { lotes: [], capitalParado: 0.0, totalItens: 0 }
    };

    for (const l of lotes) {
      const valTime = new Date(l.data_validade + 'T00:00:00Z').getTime();
      const dias = Math.round((valTime - hojeTime) / (1000 * 60 * 60 * 24));
      const capital = round2(l.quantidade_saldo * l.custo_unitario);

      if (dias < 0) {
        faixas.vencidos.lotes.push(l);
        faixas.vencidos.capitalParado = round2(faixas.vencidos.capitalParado + capital);
        faixas.vencidos.totalItens += l.quantidade_saldo;
      } else if (dias <= 7) {
        faixas.critico.lotes.push(l);
        faixas.critico.capitalParado = round2(faixas.critico.capitalParado + capital);
        faixas.critico.totalItens += l.quantidade_saldo;
      } else if (dias <= 15) {
        faixas.medio.lotes.push(l);
        faixas.medio.capitalParado = round2(faixas.medio.capitalParado + capital);
        faixas.medio.totalItens += l.quantidade_saldo;
      } else if (dias <= 30) {
        faixas.alerta.lotes.push(l);
        faixas.alerta.capitalParado = round2(faixas.alerta.capitalParado + capital);
        faixas.alerta.totalItens += l.quantidade_saldo;
      } else {
        faixas.seguro.lotes.push(l);
        faixas.seguro.capitalParado = round2(faixas.seguro.capitalParado + capital);
        faixas.seguro.totalItens += l.quantidade_saldo;
      }
    }

    const capitalTotalEmRisco = round2(
      faixas.vencidos.capitalParado +
      faixas.critico.capitalParado +
      faixas.medio.capitalParado +
      faixas.alerta.capitalParado
    );

    return { faixas, capitalTotalEmRisco };
  }

  const triagem = processarTriagem(dataRef);

  // 1. Faixa Vencidos (< hoje): 1 lote (10 un Queijo * R$ 18,00 = R$ 180,00)
  assert.equal(triagem.faixas.vencidos.lotes.length, 1);
  assert.equal(triagem.faixas.vencidos.lotes[0].numero_lote, 'LOTE-VENC-01');
  assert.equal(triagem.faixas.vencidos.capitalParado, 180.00);
  assert.equal(triagem.faixas.vencidos.totalItens, 10);

  // 2. Faixa Risco Crítico (até 7 dias): 1 lote (20 un Iogurte * R$ 6,00 = R$ 120,00)
  assert.equal(triagem.faixas.critico.lotes.length, 1);
  assert.equal(triagem.faixas.critico.lotes[0].numero_lote, 'LOTE-CRIT-01');
  assert.equal(triagem.faixas.critico.capitalParado, 120.00);
  assert.equal(triagem.faixas.critico.totalItens, 20);

  // 3. Faixa Risco Médio (8 a 15 dias): 1 lote (15 un Pão * R$ 4,50 = R$ 67,50)
  assert.equal(triagem.faixas.medio.lotes.length, 1);
  assert.equal(triagem.faixas.medio.lotes[0].numero_lote, 'LOTE-MED-01');
  assert.equal(triagem.faixas.medio.capitalParado, 67.50);
  assert.equal(triagem.faixas.medio.totalItens, 15);

  // 4. Faixa Alerta (16 a 30 dias): 1 lote (30 un Iogurte * R$ 6,00 = R$ 180,00)
  assert.equal(triagem.faixas.alerta.lotes.length, 1);
  assert.equal(triagem.faixas.alerta.lotes[0].numero_lote, 'LOTE-ALE-01');
  assert.equal(triagem.faixas.alerta.capitalParado, 180.00);
  assert.equal(triagem.faixas.alerta.totalItens, 30);

  // 5. Total de Capital Parado sob Risco:
  // Vencidos (180.00) + Crítico (120.00) + Médio (67.50) + Alerta (180.00) = R$ 547,50
  assert.equal(triagem.capitalTotalEmRisco, 547.50);

  // 6. Faixa Segura (> 30 dias): R$ 200,00 que NÃO é contabilizado no risco
  assert.equal(triagem.faixas.seguro.capitalParado, 200.00);

  // 7. Validação da VIEW SQL (vw_triagem_validade_lotes)
  const viewRows = db.prepare('SELECT * FROM vw_triagem_validade_lotes').all();
  // 5 lotes ativos com saldo > 0 e validade
  assert.equal(viewRows.length, 5);
  // Garante que o lote com saldo zero não está presente na view
  assert.equal(viewRows.some(r => r.numero_lote === 'LOTE-ZERADO'), false);
  // Valida que o capital parado na view é exatamente calculado
  const queijoView = viewRows.find(r => r.numero_lote === 'LOTE-VENC-01');
  assert.equal(queijoView.capital_parado, 180.00);
});
