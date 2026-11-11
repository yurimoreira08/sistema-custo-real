// Supabase desligado nos testes: syncOrEnqueue retorna sem rede
export const supabase = null;
export function isSupabaseConfigured() { return false; }
