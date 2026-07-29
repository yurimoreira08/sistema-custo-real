import * as SQLite from 'expo-sqlite';

let dbPromise = null;

// Inicializa e retorna a instância singleton de conexão com o banco de dados SQLite local
export function getDb() {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync('mercado_manager.db').catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}
