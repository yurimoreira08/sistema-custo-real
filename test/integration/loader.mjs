// Loader de módulos para rodar os services reais do app (src/) no Node.
// - Resolve imports relativos sem extensão (padrão do Metro/Expo) para .js
// - Troca módulos nativos do Expo/Supabase por stubs de teste
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const stubsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'stubs');
const stub = (name) => ({ url: pathToFileURL(path.join(stubsDir, name)).href, shortCircuit: true, format: 'module' });

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'expo-network') return stub('expo-network.mjs');
  if (/\/database\/dbInstance(\.js)?$/.test(specifier) || /^\.\/dbInstance(\.js)?$/.test(specifier)) return stub('dbInstance.mjs');
  if (/supabaseClient(\.js)?$/.test(specifier)) return stub('supabaseClient.mjs');

  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !path.extname(specifier) && context.parentURL) {
    const base = fileURLToPath(new URL(specifier, context.parentURL));
    for (const cand of [base + '.js', path.join(base, 'index.js')]) {
      if (existsSync(cand)) return { url: pathToFileURL(cand).href, shortCircuit: true, format: 'module' };
    }
  }
  return nextResolve(specifier, context);
}
