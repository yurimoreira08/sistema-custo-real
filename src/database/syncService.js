/**
 * syncService.js
 *
 * Serviço de sincronização offline-first: SQLite → Supabase.
 *
 * ESTRATÉGIA:
 *  1. Toda operação de escrita no SQLite também tenta enviar ao Supabase.
 *  2. Se não há rede ou o Supabase falhar, a operação é salva na `sync_queue`
 *     (tabela local SQLite).
 *  3. `processSyncQueue()` re-tenta as operações pendentes sempre que
 *     o app volta a ter rede.
 *
 * OPERAÇÕES SUPORTADAS:
 *  - 'upsert' → INSERT ... ON CONFLICT DO UPDATE (idempotente)
 *  - 'delete' → DELETE WHERE id = ?
 */

import * as Network from 'expo-network';
import { supabase, isSupabaseConfigured } from './supabaseClient';
import { getDb } from './dbInstance';

// ─── Fila de Sincronização (SQLite local) ────────────────────────────────────

/**
 * Cria a tabela sync_queue no SQLite caso ainda não exista.
 * Deve ser chamada durante a inicialização do banco.
 */
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

/**
 * Adiciona uma operação à fila de sincronização.
 *
 * @param {string} tableName   - Nome da tabela no Supabase
 * @param {'upsert'|'delete'} operation
 * @param {object} payload     - Dados a sincronizar (objeto JS)
 */
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

/**
 * Conta operações pendentes na fila de sincronização.
 * Retorna 0 se a tabela ainda não existir (best-effort).
 */
export async function getSyncQueueCount() {
  try {
    const db = await getDb();
    const rows = await db.getAllAsync('SELECT COUNT(*) AS c FROM sync_queue;');
    return rows[0]?.c ?? 0;
  } catch (e) {
    return 0;
  }
}

// ─── Sincronização com Supabase ───────────────────────────────────────────────

/**
 * Sincroniza uma única operação diretamente com o Supabase.
 *
 * @param {string} tableName
 * @param {'upsert'|'delete'} operation
 * @param {object} payload
 * @returns {Promise<boolean>} true se bem-sucedido
 */
export async function syncToSupabase(tableName, operation, payload) {
  if (!isSupabaseConfigured()) return false;

  try {
    if (operation === 'upsert') {
      const { error } = await supabase
        .from(tableName)
        .upsert(payload, { onConflict: 'id' });

      if (error) throw error;
    } else if (operation === 'delete') {
      const { error } = await supabase
        .from(tableName)
        .delete()
        .eq('id', payload.id);

      if (error) throw error;
    }

    return true;
  } catch (err) {
    console.error(`[SyncService] Falha ao sincronizar ${operation} em ${tableName}:`, err.message);
    return false;
  }
}

// ─── Processamento da Fila ────────────────────────────────────────────────────

const MAX_RETRIES = 5;

// Evita que múltiplos gatilhos (poll, reconexão, foreground, escrita) processem
// a mesma fila em paralelo. upsert/delete já são idempotentes; a flag apenas
// impede trabalho duplicado e logs confusos.
let isProcessingQueue = false;

/**
 * Processa todas as operações pendentes na sync_queue.
 * Operações bem-sucedidas são removidas; operações com muitas falhas
 * são descartadas com aviso.
 */
export async function processSyncQueue() {
  if (!isSupabaseConfigured()) {
    console.log('[SyncService] Supabase não configurado — sync ignorado.');
    return;
  }

  if (isProcessingQueue) return; // já há um processamento em andamento
  isProcessingQueue = true;

  try {
    const db = await getDb();

    // Buscar operações pendentes ordenadas por criação (FIFO)
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
        // Payload corrompido — remover da fila
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
          // Desistir após MAX_RETRIES tentativas
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

// ─── Ponto de Entrada Principal ───────────────────────────────────────────────

/**
 * Verifica conectividade e dispara processamento da fila.
 * Chame este método no startup do app e após operações de escrita.
 */
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

/**
 * Tenta sincronizar imediatamente. Se falhar, enfileira para retry.
 *
 * @param {string} tableName
 * @param {'upsert'|'delete'} operation
 * @param {object} payload
 */
export async function syncOrEnqueue(tableName, operation, payload) {
  if (!isSupabaseConfigured()) return;

  try {
    const networkState = await Network.getNetworkStateAsync();
    const isOnline = networkState.isConnected && networkState.isInternetReachable;

    if (isOnline) {
      const success = await syncToSupabase(tableName, operation, payload);
      if (!success) {
        // Falha no Supabase mesmo com rede — enfileirar para retry
        await enqueueSyncOperation(tableName, operation, payload);
      }
    } else {
      // Offline — apenas enfileirar
      await enqueueSyncOperation(tableName, operation, payload);
    }
  } catch (err) {
    console.error('[SyncService] Erro em syncOrEnqueue:', err);
    await enqueueSyncOperation(tableName, operation, payload);
  }
}
