// ========================================================
// IDs GLOBAIS POR APARELHO (multi-dispositivo sem colisão)
//
// Problema: cada celular gerava IDs 1, 2, 3... (AUTOINCREMENT) e, ao sincronizar, a
// "Venda #5" de um aparelho sobrescrevia a "Venda #5" do outro na nuvem.
//
// Solução: cada aparelho sorteia um número próprio (1..2^20−1) e passa a gerar IDs
// dentro da sua faixa exclusiva:  id = numeroDispositivo × 2^32 + sequencial.
// O maior ID possível (~4,5 × 10^15) cabe no BIGINT do Postgres e no Number do JS
// (limite seguro 9 × 10^15). Chance de dois aparelhos sortearem o mesmo número:
// ~1 em 1 milhão por par de aparelhos.
//
// O app não precisa mudar seus INSERTs: este módulo envolve a conexão do expo-sqlite e,
// em `runAsync`, acrescenta a coluna `id` aos INSERTs das tabelas replicadas que não a
// informam. Registros com ID explícito (ex.: vindos da nuvem) passam intactos.
// ========================================================

export const FAIXA_IDS = 2 ** 32;
export const MAX_DISPOSITIVO = 2 ** 20 - 1;

/** Tabelas cujos novos registros recebem ID global (Usuario recebe o ID do Supabase). */
export const TABELAS_ID_GLOBAL = new Set([
  'Configuracoes', 'Fornecedor', 'Cliente', 'Produto', 'FormaPagamentoConfig', 'TurnoCaixa',
  'Venda', 'ItensVenda', 'PagamentoVenda', 'CancelamentoVenda', 'DevolucaoVenda', 'ItensDevolucao',
  'EntradaMercadoria', 'ItensEntrada', 'LoteEstoque', 'MovimentacaoEstoque', 'PerdaEstoque',
  'BaixaLote', 'MovimentacaoCaixa', 'PagamentoDebitoCliente', 'AjusteSaldo',
]);

const DDL_DISPOSITIVO = `CREATE TABLE IF NOT EXISTS DispositivoLocal (chave TEXT PRIMARY KEY, valor TEXT);`;

/**
 * Lê (ou sorteia e grava, na primeira execução) o número deste aparelho.
 * Também grava `base_ids`, usado pelos triggers SQL que geram IDs (ver replicacao.js).
 */
export async function obterNumeroDispositivo(rawDb, sortear = () => 1 + Math.floor(Math.random() * MAX_DISPOSITIVO)) {
  await rawDb.execAsync(DDL_DISPOSITIVO);
  const rows = await rawDb.getAllAsync("SELECT valor FROM DispositivoLocal WHERE chave = 'numero_dispositivo';");
  if (rows.length > 0) return Number(rows[0].valor);

  const numero = sortear();
  await rawDb.runAsync("INSERT INTO DispositivoLocal (chave, valor) VALUES ('numero_dispositivo', ?);", [String(numero)]);
  await rawDb.runAsync("INSERT OR REPLACE INTO DispositivoLocal (chave, valor) VALUES ('base_ids', ?);", [String(numero * FAIXA_IDS)]);
  return numero;
}

/**
 * Localiza o fechamento do parêntese que abre em `inicio` (respeitando aspas e parênteses
 * aninhados como datetime('now')). Retorna o índice do ')' correspondente ou -1.
 */
function fimDoParentese(sql, inicio) {
  let nivel = 0;
  let aspas = null;
  for (let i = inicio; i < sql.length; i++) {
    const ch = sql[i];
    if (aspas) {
      if (ch === aspas) aspas = null;
      continue;
    }
    if (ch === "'" || ch === '"') aspas = ch;
    else if (ch === '(') nivel++;
    else if (ch === ')') {
      nivel--;
      if (nivel === 0) return i;
    }
  }
  return -1;
}

