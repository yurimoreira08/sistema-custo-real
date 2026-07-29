import { initSyncQueue, syncOrEnqueue } from './syncService';
import { getDb } from './dbInstance';
import { hashPassword } from '../utils/crypto';
import { supabase, isSupabaseConfigured } from './supabaseClient';

// Inicializa o esquema do SQLite e insere dados padrão e migrações caso o banco esteja vazio
export async function initializeDatabase() {
  try {
    const db = await getDb();

    await db.execAsync('PRAGMA foreign_keys = ON;');

    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS Usuario (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        senha TEXT NOT NULL,
        cargo TEXT NOT NULL DEFAULT 'gerente',
        gerente_id INTEGER
      );
    `);

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
        estoque_minimo INTEGER NOT NULL DEFAULT 0,
        gerente_id INTEGER DEFAULT 1
      );
    `);

    try {
      await db.execAsync('ALTER TABLE Produto ADD COLUMN categoria TEXT;');
      console.log('Banco de dados: Coluna categoria adicionada com sucesso.');
    } catch (e) {}

    await db.execAsync('CREATE INDEX IF NOT EXISTS idx_produto_codigo_barras ON Produto(codigo_barras);');

    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS Venda (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        data_venda TEXT NOT NULL,
        valor_total REAL NOT NULL,
        valor_cmv REAL NOT NULL,
        valor_opex REAL NOT NULL,
        valor_lucro REAL NOT NULL,
        gerente_id INTEGER DEFAULT 1
      );
    `);

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

    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS Configuracoes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        percentual_cmv REAL NOT NULL,
        percentual_opex REAL NOT NULL,
        percentual_lucro REAL NOT NULL,
        gerente_id INTEGER
      );
    `);

    try {
      await db.execAsync("ALTER TABLE Usuario ADD COLUMN cargo TEXT NOT NULL DEFAULT 'gerente';");
    } catch (e) {}
    try {
      await db.execAsync("ALTER TABLE Usuario ADD COLUMN gerente_id INTEGER;");
    } catch (e) {}
    try {
      await db.execAsync("ALTER TABLE Produto ADD COLUMN gerente_id INTEGER DEFAULT 1;");
    } catch (e) {}
    try {
      await db.execAsync("ALTER TABLE Venda ADD COLUMN gerente_id INTEGER DEFAULT 1;");
    } catch (e) {}
    try {
      await db.execAsync("ALTER TABLE Configuracoes ADD COLUMN gerente_id INTEGER;");
    } catch (e) {}

    await initSyncQueue();

    let seeded = false;

    const userCheck = await db.getAllAsync('SELECT * FROM Usuario LIMIT 1;');
    if (userCheck.length === 0) {
      await db.runAsync(
        'INSERT INTO Usuario (nome, email, senha, cargo, gerente_id) VALUES (?, ?, ?, ?, ?);',
        ['Administrador', 'admin', hashPassword('123456'), 'gerente', 1]
      );
      console.log('Banco de dados: Usuário padrão admin/123456 inserido.');
    } else {
      await db.runAsync(
        "UPDATE Usuario SET cargo = 'gerente', gerente_id = 1 WHERE email = 'admin';"
      );
    }

    const allUsers = await db.getAllAsync('SELECT id, senha FROM Usuario;');
    for (const u of allUsers) {
      if (u.senha.length !== 64) {
        const hashed = hashPassword(u.senha);
        await db.runAsync('UPDATE Usuario SET senha = ? WHERE id = ?;', [hashed, u.id]);
        console.log(`Banco de dados: Senha do usuário ID ${u.id} hashada com sucesso.`);
      }
    }

    const configCheck = await db.getAllAsync('SELECT * FROM Configuracoes LIMIT 1;');
    if (configCheck.length === 0) {
      await db.runAsync(
        'INSERT INTO Configuracoes (percentual_cmv, percentual_opex, percentual_lucro, gerente_id) VALUES (?, ?, ?, ?);',
        [60.0, 20.0, 20.0, 1]
      );
      console.log('Banco de dados: Configuração padrão (60/20/20) inserida.');
      seeded = true;
    } else {
      await db.runAsync('UPDATE Configuracoes SET gerente_id = 1 WHERE id = 1 AND gerente_id IS NULL;');
    }

    const prodCheck = await db.getAllAsync('SELECT * FROM Produto LIMIT 1;');
    if (prodCheck.length === 0) {
      await db.runAsync(
        'INSERT INTO Produto (nome, marca, codigo_barras, categoria, preco_custo, preco_venda, estoque, estoque_minimo, gerente_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);',
        ['Leite Integral 1L', 'Italac', '001', 'Laticínios', 2.8, 4.5, 42, 10, 1]
      );
      await db.runAsync(
        'INSERT INTO Produto (nome, marca, codigo_barras, categoria, preco_custo, preco_venda, estoque, estoque_minimo, gerente_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);',
        ['Arroz Tipo 1 5kg', 'Tio João', '002', 'Mercearia', 15.0, 24.9, 15, 10, 1]
      );
      await db.runAsync(
        'INSERT INTO Produto (nome, marca, codigo_barras, categoria, preco_custo, preco_venda, estoque, estoque_minimo, gerente_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);',
        ['Leite Condensado 395g', 'Moça', '003', 'Laticínios', 6.0, 9.9, 3, 5, 1]
      );
      await db.runAsync(
        'INSERT INTO Produto (nome, marca, codigo_barras, categoria, preco_custo, preco_venda, estoque, estoque_minimo, gerente_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);',
        ['Feijão Carioca 1kg', 'Camil', '004', 'Mercearia', 5.0, 8.5, 4, 5, 1]
      );
      console.log('Banco de dados: Produtos de exemplo inseridos.');

      const now = new Date().toISOString();
      
      const venda1Res = await db.runAsync(
        'INSERT INTO Venda (data_venda, valor_total, valor_cmv, valor_opex, valor_lucro, gerente_id) VALUES (?, ?, ?, ?, ?, ?);',
        [now, 24.9, 14.94, 4.98, 4.98, 1]
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

      const venda2Res = await db.runAsync(
        'INSERT INTO Venda (data_venda, valor_total, valor_cmv, valor_opex, valor_lucro, gerente_id) VALUES (?, ?, ?, ?, ?, ?);',
        [now, 24.3, 14.58, 4.86, 4.86, 1]
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

      await db.runAsync('UPDATE Produto SET estoque = estoque - 2 WHERE id = 1;');
      await db.runAsync('UPDATE Produto SET estoque = estoque - 1 WHERE id = 2;');
      await db.runAsync('UPDATE Produto SET estoque = estoque - 1 WHERE id = 3;');
      await db.runAsync('UPDATE Produto SET estoque = estoque - 2 WHERE id = 4;');
      console.log('Banco de dados: Vendas de exemplo e atualização de estoque concluídas.');
      seeded = true;
    }

    if (seeded) {
      await enqueueFullSync();
      console.log('Banco de dados: estado inicial enfileirado para sincronização.');
    }
  } catch (error) {
    console.error('Erro ao inicializar o banco de dados:', error);
  }
}

