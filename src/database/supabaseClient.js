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

// Cliente global inicializado para comunicação com as tabelas do Supabase
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Verifica se a URL e a chave anônima do Supabase estão configuradas corretamente no projeto
export function isSupabaseConfigured() {
  return (
    !!supabaseUrl &&
    !supabaseUrl.includes('SEU_PROJECT_ID') &&
    !!supabaseAnonKey &&
    !supabaseAnonKey.includes('SUA_ANON_KEY')
  );
}
