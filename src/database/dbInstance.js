/**
 * dbInstance.js
 *
 * Módulo isolado que gerencia a instância singleton do banco SQLite.
 * Extraído de db.js para evitar dependência circular com syncService.js.
 *
 * Importado por: db.js e syncService.js
 */

import * as SQLite from 'expo-sqlite';

// Memoiza a PROMISE de abertura (não a instância já resolvida). Assim, chamadas
// concorrentes no início do app compartilham uma única abertura, evitando abrir
// o mesmo arquivo duas vezes (o que deixava o handle nativo nulo → NPE em prepareAsync).
let dbPromise = null;

/**
 * Retorna (ou inicializa) a instância do banco de dados de forma assíncrona.
 * Garante que apenas uma conexão é aberta durante o ciclo de vida do app,
 * mesmo sob chamadas concorrentes.
 */
export function getDb() {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync('mercado_manager.db').catch((err) => {
      dbPromise = null; // permite nova tentativa se a abertura falhar
      throw err;
    });
  }
  return dbPromise;
}