// Enfileira todo o estado local atual (configurações, produtos, vendas e itens) para subir ao Supabase
export async function enqueueFullSync() {
  const db = await getDb();

  const config = await db.getAllAsync('SELECT * FROM Configuracoes WHERE id = 1 LIMIT 1;');
  if (config[0]) {
    await syncOrEnqueue('Configuracoes', 'upsert', {
      id: config[0].id,
      percentual_cmv: config[0].percentual_cmv,
      percentual_opex: config[0].percentual_opex,
      percentual_lucro: config[0].percentual_lucro,
      gerente_id: config[0].gerente_id ?? 1
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
      gerente_id: p.gerente_id ?? 1
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
      gerente_id: v.gerente_id ?? 1
    });
  }

  const itens = await db.getAllAsync(`
    SELECT iv.*, v.gerente_id 
    FROM ItensVenda iv 
    JOIN Venda v ON iv.venda_id = v.id;
  `);
  for (const it of itens) {
    await syncOrEnqueue('ItensVenda', 'upsert', {
      id: it.id,
      venda_id: it.venda_id,
      produto_id: it.produto_id,
      quantidade: it.quantidade,
      preco_unitario: it.preco_unitario,
      preco_custo_unitario: it.preco_custo_unitario,
      gerente_id: it.gerente_id ?? 1
    });
  }
}