const RE_INSERT = /^\s*INSERT\s+(?:OR\s+(?:REPLACE|IGNORE)\s+)?INTO\s+"?(\w+)"?\s*\(/i;

/**
 * Se `sql` for um INSERT de uma única linha (com VALUES) numa tabela replicada e sem a
 * coluna `id`, devolve o SQL reescrito com `id` como primeira coluna/valor.
 * @returns {{ tabela: string, sql: string } | null}
 */
export function reescreverInsertComId(sql) {
  const m = RE_INSERT.exec(sql);
  if (!m || !TABELAS_ID_GLOBAL.has(m[1])) return null;

  const abreCols = m[0].length - 1;
  const fechaCols = fimDoParentese(sql, abreCols);
  if (fechaCols < 0) return null;
  const colunas = sql.substring(abreCols + 1, fechaCols).split(',').map((c) => c.trim().replace(/"/g, '').toLowerCase());
  if (colunas.includes('id')) return null;

  const resto = sql.substring(fechaCols + 1);
  const mValues = /^\s*VALUES\s*\(/i.exec(resto);
  if (!mValues) return null; // INSERT ... SELECT: não suportado (usado só em migrações)

  const abreVals = fechaCols + 1 + mValues[0].length - 1;
  const fechaVals = fimDoParentese(sql, abreVals);
  if (fechaVals < 0) return null;
  if (!/^\s*;?\s*$/.test(sql.substring(fechaVals + 1))) return null; // várias linhas ou cláusulas extras

  const novo =
    sql.substring(0, abreCols + 1) + 'id, ' + sql.substring(abreCols + 1, abreVals + 1) + '?, ' + sql.substring(abreVals + 1);
  return { tabela: m[1], sql: novo };
}

/** Normaliza os parâmetros variádicos do expo-sqlite para um array posicional (ou null se nomeados). */
function paramsPosicionais(args) {
  if (args.length === 0) return [];
  if (args.length === 1 && Array.isArray(args[0])) return args[0];
  if (args.length === 1 && args[0] && typeof args[0] === 'object') return null; // parâmetros nomeados
  return args;
}

/**
 * Envolve uma conexão expo-sqlite (ou o adaptador de testes) com a geração de IDs globais.
 * Use `executarComIdsLocais(fn)` para gravar com o AUTOINCREMENT original (dados seed,
 * que precisam ter os mesmos IDs pequenos em todos os aparelhos).
 */
export async function envolverComIdsGlobais(rawDb, opcoes = {}) {
  const numero = await obterNumeroDispositivo(rawDb, opcoes.sortearNumero);
  const base = numero * FAIXA_IDS;
  const ultimoEmitido = new Map(); // evita IDs repetidos entre awaits concorrentes
  let modoLocal = 0;

  async function proximoId(tabela) {
    const rows = await rawDb.getAllAsync(`SELECT MAX(id) AS m FROM ${tabela} WHERE id >= ? AND id < ?;`, [base, base + FAIXA_IDS]);
    const doBanco = rows[0]?.m != null ? Number(rows[0].m) : base;
    const proximo = Math.max(doBanco, ultimoEmitido.get(tabela) || base) + 1;
    if (proximo >= base + FAIXA_IDS) throw new Error(`Faixa de IDs do aparelho esgotada na tabela ${tabela}.`);
    ultimoEmitido.set(tabela, proximo);
    return proximo;
  }

  const extras = {
    numeroDispositivo: numero,
    baseIds: base,
    conexaoOriginal: rawDb,

    async runAsync(sql, ...args) {
      if (modoLocal === 0) {
        const reescrito = reescreverInsertComId(sql);
        const params = paramsPosicionais(args);
        if (reescrito && params) {
          const id = await proximoId(reescrito.tabela);
          return rawDb.runAsync(reescrito.sql, [id, ...params]);
        }
      }
      return rawDb.runAsync(sql, ...args);
    },

    async executarComIdsLocais(fn) {
      modoLocal++;
      try {
        return await fn();
      } finally {
        modoLocal--;
      }
    },
  };

  // Proxy: sobrescreve só o necessário; o resto continua chamando a conexão original
  // com `this` correto (métodos nativos do expo-sqlite dependem disso).
  return new Proxy(rawDb, {
    get(alvo, prop) {
      if (Object.prototype.hasOwnProperty.call(extras, prop)) return extras[prop];
      const valor = alvo[prop];
      return typeof valor === 'function' ? valor.bind(alvo) : valor;
    },
  });
}
