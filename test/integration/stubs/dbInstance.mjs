// Adaptador da API assíncrona do expo-sqlite (openDatabaseAsync) sobre node:sqlite em memória
import { DatabaseSync } from 'node:sqlite';

function normParams(args) {
  const p = args.length === 1 && (Array.isArray(args[0]) || (args[0] && typeof args[0] === 'object')) ? args[0] : args;
  if (Array.isArray(p)) return p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
  return p;
}

class ExpoSqliteAdapter {
  constructor() { this.raw = new DatabaseSync(':memory:'); }
  async execAsync(sql) { this.raw.exec(sql); }
  async runAsync(sql, ...args) {
    const r = this.raw.prepare(sql).run(...[].concat(normParams(args)));
    return { lastInsertRowId: Number(r.lastInsertRowid), changes: Number(r.changes) };
  }
  async getAllAsync(sql, ...args) { return this.raw.prepare(sql).all(...[].concat(normParams(args))); }
  async getFirstAsync(sql, ...args) { return this.raw.prepare(sql).get(...[].concat(normParams(args))) ?? null; }
  async withTransactionAsync(fn) {
    this.raw.exec('BEGIN;');
    try { await fn(); this.raw.exec('COMMIT;'); }
    catch (e) { try { this.raw.exec('ROLLBACK;'); } catch {} throw e; }
  }
}

let current = new ExpoSqliteAdapter();
export function getDb() { return Promise.resolve(current); }
export function __resetDb() { current = new ExpoSqliteAdapter(); return current; }