// Baixa todo o histórico do comércio associado ao gerente_id do Supabase e sincroniza no SQLite
export async function pullDataFromSupabase(gerenteId) {
  const db = await getDb();
  console.log(`[db] Puxando dados do Supabase para o gerente_id: ${gerenteId}...`);

  try {
    const { data: remoteSettings, error: errSettings } = await supabase
      .from('Configuracoes')
      .select('*')
      .eq('gerente_id', gerenteId);
    
    if (!errSettings && remoteSettings && remoteSettings.length > 0) {
      const s = remoteSettings[0];
      const local = await db.getAllAsync('SELECT id FROM Configuracoes WHERE gerente_id = ? LIMIT 1;', [gerenteId]);
      if (local.length > 0) {
        await db.runAsync(
          'UPDATE Configuracoes SET percentual_cmv = ?, percentual_opex = ?, percentual_lucro = ? WHERE gerente_id = ?;',
          [s.percentual_cmv, s.percentual_opex, s.percentual_lucro, gerenteId]
        );
      } else {
        await db.runAsync(
          'INSERT OR REPLACE INTO Configuracoes (id, percentual_cmv, percentual_opex, percentual_lucro, gerente_id) VALUES (?, ?, ?, ?, ?);',
          [s.id, s.percentual_cmv, s.percentual_opex, s.percentual_lucro, gerenteId]
        );
      }
      console.log('[db] ✓ Configurações sincronizadas do Supabase.');
    }

    const { data: remoteProducts, error: errProducts } = await supabase
      .from('Produto')
      .select('*')
      .eq('gerente_id', gerenteId);
    
    if (!errProducts && remoteProducts) {
      for (const p of remoteProducts) {
        const local = await db.getAllAsync('SELECT id FROM Produto WHERE id = ? AND gerente_id = ? LIMIT 1;', [p.id, gerenteId]);
        if (local.length > 0) {
          await db.runAsync(
            'UPDATE Produto SET nome = ?, marca = ?, codigo_barras = ?, categoria = ?, preco_custo = ?, preco_venda = ?, estoque = ?, estoque_minimo = ? WHERE id = ? AND gerente_id = ?;',
            [p.nome, p.marca, p.codigo_barras, p.categoria, p.preco_custo, p.preco_venda, p.estoque, p.estoque_minimo, p.id, gerenteId]
          );
        } else {
          await db.runAsync(
            'INSERT OR REPLACE INTO Produto (id, nome, marca, codigo_barras, categoria, preco_custo, preco_venda, estoque, estoque_minimo, gerente_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);',
            [p.id, p.nome, p.marca, p.codigo_barras, p.categoria, p.preco_custo, p.preco_venda, p.estoque, p.estoque_minimo, gerenteId]
          );
        }
      }
      console.log(`[db] ✓ ${remoteProducts.length} produto(s) sincronizado(s) do Supabase.`);
    }

    const { data: remoteSales, error: errSales } = await supabase
      .from('Venda')
      .select('*')
      .eq('gerente_id', gerenteId);
    
    if (!errSales && remoteSales) {
      for (const v of remoteSales) {
        const local = await db.getAllAsync('SELECT id FROM Venda WHERE id = ? AND gerente_id = ? LIMIT 1;', [v.id, gerenteId]);
        if (local.length > 0) {
          await db.runAsync(
            'UPDATE Venda SET data_venda = ?, valor_total = ?, valor_cmv = ?, valor_opex = ?, valor_lucro = ? WHERE id = ? AND gerente_id = ?;',
            [v.data_venda, v.valor_total, v.valor_cmv, v.valor_opex, v.valor_lucro, v.id, gerenteId]
          );
        } else {
          await db.runAsync(
            'INSERT OR REPLACE INTO Venda (id, data_venda, valor_total, valor_cmv, valor_opex, valor_lucro, gerente_id) VALUES (?, ?, ?, ?, ?, ?, ?);',
            [v.id, v.data_venda, v.valor_total, v.valor_cmv, v.valor_opex, v.valor_lucro, gerenteId]
          );
        }
      }
      console.log(`[db] ✓ ${remoteSales.length} venda(s) sincronizada(s) do Supabase.`);
    }

    const { data: remoteItems, error: errItems } = await supabase
      .from('ItensVenda')
      .select('*')
      .eq('gerente_id', gerenteId);
    
    if (!errItems && remoteItems) {
      for (const it of remoteItems) {
        const local = await db.getAllAsync('SELECT id FROM ItensVenda WHERE id = ? LIMIT 1;', [it.id]);
        if (local.length > 0) {
          await db.runAsync(
            'UPDATE ItensVenda SET venda_id = ?, produto_id = ?, quantidade = ?, preco_unitario = ?, preco_custo_unitario = ? WHERE id = ?;',
            [it.venda_id, it.produto_id, it.quantidade, it.preco_unitario, it.preco_custo_unitario, it.id]
          );
        } else {
          await db.runAsync(
            'INSERT OR REPLACE INTO ItensVenda (id, venda_id, produto_id, quantidade, preco_unitario, preco_custo_unitario) VALUES (?, ?, ?, ?, ?, ?);',
            [it.id, it.venda_id, it.produto_id, it.quantidade, it.preco_unitario, it.preco_custo_unitario]
          );
        }
      }
      console.log(`[db] ✓ ${remoteItems.length} item(ns) de venda sincronizado(s) do Supabase.`);
    }
  } catch (error) {
    console.error('[db] Erro na sincronização reversa (pull):', error);
  }
}

