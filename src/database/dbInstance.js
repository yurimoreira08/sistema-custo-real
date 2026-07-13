/**
 * dbInstance.js
 *
 * Módulo isolado que gerencia a instância singleton do banco SQLite.
 * Extraído de db.js para evitar dependência circular com syncService.js.
 *
 * Importado por: db.js e syncService.js
 */

import * as SQLite from 'expo-sqlite';

let dbInstance = null;

/**
 * Retorna (ou inicializa) a instância do banco de dados de forma assíncrona.
 * Garante que apenas uma conexão é aberta durante o ciclo de vida do app.
 */
export async function getDb() {
  if (!dbInstance) {
    dbInstance = await SQLite.openDatabaseAsync('mercado_manager.db');
  }
  return dbInstance;
}
