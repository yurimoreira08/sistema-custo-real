import { initSyncQueue, syncOrEnqueue } from './syncService';
import { getDb } from './dbInstance';

// Inicializa a estrutura de tabelas e insere dados padrão caso o banco esteja vazio
export async function initializeDatabase() {
  try {
    const db = await getDb();

    // Habilitar chaves estrangeiras
    await db.execAsync('PRAGMA foreign_keys = ON;');

    // Criar Tabela: Usuario
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS Usuario (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        senha TEXT NOT NULL
      );
    `);

    // Criar Tabela: Produto
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS Produto (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        marca TEXT,
        codigo_barras TEXT,
        categoria TEXT,
        preco_custo REAL NOT NULL,
        preco_venda REAL NOT NULL,
        estoque INTEGER NOT NULL DEFAULT 0,
        estoque_minimo INTEGER NOT NULL DEFAULT 0
      );
    `);

    // Migração segura para adicionar a coluna categoria se não existir
    try {
      await db.execAsync('ALTER TABLE Produto ADD COLUMN categoria TEXT;');
      console.log('Banco de dados: Coluna categoria adicionada com sucesso.');
    } catch (e) {
      // A coluna já existe, ignorar erro
    }

    // Índice para buscas instantâneas por código de barras (leitor físico e câmera)
    await db.execAsync('CREATE INDEX IF NOT EXISTS idx_produto_codigo_barras ON Produto(codigo_barras);');

    // Criar Tabela: Venda
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS Venda (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        data_venda TEXT NOT NULL,
        valor_total REAL NOT NULL,
        valor_cmv REAL NOT NULL,
        valor_opex REAL NOT NULL,
        valor_lucro REAL NOT NULL
      );
    `);

    // Criar Tabela: ItensVenda
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS ItensVenda (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        venda_id INTEGER NOT NULL,
        produto_id INTEGER NOT NULL,
        quantidade INTEGER NOT NULL,
        preco_unitario REAL NOT NULL,
        preco_custo_unitario REAL NOT NULL,
        FOREIGN KEY (venda_id) REFERENCES Venda(id) ON DELETE CASCADE,
        FOREIGN KEY (produto_id) REFERENCES Produto(id)
      );
    `);

    // Criar Tabela: Configuracoes
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS Configuracoes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        percentual_cmv REAL NOT NULL,
        percentual_opex REAL NOT NULL,
        percentual_lucro REAL NOT NULL,
        oscbr_usuario TEXT,
        oscbr_senha TEXT
      );
    `);

    // Migração segura para adicionar as colunas de credenciais OSCBR se a tabela já existir
    try {
      await db.execAsync('ALTER TABLE Configuracoes ADD COLUMN oscbr_usuario TEXT;');
    } catch (e) {
      // Já existe, ignora
    }
    try {
      await db.execAsync('ALTER TABLE Configuracoes ADD COLUMN oscbr_senha TEXT;');
    } catch (e) {
      // Já existe, ignora
    }

    // Criar fila de sincronização Supabase (offline-first)
    await initSyncQueue();

    // --- SEEDING INICIAL DE DADOS ---
    // Marca se algum seed ocorreu, para subir o estado inicial à nuvem ao final.
    let seeded = false;

    // 1. Usuário Padrão
    const userCheck = await db.getAllAsync('SELECT * FROM Usuario LIMIT 1;');
    if (userCheck.length === 0) {
      await db.runAsync(
        'INSERT INTO Usuario (nome, email, senha) VALUES (?, ?, ?);',
        ['Administrador', 'admin', '123456']
      );
      console.log('Banco de dados: Usuário padrão admin/123456 inserido.');
    }

    // 2. Configurações Padrão (CMV 60%, OpEx 20%, Lucro 20%)
    const configCheck = await db.getAllAsync('SELECT * FROM Configuracoes LIMIT 1;');
    if (configCheck.length === 0) {
      await db.runAsync(
        'INSERT INTO Configuracoes (percentual_cmv, percentual_opex, percentual_lucro) VALUES (?, ?, ?);',
        [60.0, 20.0, 20.0]
      );
      console.log('Banco de dados: Configuração padrão (60/20/20) inserida.');
      seeded = true;
    }

    // 3. Produtos de Exemplo
    const prodCheck = await db.getAllAsync('SELECT * FROM Produto LIMIT 1;');
    if (prodCheck.length === 0) {
      await db.runAsync(
        'INSERT INTO Produto (nome, marca, codigo_barras, categoria, preco_custo, preco_venda, estoque, estoque_minimo) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
        ['Leite Integral 1L', 'Italac', '001', 'Laticínios', 2.8, 4.5, 42, 10]
      );
      await db.runAsync(
        'INSERT INTO Produto (nome, marca, codigo_barras, categoria, preco_custo, preco_venda, estoque, estoque_minimo) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
        ['Arroz Tipo 1 5kg', 'Tio João', '002', 'Mercearia', 15.0, 24.9, 15, 10]
      );
      await db.runAsync(
        'INSERT INTO Produto (nome, marca, codigo_barras, categoria, preco_custo, preco_venda, estoque, estoque_minimo) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
        ['Leite Condensado 395g', 'Moça', '003', 'Laticínios', 6.0, 9.9, 3, 5] // Estoque baixo
      );
      await db.runAsync(
        'INSERT INTO Produto (nome, marca, codigo_barras, categoria, preco_custo, preco_venda, estoque, estoque_minimo) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
        ['Feijão Carioca 1kg', 'Camil', '004', 'Mercearia', 5.0, 8.5, 4, 5] // Estoque baixo
      );
      console.log('Banco de dados: Produtos de exemplo inseridos.');

      // 4. Vendas de Exemplo (para popular gráficos/dashboard no primeiro acesso)
      // Vamos inserir duas vendas de exemplo
      const now = new Date().toISOString();
      
      // Venda 1: Feijão Carioca 1kg (2x) e Arroz Integral (1x). Total = 25.0
      // Usaremos o split padrão de 60% CMV (15.0), 20% OpEx (5.0), 20% Lucro (5.0)
      const venda1Res = await db.runAsync(
        'INSERT INTO Venda (data_venda, valor_total, valor_cmv, valor_opex, valor_lucro) VALUES (?, ?, ?, ?, ?);',
        [now, 24.9, 14.94, 4.98, 4.98]
      );
      const v1Id = venda1Res.lastInsertRowId;
      await db.runAsync(
        'INSERT INTO ItensVenda (venda_id, produto_id, quantidade, preco_unitario, preco_custo_unitario) VALUES (?, ?, ?, ?, ?);',
        [v1Id, 1, 2, 8.5, 5.0]
      );
      await db.runAsync(
        'INSERT INTO ItensVenda (venda_id, produto_id, quantidade, preco_unitario, preco_custo_unitario) VALUES (?, ?, ?, ?, ?);',
        [v1Id, 2, 1, 7.9, 4.5]
      );

      // Venda 2: Leite Condensado (1x) e Óleo de Soja (2x). Total = 24.3
      // Split: CMV (14.58), OpEx (4.86), Lucro (4.86)
      const venda2Res = await db.runAsync(
        'INSERT INTO Venda (data_venda, valor_total, valor_cmv, valor_opex, valor_lucro) VALUES (?, ?, ?, ?, ?);',
        [now, 24.3, 14.58, 4.86, 4.86]
      );
      const v2Id = venda2Res.lastInsertRowId;
      await db.runAsync(
        'INSERT INTO ItensVenda (venda_id, produto_id, quantidade, preco_unitario, preco_custo_unitario) VALUES (?, ?, ?, ?, ?);',
        [v2Id, 3, 1, 9.9, 6.0]
      );
      await db.runAsync(
        'INSERT INTO ItensVenda (venda_id, produto_id, quantidade, preco_unitario, preco_custo_unitario) VALUES (?, ?, ?, ?, ?);',
        [v2Id, 4, 2, 7.2, 5.5]
      );

      // Ajusta estoque dos produtos após essas vendas
      await db.runAsync('UPDATE Produto SET estoque = estoque - 2 WHERE id = 1;');
      await db.runAsync('UPDATE Produto SET estoque = estoque - 1 WHERE id = 2;');
      await db.runAsync('UPDATE Produto SET estoque = estoque - 1 WHERE id = 3;');
      await db.runAsync('UPDATE Produto SET estoque = estoque - 2 WHERE id = 4;');
      console.log('Banco de dados: Vendas de exemplo e atualização de estoque concluídas.');
      seeded = true;
    }

    // Se houve seeding inicial, sobe todo o estado local para o Supabase.
    // syncOrEnqueue é offline-safe: envia se online, senão enfileira para retry.
    if (seeded) {
      await enqueueFullSync();
      console.log('Banco de dados: estado inicial enfileirado para sincronização.');
    }
  } catch (error) {
    console.error('Erro ao inicializar o banco de dados:', error);
  }
}

// Enfileira TODO o estado local atual (config, produtos, vendas e itens) para o
// Supabase. Usado no seeding inicial para que o catálogo e as vendas de exemplo
// também subam à nuvem. Ordem (config → produtos → vendas → itens) respeita as
// FKs do Postgres, tanto no envio imediato quanto no processamento FIFO da fila.
export async function enqueueFullSync() {
  const db = await getDb();

  const config = await db.getAllAsync('SELECT * FROM Configuracoes WHERE id = 1 LIMIT 1;');
  if (config[0]) {
    await syncOrEnqueue('Configuracoes', 'upsert', {
      id: config[0].id,
      percentual_cmv: config[0].percentual_cmv,
      percentual_opex: config[0].percentual_opex,
      percentual_lucro: config[0].percentual_lucro,
    });
  }

  const produtos = await db.getAllAsync('SELECT * FROM Produto;');
  for (const p of produtos) {
    await syncOrEnqueue('Produto', 'upsert', {
      id: p.id,
      nome: p.nome,
      marca: p.marca ?? null,
      codigo_barras: p.codigo_barras ?? null,
      categoria: p.categoria ?? 'Outros',
      preco_custo: p.preco_custo,
      preco_venda: p.preco_venda,
      estoque: p.estoque,
      estoque_minimo: p.estoque_minimo,
    });
  }

  const vendas = await db.getAllAsync('SELECT * FROM Venda;');
  for (const v of vendas) {
    await syncOrEnqueue('Venda', 'upsert', {
      id: v.id,
      data_venda: v.data_venda,
      valor_total: v.valor_total,
      valor_cmv: v.valor_cmv,
      valor_opex: v.valor_opex,
      valor_lucro: v.valor_lucro,
    });
  }

  const itens = await db.getAllAsync('SELECT * FROM ItensVenda;');
  for (const it of itens) {
    await syncOrEnqueue('ItensVenda', 'upsert', {
      id: it.id,
      venda_id: it.venda_id,
      produto_id: it.produto_id,
      quantidade: it.quantidade,
      preco_unitario: it.preco_unitario,
      preco_custo_unitario: it.preco_custo_unitario,
    });
  }
}

// --- FUNÇÕES DE CONSULTA E MUTACAO ---

// Autenticação de usuário
export async function authenticateUser(emailOrUsername, senha) {
  const db = await getDb();
  const results = await db.getAllAsync(
    'SELECT * FROM Usuario WHERE (email = ? OR nome = ?) AND senha = ? LIMIT 1;',
    [emailOrUsername, emailOrUsername, senha]
  );
  return results.length > 0 ? results[0] : null;
}

// Obter todos os produtos
export async function fetchProducts() {
  const db = await getDb();
  return await db.getAllAsync('SELECT * FROM Produto ORDER BY nome ASC;');
}

// Adicionar ou atualizar produto
export async function saveProduct(product) {
  const db = await getDb();
  let result;

  if (product.id) {
    // Atualizar produto existente
    result = await db.runAsync(
      'UPDATE Produto SET nome = ?, marca = ?, codigo_barras = ?, categoria = ?, preco_custo = ?, preco_venda = ?, estoque = ?, estoque_minimo = ? WHERE id = ?;',
      [
        product.nome,
        product.marca || null,
        product.codigo_barras || null,
        product.categoria || 'Outros',
        product.preco_custo,
        product.preco_venda,
        product.estoque,
        product.estoque_minimo,
        product.id
      ]
    );
    // Sincronizar com Supabase (offline-first)
    await syncOrEnqueue('Produto', 'upsert', {
      id: product.id,
      nome: product.nome,
      marca: product.marca || null,
      codigo_barras: product.codigo_barras || null,
      categoria: product.categoria || 'Outros',
      preco_custo: product.preco_custo,
      preco_venda: product.preco_venda,
      estoque: product.estoque,
      estoque_minimo: product.estoque_minimo,
    });
  } else {
    // Inserir novo produto
    result = await db.runAsync(
      'INSERT INTO Produto (nome, marca, codigo_barras, categoria, preco_custo, preco_venda, estoque, estoque_minimo) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [
        product.nome,
        product.marca || null,
        product.codigo_barras || null,
        product.categoria || 'Outros',
        product.preco_custo,
        product.preco_venda,
        product.estoque,
        product.estoque_minimo
      ]
    );
    // Sincronizar com Supabase (offline-first)
    await syncOrEnqueue('Produto', 'upsert', {
      id: result.lastInsertRowId,
      nome: product.nome,
      marca: product.marca || null,
      codigo_barras: product.codigo_barras || null,
      categoria: product.categoria || 'Outros',
      preco_custo: product.preco_custo,
      preco_venda: product.preco_venda,
      estoque: product.estoque,
      estoque_minimo: product.estoque_minimo,
    });
  }

  return result;
}

// Excluir produto
export async function deleteProduct(id) {
  const db = await getDb();
  const result = await db.runAsync('DELETE FROM Produto WHERE id = ?;', [id]);
  // Sincronizar deleção com Supabase (offline-first)
  await syncOrEnqueue('Produto', 'delete', { id });
  return result;
}

// Obter as configurações globais de split
export async function fetchSettings() {
  const db = await getDb();
  const configs = await db.getAllAsync('SELECT * FROM Configuracoes WHERE id = 1 LIMIT 1;');
  if (configs.length > 0) {
    return configs[0];
  }
  // Fallback se não inicializado
  return { percentual_cmv: 60.0, percentual_opex: 20.0, percentual_lucro: 20.0 };
}

// Salvar/atualizar configurações globais de split e credenciais da API OSCBR
export async function saveSettings(cmv, opex, lucro, oscbrUsuario = null, oscbrSenha = null) {
  const db = await getDb();
  const result = await db.runAsync(
    'UPDATE Configuracoes SET percentual_cmv = ?, percentual_opex = ?, percentual_lucro = ?, oscbr_usuario = ?, oscbr_senha = ? WHERE id = 1;',
    [cmv, opex, lucro, oscbrUsuario, oscbrSenha]
  );
  // Sincronizar com Supabase (offline-first) — apenas os percentuais de split.
  // As credenciais OSCBR ficam somente no dispositivo (não são enviadas à nuvem).
  await syncOrEnqueue('Configuracoes', 'upsert', {
    id: 1,
    percentual_cmv: cmv,
    percentual_opex: opex,
    percentual_lucro: lucro,
  });
  return result;
}

// Registrar uma venda aplicando split automático (RN01) e bloqueio de estoque (RN02)
export async function registerSale(cartItems, splitPercentages) {
  const db = await getDb();

  // Payloads coletados DENTRO da transação e sincronizados APÓS o commit,
  // para não segurar a transação SQLite aberta durante I/O de rede.
  let vendaId;
  let vendaPayload;
  const itemPayloads = [];
  const produtoPayloads = [];

  // Executa toda a transação de forma atômica
  await db.withTransactionAsync(async () => {
    // 1. Calcular valores
    let valorTotal = 0;
    for (const item of cartItems) {
      valorTotal += item.preco_venda * item.quantidade;
    }

    const { percentual_cmv, percentual_opex, percentual_lucro } = splitPercentages;
    const valorCmv = parseFloat((valorTotal * (percentual_cmv / 100)).toFixed(2));
    const valorOpex = parseFloat((valorTotal * (percentual_opex / 100)).toFixed(2));
    const valorLucro = parseFloat((valorTotal - valorCmv - valorOpex).toFixed(2)); // Lucro como sobra para garantir fechamento de centavos

    // 2. Inserir a venda
    const now = new Date().toISOString();
    const saleResult = await db.runAsync(
      'INSERT INTO Venda (data_venda, valor_total, valor_cmv, valor_opex, valor_lucro) VALUES (?, ?, ?, ?, ?);',
      [now, valorTotal, valorCmv, valorOpex, valorLucro]
    );
    vendaId = saleResult.lastInsertRowId;
    vendaPayload = {
      id: vendaId,
      data_venda: now,
      valor_total: valorTotal,
      valor_cmv: valorCmv,
      valor_opex: valorOpex,
      valor_lucro: valorLucro,
    };

    // 3. Processar cada item da venda
    for (const item of cartItems) {
      // Buscar o produto atual (estoque para validação + demais campos para o sync autoritativo)
      const productRow = await db.getAllAsync(
        'SELECT nome, marca, codigo_barras, categoria, preco_custo, preco_venda, estoque, estoque_minimo FROM Produto WHERE id = ?;',
        [item.id]
      );
      if (productRow.length === 0) {
        throw new Error(`Produto "${item.nome}" não encontrado.`);
      }
      const prod = productRow[0];

      const newStock = prod.estoque - item.quantidade;

      // RN02: Bloqueio de Estoque
      if (newStock < 0) {
        throw new Error(`Estoque insuficiente para "${item.nome}". Disponível: ${prod.estoque}, Solicitado: ${item.quantidade}`);
      }

      // Atualizar o estoque do produto
      await db.runAsync('UPDATE Produto SET estoque = ? WHERE id = ?;', [newStock, item.id]);

      // Inserir item da venda (capturando o id para sync idempotente)
      const itemResult = await db.runAsync(
        'INSERT INTO ItensVenda (venda_id, produto_id, quantidade, preco_unitario, preco_custo_unitario) VALUES (?, ?, ?, ?, ?);',
        [vendaId, item.id, item.quantidade, item.preco_venda, item.preco_custo]
      );

      itemPayloads.push({
        id: itemResult.lastInsertRowId,
        venda_id: vendaId,
        produto_id: item.id,
        quantidade: item.quantidade,
        preco_unitario: item.preco_venda,
        preco_custo_unitario: item.preco_custo,
      });

      // Produto com estoque autoritativo (valores lidos do próprio banco)
      produtoPayloads.push({
        id: item.id,
        nome: prod.nome,
        marca: prod.marca ?? null,
        codigo_barras: prod.codigo_barras ?? null,
        categoria: prod.categoria ?? 'Outros',
        preco_custo: prod.preco_custo,
        preco_venda: prod.preco_venda,
        estoque: newStock,
        estoque_minimo: prod.estoque_minimo ?? 0,
      });
    }
  });

  // 4. Sincronizar com o Supabase APÓS o commit (fora da transação, offline-first).
  // Ordem obrigatória por causa das FKs do Postgres: ItensVenda referencia
  // Venda e Produto, então ambos os pais precisam subir ANTES do item — senão
  // o upsert do item falha com "violates foreign key constraint". Como a fila é
  // FIFO, essa ordem de enfileiramento também vale para o retry offline.
  await syncOrEnqueue('Venda', 'upsert', vendaPayload);
  for (const payload of produtoPayloads) {
    await syncOrEnqueue('Produto', 'upsert', payload);
  }
  for (const payload of itemPayloads) {
    await syncOrEnqueue('ItensVenda', 'upsert', payload);
  }

  return vendaId;
}

// Obter histórico de vendas
export async function fetchSalesHistory() {
  const db = await getDb();
  return await db.getAllAsync('SELECT * FROM Venda ORDER BY datetime(data_venda) DESC;');
}

// Obter estatísticas para o Dashboard
export async function fetchDashboardStats() {
  const db = await getDb();
  
  // Faturamento Total e soma das Carteiras
  const totals = await db.getAllAsync(`
    SELECT 
      SUM(valor_total) as faturamento_total,
      SUM(valor_cmv) as total_cmv,
      SUM(valor_opex) as total_opex,
      SUM(valor_lucro) as total_lucro
    FROM Venda;
  `);

  // Alerta de estoque baixo
  const lowStockProducts = await db.getAllAsync(`
    SELECT * FROM Produto 
    WHERE estoque <= estoque_minimo 
    ORDER BY estoque ASC;
  `);

  // Total de produtos cadastrados
  const productCountResult = await db.getAllAsync('SELECT COUNT(*) as total FROM Produto;');

  // Total de vendas registradas
  const saleCountResult = await db.getAllAsync('SELECT COUNT(*) as total FROM Venda;');

  const stats = totals[0] || {};
  
  return {
    faturamentoTotal: stats.faturamento_total || 0,
    totalCmv: stats.total_cmv || 0,
    totalOpex: stats.total_opex || 0,
    totalLucro: stats.total_lucro || 0,
    lowStockCount: lowStockProducts.length,
    lowStockProducts: lowStockProducts,
    totalProducts: productCountResult[0]?.total || 0,
    totalSales: saleCountResult[0]?.total || 0,
  };
}

// Obter os itens individuais de uma determinada venda
export async function fetchSaleItems(vendaId) {
  const db = await getDb();
  return await db.getAllAsync(`
    SELECT iv.*, p.nome, p.marca 
    FROM ItensVenda iv 
    JOIN Produto p ON iv.produto_id = p.id 
    WHERE iv.venda_id = ?;
  `, [vendaId]);
}

// Obter dados dinâmicos consolidados para o Dashboard
export async function fetchDashboardDetails() {
  const db = await getDb();
  
  // Obter data de hoje em formato ISO local (início do dia local)
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const startOfDayISO = startOfDay.toISOString();

  // 1. Vendas Hoje (Soma do valor_total das vendas de hoje)
  const vendasHojeResult = await db.getAllAsync(
    'SELECT SUM(valor_total) as total FROM Venda WHERE data_venda >= ?;',
    [startOfDayISO]
  );
  const vendasHoje = vendasHojeResult[0]?.total || 0;

  // 2. Transações Hoje (Quantidade de pedidos hoje)
  const transacoesHojeResult = await db.getAllAsync(
    'SELECT COUNT(*) as count FROM Venda WHERE data_venda >= ?;',
    [startOfDayISO]
  );
  const transacoesHoje = transacoesHojeResult[0]?.count || 0;

  // 3. Itens Vendidos Hoje (Soma das quantidades vendidas hoje)
  const itensVendidosHojeResult = await db.getAllAsync(
    'SELECT SUM(iv.quantidade) as total_qty FROM ItensVenda iv JOIN Venda v ON iv.venda_id = v.id WHERE v.data_venda >= ?;',
    [startOfDayISO]
  );
  const itensVendidosHoje = itensVendidosHojeResult[0]?.total_qty || 0;

  // 4. Estoque Baixo (Produtos com estoque <= estoque_minimo)
  const estoqueBaixoResult = await db.getAllAsync(
    'SELECT COUNT(*) as count FROM Produto WHERE estoque <= estoque_minimo;'
  );
  const estoqueBaixoCount = estoqueBaixoResult[0]?.count || 0;

  // 5. Últimas Vendas (Últimos 10 registros de venda)
  const ultimasVendas = await db.getAllAsync(
    'SELECT * FROM Venda ORDER BY datetime(data_venda) DESC LIMIT 10;'
  );

  // Formatar itens de cada venda para exibição
  const ultimasVendasFormatadas = [];
  for (const venda of ultimasVendas) {
    const itens = await db.getAllAsync(
      'SELECT iv.quantidade, p.nome, p.marca FROM ItensVenda iv JOIN Produto p ON iv.produto_id = p.id WHERE iv.venda_id = ?;',
      [venda.id]
    );

    let descricaoItens = '';
    let totalQtdItens = 0;
    
    if (itens.length > 0) {
      // Cria descrição concatenada: "Nome1 + Nome2"
      const nomes = itens.map(it => {
        const palavras = it.nome.split(' ');
        // Pega as primeiras duas palavras ou a primeira para ficar amigável
        return palavras.length > 1 ? `${palavras[0]} ${palavras[1]}` : palavras[0];
      });
      
      descricaoItens = nomes.slice(0, 2).join(' + ');
      if (nomes.length > 2) {
        descricaoItens += ' e outros';
      }
      totalQtdItens = itens.reduce((sum, it) => sum + it.quantidade, 0);
    } else {
      descricaoItens = 'Venda Registrada';
    }

    ultimasVendasFormatadas.push({
      ...venda,
      descricaoItens,
      totalQtdItens
    });
  }

  return {
    vendasHoje,
    transacoesHoje,
    itensVendidosHoje,
    estoqueBaixoCount,
    ultimasVendas: ultimasVendasFormatadas
  };
}

// Resumo (read-only) do caixa de um dia específico. Zeros e lista vazia se não houver vendas.
export async function fetchDailyClosing(date) {
  const db = await getDb();
  const base = date instanceof Date ? date : new Date(date);
  const inicio = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, 0, 0, 0);
  const fim = new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1, 0, 0, 0, 0);
  const inicioISO = inicio.toISOString();
  const fimISO = fim.toISOString();

  const totais = await db.getAllAsync(
    `SELECT
       COUNT(*) AS num_vendas,
       COALESCE(SUM(valor_total), 0) AS faturamento,
       COALESCE(SUM(valor_cmv), 0)   AS cmv,
       COALESCE(SUM(valor_opex), 0)  AS opex,
       COALESCE(SUM(valor_lucro), 0) AS lucro
     FROM Venda
     WHERE data_venda >= ? AND data_venda < ?;`,
    [inicioISO, fimISO]
  );

  const itens = await db.getAllAsync(
    `SELECT COALESCE(SUM(iv.quantidade), 0) AS total_itens
       FROM ItensVenda iv JOIN Venda v ON iv.venda_id = v.id
      WHERE v.data_venda >= ? AND v.data_venda < ?;`,
    [inicioISO, fimISO]
  );

  const topProdutos = await db.getAllAsync(
    `SELECT p.nome AS nome,
            SUM(iv.quantidade) AS qtd,
            SUM(iv.quantidade * iv.preco_unitario) AS total
       FROM ItensVenda iv
       JOIN Venda v   ON iv.venda_id = v.id
       JOIN Produto p ON iv.produto_id = p.id
      WHERE v.data_venda >= ? AND v.data_venda < ?
      GROUP BY iv.produto_id
      ORDER BY qtd DESC
      LIMIT 5;`,
    [inicioISO, fimISO]
  );

  const t = totais[0] || {};
  const numVendas = t.num_vendas || 0;
  const faturamento = t.faturamento || 0;

  return {
    numVendas,
    faturamento,
    cmv: t.cmv || 0,
    opex: t.opex || 0,
    lucro: t.lucro || 0,
    itensVendidos: itens[0]?.total_itens || 0,
    ticketMedio: numVendas > 0 ? faturamento / numVendas : 0,
    topProdutos,
  };
}

// Obter dados dinâmicos estruturados para relatórios de desempenho financeiro
export async function fetchReportData(days) {
  const db = await getDb();
  
  const now = new Date();
  const limitDate = new Date();
  limitDate.setDate(now.getDate() - days);
  const limitDateISO = limitDate.toISOString();

  // 1. Vendas no período atual
  const currentSales = await db.getAllAsync(
    'SELECT * FROM Venda WHERE data_venda >= ? ORDER BY datetime(data_venda) ASC;',
    [limitDateISO]
  );

  let receitaTotal = 0;
  let cmvTotal = 0;
  let opexTotal = 0;
  let lucroTotal = 0;

  for (const sale of currentSales) {
    receitaTotal += sale.valor_total;
    cmvTotal += sale.valor_cmv;
    opexTotal += sale.valor_opex;
    lucroTotal += sale.valor_lucro;
  }

  const custoTotal = cmvTotal + opexTotal;

  // 2. Vendas no período anterior (para base de tendências)
  const prevLimitDate = new Date();
  prevLimitDate.setDate(now.getDate() - (days * 2));
  const prevLimitDateISO = prevLimitDate.toISOString();

  const prevSalesResult = await db.getAllAsync(
    'SELECT SUM(valor_total) as total FROM Venda WHERE data_venda >= ? AND data_venda < ?;',
    [prevLimitDateISO, limitDateISO]
  );
  const prevReceita = prevSalesResult[0]?.total || 0;

  // 3. Valor total do ativo em estoque (estoque * preco_custo)
  const stockValueResult = await db.getAllAsync(
    'SELECT SUM(estoque * preco_custo) as total_valor_estoque FROM Produto;'
  );
  const valorEstoque = stockValueResult[0]?.total_valor_estoque || 0;

  // 4. Divisão dos dados em 6 intervalos de barras para o gráfico
  const chartData = [];
  const intervalDays = Math.ceil(days / 6);

  for (let i = 5; i >= 0; i--) {
    const start = new Date();
    start.setDate(now.getDate() - ((i + 1) * intervalDays));
    start.setHours(0, 0, 0, 0);
    
    const end = new Date();
    end.setDate(now.getDate() - (i * intervalDays));
    end.setHours(23, 59, 59, 999);

    const intervalSales = await db.getAllAsync(
      'SELECT SUM(valor_total) as total, SUM(valor_cmv) as cmv, SUM(valor_opex) as opex FROM Venda WHERE data_venda >= ? AND data_venda <= ?;',
      [start.toISOString(), end.toISOString()]
    );

    const rec = intervalSales[0]?.total || 0;
    const cst = (intervalSales[0]?.cmv || 0) + (intervalSales[0]?.opex || 0);

    let label = '';
    if (days <= 7) {
      const weekdays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
      label = weekdays[end.getDay()];
    } else {
      label = `${end.getDate()}/${end.getMonth() + 1}`;
    }

    chartData.push({
      label,
      receita: rec,
      custo: cst
    });
  }

  return {
    receitaTotal,
    custoTotal,
    lucroTotal,
    valorEstoque,
    prevReceita,
    chartData
  };
}