// Autentica as credenciais do usuário usando criptografia e fallback online na nuvem
export async function authenticateUser(emailOrUsername, senha) {
  const db = await getDb();
  const cleanEmailOrUsername = emailOrUsername.toLowerCase().trim();
  const hashedPassword = hashPassword(senha);

  const results = await db.getAllAsync(
    'SELECT * FROM Usuario WHERE (email = ? OR nome = ?) AND senha = ? LIMIT 1;',
    [cleanEmailOrUsername, cleanEmailOrUsername, hashedPassword]
  );

  if (results.length > 0) {
    console.log('[db] Usuário autenticado localmente.');
    return results[0];
  }

  if (isSupabaseConfigured()) {
    try {
      console.log('[db] Usuário não encontrado localmente. Buscando no Supabase...');
      const { data: remoteUsers, error } = await supabase
        .from('Usuario')
        .select('*')
        .or(`email.eq.${cleanEmailOrUsername},nome.eq.${cleanEmailOrUsername}`)
        .eq('senha', hashedPassword)
        .limit(1);

      if (error) throw error;

      if (remoteUsers && remoteUsers.length > 0) {
        const u = remoteUsers[0];
        console.log('[db] Usuário autenticado pelo Supabase. Salvando no SQLite local...');
        
        await db.runAsync(
          'INSERT OR REPLACE INTO Usuario (id, nome, email, senha, cargo, gerente_id) VALUES (?, ?, ?, ?, ?, ?);',
          [u.id, u.nome, u.email, u.senha, u.cargo, u.gerente_id]
        );

        await pullDataFromSupabase(u.gerente_id);

        return u;
      }
    } catch (e) {
      console.error('[db] Falha na autenticação remota pelo Supabase:', e);
    }
  }

  return null;
}

// Busca a lista de colaboradores associada ao gerente_id no banco local
export async function fetchUsers(gerenteId) {
  const db = await getDb();
  return await db.getAllAsync(
    'SELECT id, nome, email, cargo, gerente_id FROM Usuario WHERE gerente_id = ? ORDER BY nome ASC;',
    [gerenteId]
  );
}

// Cadastra um novo gerente ou colaborador de forma online-first na nuvem e replica no SQLite
export async function registerUser(nome, email, senha, cargo, gerenteId) {
  const db = await getDb();
  const cleanEmail = email.toLowerCase().trim();
  const hashedPassword = hashPassword(senha);
  
  const existing = await db.getAllAsync('SELECT * FROM Usuario WHERE email = ? LIMIT 1;', [cleanEmail]);
  if (existing.length > 0) {
    throw new Error('Este usuário/e-mail já está cadastrado localmente.');
  }

  let remoteId = null;

  if (isSupabaseConfigured()) {
    try {
      console.log('[db] Validando e enviando cadastro para o Supabase...');
      const { data: remoteExisting, error: errExist } = await supabase
        .from('Usuario')
        .select('id')
        .eq('email', cleanEmail)
        .limit(1);

      if (errExist) throw errExist;
      if (remoteExisting && remoteExisting.length > 0) {
        throw new Error('Este usuário/e-mail já está cadastrado no servidor.');
      }

      const tempGerenteId = gerenteId || null;
      
      const payload = {
        nome: nome.trim(),
        email: cleanEmail,
        senha: hashedPassword,
        cargo: cargo,
      };

      if (tempGerenteId) {
        payload.gerente_id = tempGerenteId;
      }

      const { data: newUser, error: errInsert } = await supabase
        .from('Usuario')
        .insert(payload)
        .select()
        .single();

      if (errInsert) throw errInsert;

      if (newUser) {
        remoteId = newUser.id;
        
        if (cargo === 'gerente' && !gerenteId) {
          const { error: errUpdate } = await supabase
            .from('Usuario')
            .update({ gerente_id: remoteId })
            .eq('id', remoteId);
          
          if (errUpdate) throw errUpdate;
        }
      }
    } catch (error) {
      console.error('[db] Erro ao cadastrar no Supabase:', error);
      throw new Error(error.message || 'Falha ao sincronizar cadastro com o servidor Supabase. Certifique-se de que está conectado à internet.');
    }
  } else {
    throw new Error('O sistema de nuvem Supabase não está configurado. Não é possível realizar novos cadastros.');
  }

  let result;
  const targetId = remoteId;
  
  if (cargo === 'gerente' && !gerenteId) {
    result = await db.runAsync(
      "INSERT OR REPLACE INTO Usuario (id, nome, email, senha, cargo, gerente_id) VALUES (?, ?, ?, ?, 'gerente', ?);",
      [targetId, nome.trim(), cleanEmail, hashedPassword, targetId]
    );
    
    await db.runAsync(
      'INSERT OR REPLACE INTO Configuracoes (percentual_cmv, percentual_opex, percentual_lucro, gerente_id) VALUES (?, ?, ?, ?);',
      [60.0, 20.0, 20.0, targetId]
    );

    await syncOrEnqueue('Configuracoes', 'upsert', {
      id: 1,
      percentual_cmv: 60.0,
      percentual_opex: 20.0,
      percentual_lucro: 20.0,
      gerente_id: targetId
    });
  } else {
    result = await db.runAsync(
      'INSERT OR REPLACE INTO Usuario (id, nome, email, senha, cargo, gerente_id) VALUES (?, ?, ?, ?, ?, ?);',
      [targetId, nome.trim(), cleanEmail, hashedPassword, cargo, gerenteId]
    );

    await syncOrEnqueue('Usuario', 'upsert', {
      id: targetId,
      nome: nome.trim(),
      email: cleanEmail,
      senha: hashedPassword,
      cargo: cargo,
      gerente_id: gerenteId
    });
  }

  return result;
}

