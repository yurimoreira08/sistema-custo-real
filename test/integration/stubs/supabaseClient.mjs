// Supabase desligado nos testes: syncOrEnqueue retorna sem rede.
// Com SYNC_CAPTURE=<arquivo>, o "Supabase" fica ligado e cada operação enviada
// é gravada (uma linha JSON por chamada) para validar o schema.sql da nuvem.
import { appendFileSync } from 'node:fs';

const capture = process.env.SYNC_CAPTURE;
const gravar = (reg) => appendFileSync(capture, JSON.stringify(reg) + '\n');

function from(table) {
  return {
    upsert(payload, opts = {}) {
      gravar({ table, op: 'upsert', onConflict: opts.onConflict || null, payload });
      return Promise.resolve({ error: null });
    },
    delete() {
      const filtros = {};
      const q = {
        eq(col, val) { filtros[col] = val; return q; },
        then(res, rej) { gravar({ table, op: 'delete', filtros }); return Promise.resolve({ error: null }).then(res, rej); },
      };
      return q;
    },
  };
}

export const supabase = capture ? { from } : null;
export function isSupabaseConfigured() { return !!capture; }
