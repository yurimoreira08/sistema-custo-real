/**
 * supabaseClient.js
 *
 * Inicializa e exporta o cliente Supabase para uso no app.
 * Usa AsyncStorage para persistência de sessão entre reinicializações.
 *
 * IMPORTANTE: Preencha as credenciais no arquivo app.json:
 *   "extra": {
 *     "supabaseUrl": "https://SEU_PROJECT_ID.supabase.co",
 *     "supabaseAnonKey": "SUA_ANON_KEY_AQUI"
 *   }
 */

import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

const supabaseUrl = Constants.expoConfig?.extra?.supabaseUrl ?? '';
const supabaseAnonKey = Constants.expoConfig?.extra?.supabaseAnonKey ?? '';

if (!supabaseUrl || supabaseUrl.includes('SEU_PROJECT_ID')) {
  console.warn(
    '[Supabase] ⚠️  Credenciais não configuradas. ' +
    'Preencha supabaseUrl e supabaseAnonKey no app.json > extra.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

/** Verifica se o cliente está configurado com credenciais reais */
export function isSupabaseConfigured() {
  return (
    !!supabaseUrl &&
    !supabaseUrl.includes('SEU_PROJECT_ID') &&
    !!supabaseAnonKey &&
    !supabaseAnonKey.includes('SUA_ANON_KEY')
  );
}