// Exclui o acesso de um colaborador da equipe, bloqueando a exclusão do administrador principal
export async function deleteUser(id) {
  const db = await getDb();
  const userCheck = await db.getAllAsync('SELECT email FROM Usuario WHERE id = ?;', [id]);
  if (userCheck.length > 0 && userCheck[0].email === 'admin') {
    throw new Error('O usuário administrador principal não pode ser excluído.');
  }
  return await db.runAsync('DELETE FROM Usuario WHERE id = ?;', [id]);
}

// Retorna todos os produtos locais do comércio correspondentes ao gerente_id
export async function fetchProducts(gerenteId) {
  const db = await getDb();
  return await db.getAllAsync('SELECT * FROM Produto WHERE gerente_id = ? ORDER BY nome ASC;', [gerenteId]);
}

// Cria ou atualiza as informações de um produto localmente e na nuvem
export async function saveProduct(product, gerenteId) {
  const db = await getDb();
  let result;

  if (product.id) {
    result = await db.runAsync(
      'UPDATE Produto SET nome = ?, marca = ?, codigo_barras = ?, categoria = ?, preco_custo = ?, preco_venda = ?, estoque = ?, estoque_minimo = ? WHERE id = ? AND gerente_id = ?;',
      [
        product.nome,
        product.marca || null,
        product.codigo_barras || null,
        product.categoria || 'Outros',
        product.preco_custo,
        product.preco_venda,
        product.estoque,
        product.estoque_minimo,
        product.id,
        gerenteId
      ]
    );
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
      gerente_id: gerenteId
    });
  } else {
    result = await db.runAsync(
      'INSERT INTO Produto (nome, marca, codigo_barras, categoria, preco_custo, preco_venda, estoque, estoque_minimo, gerente_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);',
      [
        product.nome,
        product.marca || null,
        product.codigo_barras || null,
        product.categoria || 'Outros',
        product.preco_custo,
        product.preco_venda,
        product.estoque,
        product.estoque_minimo,
        gerenteId
      ]
    );
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
      gerente_id: gerenteId
    });
  }

  return result;
}

// Remove o produto selecionado localmente e na nuvem
export async function deleteProduct(id, gerenteId) {
  const db = await getDb();
  const result = await db.runAsync('DELETE FROM Produto WHERE id = ? AND gerente_id = ?;', [id, gerenteId]);
  await syncOrEnqueue('Produto', 'delete', { id, gerente_id: gerenteId });
  return result;
}

// Retorna as configurações ativas de CMV/OpEx/Lucro do gerente correspondente
export async function fetchSettings(gerenteId) {
  const db = await getDb();
  const configs = await db.getAllAsync('SELECT * FROM Configuracoes WHERE gerente_id = ? LIMIT 1;', [gerenteId]);
  if (configs.length > 0) {
    return configs[0];
  }
  await db.runAsync(
    'INSERT INTO Configuracoes (percentual_cmv, percentual_opex, percentual_lucro, gerente_id) VALUES (?, ?, ?, ?);',
    [60.0, 20.0, 20.0, gerenteId]
  );
  return { percentual_cmv: 60.0, percentual_opex: 20.0, percentual_lucro: 20.0, gerente_id: gerenteId };
}

