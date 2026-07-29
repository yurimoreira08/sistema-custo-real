import * as Network from 'expo-network';
import { supabase, isSupabaseConfigured } from './supabaseClient';
import { getDb } from './dbInstance';

// Inicializa a tabela sync_queue no SQLite local
export async function initSyncQueue() {
  const db = await getDb();
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS sync_queue (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT    NOT NULL,
      operation  TEXT    NOT NULL CHECK(operation IN ('upsert','delete')),
      payload    TEXT    NOT NULL,
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      retries    INTEGER NOT NULL DEFAULT 0
    );
  `);
}

// Insere uma nova tarefa de sincronização pendente na fila SQLite
export async function enqueueSyncOperation(tableName, operation, payload) {
  try {
    const db = await getDb();
    await db.runAsync(
      `INSERT INTO sync_queue (table_name, operation, payload, created_at)
       VALUES (?, ?, ?, datetime('now'));`,
      [tableName, operation, JSON.stringify(payload)]
    );
  } catch (err) {
    console.error('[SyncService] Erro ao enfileirar operação:', err);
  }
}

// Retorna a quantidade de operações pendentes na fila de sincronização
export async function getSyncQueueCount() {
  try {
    const db = await getDb();
    const rows = await db.getAllAsync('SELECT COUNT(*) AS c FROM sync_queue;');
    return rows[0]?.c ?? 0;
  } catch (e) {
    return 0;
  }
}

// Envia uma única operação de upsert ou delete para a tabela correspondente no Supabase
export async function syncToSupabase(tableName, operation, payload) {
  if (!isSupabaseConfigured()) return false;

  try {
    if (operation === 'upsert') {
      let conflictTarget = 'id,gerente_id';
      if (tableName === 'Usuario') {
        conflictTarget = 'email';
      }

      const { error } = await supabase
        .from(tableName)
        .upsert(payload, { onConflict: conflictTarget });

      if (error) throw error;
    } else if (operation === 'delete') {
      let query = supabase.from(tableName).delete().eq('id', payload.id);
      
      if (payload.gerente_id && tableName !== 'Usuario') {
        query = query.eq('gerente_id', payload.gerente_id);
      }

      const { error } = await query;
      if (error) throw error;
    }

    return true;
  } catch (err) {
    console.error(`[SyncService] Falha ao sincronizar ${operation} em ${tableName}:`, err.message);
    return false;
  }
}

const MAX_RETRIES = 5;
let isProcessingQueue = false;

// Drena a fila de sincronização executando as operações na nuvem uma por uma
export async function processSyncQueue() {
  if (!isSupabaseConfigured()) {
    console.log('[SyncService] Supabase não configurado — sync ignorado.');
    return;
  }

  if (isProcessingQueue) return;
  isProcessingQueue = true;

  try {
    const db = await getDb();

    const pending = await db.getAllAsync(
      `SELECT * FROM sync_queue ORDER BY id ASC LIMIT 50;`
    );

    if (pending.length === 0) return;

    console.log(`[SyncService] Processando ${pending.length} operação(ões) pendente(s)...`);

    for (const item of pending) {
      let payload;
      try {
        payload = JSON.parse(item.payload);
      } catch {
        await db.runAsync('DELETE FROM sync_queue WHERE id = ?;', [item.id]);
        continue;
      }

      const success = await syncToSupabase(item.table_name, item.operation, payload);

      if (success) {
        await db.runAsync('DELETE FROM sync_queue WHERE id = ?;', [item.id]);
        console.log(`[SyncService] ✓ ${item.operation} em ${item.table_name} (id: ${item.id}) sincronizado.`);
      } else {
        const newRetries = item.retries + 1;
        if (newRetries >= MAX_RETRIES) {
          await db.runAsync('DELETE FROM sync_queue WHERE id = ?;', [item.id]);
          console.warn(`[SyncService] ✗ Operação id=${item.id} descartada após ${MAX_RETRIES} tentativas.`);
        } else {
          await db.runAsync(
            'UPDATE sync_queue SET retries = ? WHERE id = ?;',
            [newRetries, item.id]
          );
        }
      }
    }
  } finally {
    isProcessingQueue = false;
  }
}

// Verifica conectividade de rede e dispara o dreno de sincronização pendente
export async function checkNetworkAndSync() {
  try {
    const networkState = await Network.getNetworkStateAsync();
    if (networkState.isConnected && networkState.isInternetReachable) {
      await processSyncQueue();
    } else {
      console.log('[SyncService] Sem rede — sync adiado.');
    }
  } catch (err) {
    console.error('[SyncService] Erro ao verificar rede:', err);
  }
}

// Tenta enviar a operação diretamente para o Supabase ou a enfileira em caso de falha/offline
export async function syncOrEnqueue(tableName, operation, payload) {
  if (!isSupabaseConfigured()) return;

  try {
    const networkState = await Network.getNetworkStateAsync();
    const isOnline = networkState.isConnected && networkState.isInternetReachable;

    if (isOnline) {
      const success = await syncToSupabase(tableName, operation, payload);
      if (!success) {
        await enqueueSyncOperation(tableName, operation, payload);
      }
    } else {
      await enqueueSyncOperation(tableName, operation, payload);
    }
  } catch (err) {
    console.error('[SyncService] Erro em syncOrEnqueue:', err);
    await enqueueSyncOperation(tableName, operation, payload);
  }
}