// Altera as porcentagens do split global e sincroniza no Supabase
export async function saveSettings(cmv, opex, lucro, gerenteId) {
  const db = await getDb();
  
  const existing = await db.getAllAsync('SELECT id FROM Configuracoes WHERE gerente_id = ? LIMIT 1;', [gerenteId]);
  let result;
  
  if (existing.length > 0) {
    result = await db.runAsync(
      'UPDATE Configuracoes SET percentual_cmv = ?, percentual_opex = ?, percentual_lucro = ? WHERE gerente_id = ?;',
      [cmv, opex, lucro, gerenteId]
    );
  } else {
    result = await db.runAsync(
      'INSERT INTO Configuracoes (percentual_cmv, percentual_opex, percentual_lucro, gerente_id) VALUES (?, ?, ?, ?);',
      [cmv, opex, lucro, gerenteId]
    );
  }
  
  const configId = existing.length > 0 ? existing[0].id : result.lastInsertRowId;
  await syncOrEnqueue('Configuracoes', 'upsert', {
    id: configId,
    percentual_cmv: cmv,
    percentual_opex: opex,
    percentual_lucro: lucro,
    gerente_id: gerenteId
  });
  
  return result;
}

// Registra uma nova venda no banco local debitando estoque e enfileirando sync
export async function registerSale(cartItems, splitPercentages, gerenteId) {
  const db = await getDb();

  let vendaId;
  let vendaPayload;
  const itemPayloads = [];
  const produtoPayloads = [];

  await db.withTransactionAsync(async () => {
    let valorTotal = 0;
    for (const item of cartItems) {
      valorTotal += item.preco_venda * item.quantidade;
    }

    const { percentual_cmv, percentual_opex, percentual_lucro } = splitPercentages;
    const valorCmv = parseFloat((valorTotal * (percentual_cmv / 100)).toFixed(2));
    const valorOpex = parseFloat((valorTotal * (percentual_opex / 100)).toFixed(2));
    const valorLucro = parseFloat((valorTotal - valorCmv - valorOpex).toFixed(2));

    const now = new Date().toISOString();
    const saleResult = await db.runAsync(
      'INSERT INTO Venda (data_venda, valor_total, valor_cmv, valor_opex, valor_lucro, gerente_id) VALUES (?, ?, ?, ?, ?, ?);',
      [now, valorTotal, valorCmv, valorOpex, valorLucro, gerenteId]
    );
    vendaId = saleResult.lastInsertRowId;
    vendaPayload = {
      id: vendaId,
      data_venda: now,
      valor_total: valorTotal,
      valor_cmv: valorCmv,
      valor_opex: valorOpex,
      valor_lucro: valorLucro,
      gerente_id: gerenteId
    };

    for (const item of cartItems) {
      const productRow = await db.getAllAsync(
        'SELECT nome, marca, codigo_barras, categoria, preco_custo, preco_venda, estoque, estoque_minimo FROM Produto WHERE id = ? AND gerente_id = ?;',
        [item.id, gerenteId]
      );
      if (productRow.length === 0) {
        throw new Error(`Produto "${item.nome}" não encontrado neste comércio.`);
      }
      const prod = productRow[0];

      const newStock = prod.estoque - item.quantidade;

      if (newStock < 0) {
        throw new Error(`Estoque insuficiente para "${item.nome}". Disponível: ${prod.estoque}, Solicitado: ${item.quantidade}`);
      }

      await db.runAsync('UPDATE Produto SET estoque = ? WHERE id = ? AND gerente_id = ?;', [newStock, item.id, gerenteId]);

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
        gerente_id: gerenteId
      });

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
        gerente_id: gerenteId
      });
    }
  });

  await syncOrEnqueue('Venda', 'upsert', vendaPayload);
  for (const payload of produtoPayloads) {
    await syncOrEnqueue('Produto', 'upsert', payload);
  }
  for (const payload of itemPayloads) {
    await syncOrEnqueue('ItensVenda', 'upsert', payload);
  }

  return vendaId;
}

// Retorna a lista de todas as vendas do comércio localmente
export async function fetchSalesHistory(gerenteId) {
  const db = await getDb();
  return await db.getAllAsync('SELECT * FROM Venda WHERE gerente_id = ? ORDER BY datetime(data_venda) DESC;', [gerenteId]);
}

// Retorna indicadores numéricos e produtos críticos de estoque baixo para o Dashboard
export async function fetchDashboardStats(gerenteId) {
  const db = await getDb();
  
  const totals = await db.getAllAsync(`
    SELECT 
      SUM(valor_total) as faturamento_total,
      SUM(valor_cmv) as total_cmv,
      SUM(valor_opex) as total_opex,
      SUM(valor_lucro) as total_lucro
    FROM Venda
    WHERE gerente_id = ?;
  `, [gerenteId]);

  const lowStockProducts = await db.getAllAsync(`
    SELECT * FROM Produto 
    WHERE estoque <= estoque_minimo AND gerente_id = ?
    ORDER BY estoque ASC;
  `, [gerenteId]);

  const productCountResult = await db.getAllAsync('SELECT COUNT(*) as total FROM Produto WHERE gerente_id = ?;', [gerenteId]);

  const saleCountResult = await db.getAllAsync('SELECT COUNT(*) as total FROM Venda WHERE gerente_id = ?;', [gerenteId]);

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

// Retorna os itens de uma venda específica
export async function fetchSaleItems(vendaId) {
  const db = await getDb();
  return await db.getAllAsync(`
    SELECT iv.*, p.nome, p.marca 
    FROM ItensVenda iv 
    JOIN Produto p ON iv.produto_id = p.id 
    WHERE iv.venda_id = ?;
  `, [vendaId]);
}

// Retorna o fechamento detalhado do dia atual do Dashboard
export async function fetchDashboardDetails(gerenteId) {
  const db = await getDb();
  
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const startOfDayISO = startOfDay.toISOString();

  const vendasHojeResult = await db.getAllAsync(
    'SELECT SUM(valor_total) as total FROM Venda WHERE data_venda >= ? AND gerente_id = ?;',
    [startOfDayISO, gerenteId]
  );
  const vendasHoje = vendasHojeResult[0]?.total || 0;

  const transacoesHojeResult = await db.getAllAsync(
    'SELECT COUNT(*) as count FROM Venda WHERE data_venda >= ? AND gerente_id = ?;',
    [startOfDayISO, gerenteId]
  );
  const transacoesHoje = transacoesHojeResult[0]?.count || 0;

  const itensVendidosHojeResult = await db.getAllAsync(
    'SELECT SUM(iv.quantidade) as total_qty FROM ItensVenda iv JOIN Venda v ON iv.venda_id = v.id WHERE v.data_venda >= ? AND v.gerente_id = ?;',
    [startOfDayISO, gerenteId]
  );
  const itensVendidosHoje = itensVendidosHojeResult[0]?.total_qty || 0;

  const estoqueBaixoResult = await db.getAllAsync(
    'SELECT COUNT(*) as count FROM Produto WHERE estoque <= estoque_minimo AND gerente_id = ?;',
    [gerenteId]
  );
  const estoqueBaixoCount = estoqueBaixoResult[0]?.count || 0;

  const ultimasVendas = await db.getAllAsync(
    'SELECT * FROM Venda WHERE gerente_id = ? ORDER BY datetime(data_venda) DESC LIMIT 10;',
    [gerenteId]
  );

  const ultimasVendasFormatadas = [];
  for (const venda of ultimasVendas) {
    const itens = await db.getAllAsync(
      'SELECT iv.quantidade, p.nome, p.marca FROM ItensVenda iv JOIN Produto p ON iv.produto_id = p.id WHERE iv.venda_id = ?;',
      [venda.id]
    );

    let descricaoItens = '';
    let totalQtdItens = 0;
    
    if (itens.length > 0) {
      const nomes = itens.map(it => {
        const palavras = it.nome.split(' ');
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

// Retorna faturamento, split, itens vendidos e top produtos de uma determinada data localmente
export async function fetchDailyClosing(date, gerenteId) {
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
     WHERE data_venda >= ? AND data_venda < ? AND gerente_id = ?;`,
    [inicioISO, fimISO, gerenteId]
  );

  const itens = await db.getAllAsync(
    `SELECT COALESCE(SUM(iv.quantidade), 0) AS total_itens
       FROM ItensVenda iv JOIN Venda v ON iv.venda_id = v.id
      WHERE v.data_venda >= ? AND v.data_venda < ? AND v.gerente_id = ?;`,
    [inicioISO, fimISO, gerenteId]
  );

  const topProdutos = await db.getAllAsync(
    `SELECT p.nome AS nome,
            SUM(iv.quantidade) AS qtd,
            SUM(iv.quantidade * iv.preco_unitario) AS total
       FROM ItensVenda iv
       JOIN Venda v   ON iv.venda_id = v.id
       JOIN Produto p ON iv.produto_id = p.id
      WHERE v.data_venda >= ? AND v.data_venda < ? AND v.gerente_id = ? AND p.gerente_id = ?
      GROUP BY iv.produto_id
      ORDER BY qtd DESC
      LIMIT 5;`,
    [inicioISO, fimISO, gerenteId, gerenteId]
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

// Retorna dados formatados e agrupados para os gráficos e relatórios financeiros
export async function fetchReportData(days, gerenteId) {
  const db = await getDb();
  
  const now = new Date();
  const limitDate = new Date();
  limitDate.setDate(now.getDate() - days);
  const limitDateISO = limitDate.toISOString();

  const currentSales = await db.getAllAsync(
    'SELECT * FROM Venda WHERE data_venda >= ? AND gerente_id = ? ORDER BY datetime(data_venda) ASC;',
    [limitDateISO, gerenteId]
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

  const prevLimitDate = new Date();
  prevLimitDate.setDate(now.getDate() - (days * 2));
  const prevLimitDateISO = prevLimitDate.toISOString();

  const prevSalesResult = await db.getAllAsync(
    'SELECT SUM(valor_total) as total FROM Venda WHERE data_venda >= ? AND data_venda < ? AND gerente_id = ?;',
    [prevLimitDateISO, limitDateISO, gerenteId]
  );
  const prevReceita = prevSalesResult[0]?.total || 0;

  const stockValueResult = await db.getAllAsync(
    'SELECT SUM(estoque * preco_custo) as total_valor_estoque FROM Produto WHERE gerente_id = ?;',
    [gerenteId]
  );
  const valorEstoque = stockValueResult[0]?.total_valor_estoque || 0;

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
      'SELECT SUM(valor_total) as total, SUM(valor_cmv) as cmv, SUM(valor_opex) as opex FROM Venda WHERE data_venda >= ? AND data_venda <= ? AND gerente_id = ?;',
      [start.toISOString(), end.toISOString(), gerenteId]
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

// Sincroniza e migra o perfil do usuário logado local para o Supabase (para contas antigas criadas no SQLite)
export async function syncActiveUser(user, setUser) {
  if (!isSupabaseConfigured() || !user || user.email === 'admin') return;
  try {
    const { data, error } = await supabase
      .from('Usuario')
      .select('id')
      .eq('email', user.email.toLowerCase().trim())
      .limit(1);

    if (error) throw error;

    const db = await getDb();
    if (!data || data.length === 0) {
      console.log('[db] Sincronizando usuário ativo local para o Supabase...');
      const payload = {
        nome: user.nome,
        email: user.email.toLowerCase().trim(),
        senha: user.senha,
        cargo: user.cargo || 'gerente',
      };
      
      const { data: newUser, error: errInsert } = await supabase
        .from('Usuario')
        .insert(payload)
        .select()
        .single();

      if (errInsert) throw errInsert;

      if (newUser) {
        const newId = newUser.id;
        console.log(`[db] Usuário ativo cadastrado no Supabase com ID: ${newId}. Atualizando tabelas locais...`);
        
        await db.runAsync('UPDATE Usuario SET id = ?, gerente_id = ? WHERE id = ?;', [newId, newId, user.id]);
        await db.runAsync('UPDATE Produto SET gerente_id = ? WHERE gerente_id = ?;', [newId, user.gerente_id]);
        await db.runAsync('UPDATE Venda SET gerente_id = ? WHERE gerente_id = ?;', [newId, user.gerente_id]);
        await db.runAsync('UPDATE Configuracoes SET gerente_id = ? WHERE gerente_id = ?;', [newId, user.gerente_id]);

        setUser({
          ...user,
          id: newId,
          gerente_id: newId
        });
      }
    } else {
      const remoteId = data[0].id;
      if (user.id !== remoteId) {
        console.log(`[db] Alinhando ID local (${user.id}) com ID Supabase (${remoteId})...`);
        await db.runAsync('UPDATE Usuario SET id = ?, gerente_id = ? WHERE id = ?;', [remoteId, remoteId, user.id]);
        await db.runAsync('UPDATE Produto SET gerente_id = ? WHERE gerente_id = ?;', [remoteId, user.gerente_id]);
        await db.runAsync('UPDATE Venda SET gerente_id = ? WHERE gerente_id = ?;', [remoteId, user.gerente_id]);
        await db.runAsync('UPDATE Configuracoes SET gerente_id = ? WHERE gerente_id = ?;', [remoteId, user.gerente_id]);
        
        setUser({
          ...user,
          id: remoteId,
          gerente_id: remoteId
        });
      }
    }
  } catch (e) {
    console.error('[db] Erro ao sincronizar usuário ativo:', e);
  }
}
