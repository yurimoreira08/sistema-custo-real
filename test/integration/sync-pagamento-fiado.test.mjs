// ============================================================================
// TESTE DE INTEGRAÇÃO — envio dos pagamentos de fiado (amortização) para a nuvem
//
// Liga o modo SYNC_CAPTURE dos stubs: o "Supabase" fica online e cada operação
// enviada é gravada num arquivo, permitindo conferir o que realmente sobe.
// O env precisa ser definido ANTES de carregar os stubs, por isso os imports são dinâmicos.
//
// Rodar: npm run test:integration
// ============================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const arquivoCaptura = join(mkdtempSync(join(tmpdir(), 'lucrocerto-sync-')), 'captura.jsonl');
process.env.SYNC_CAPTURE = arquivoCaptura;

const { __resetDb } = await import('./stubs/dbInstance.mjs');
const { initializeDatabase } = await import('../../src/database/db.js');
const { abrirTurnoCaixa } = await import('../../src/services/cashService.js');
const { saveCliente, registrarPagamentoDebitoCliente } = await import('../../src/services/clientService.js');
const { finalizarVendaCompleta } = await import('../../src/services/saleService.js');

const G = 1;      // gerente_id do estabelecimento seed
const BALCAO = 3; // usuário balconista seed

/** Lê as operações enviadas ao "Supabase" desde o início do teste. */
function enviados() {
  if (!existsSync(arquivoCaptura)) return [];
  return readFileSync(arquivoCaptura, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

test('Sync · pagamento de fiado (amortização) é enviado ao Supabase', async () => {
  const db = __resetDb();
  const orig = console.error, origLog = console.log;
  console.error = () => {};
  console.log = () => {};
  try { await initializeDatabase(); } finally { console.error = orig; console.log = origLog; }

  const prod = Number(db.raw.prepare(
    `INSERT INTO Produto (nome, categoria, preco_custo, preco_venda, estoque, estoque_minimo, gerente_id)
     VALUES ('Arroz Teste', 'Teste', 5, 10, 100, 0, ?);`
  ).run(G).lastInsertRowid);
  const cli = await saveCliente({ nome: 'Ana Lima', telefone: '86999887766', limite_fiado: 200 }, G);
  await abrirTurnoCaixa({ gerenteId: G, operadorId: BALCAO, fundoTrocoInicial: 0 });
  await finalizarVendaCompleta(
    { carrinho: [{ id: prod, quantidade: 10 }], pagamentos: [{ forma_pagamento: 'fiado', valor: 100 }], clienteId: cli.id, usuarioId: BALCAO },
    G
  );

  const antes = enviados().length;
  await registrarPagamentoDebitoCliente({ clienteId: cli.id, valor: 40, formaPagamento: 'pix', operadorId: BALCAO, gerenteId: G });
  await registrarPagamentoDebitoCliente({ clienteId: cli.id, valor: 25, formaPagamento: 'dinheiro', operadorId: BALCAO, gerenteId: G });
  const novos = enviados().slice(antes);

  const pagamentos = novos.filter((o) => o.table === 'PagamentoDebitoCliente');
  assert.equal(pagamentos.length, 2, 'cada amortização deve gerar um envio de PagamentoDebitoCliente');

  const locais = db.raw.prepare('SELECT * FROM PagamentoDebitoCliente WHERE cliente_id = ? ORDER BY id;').all(cli.id);
  pagamentos.forEach((env, i) => {
    assert.equal(env.op, 'upsert');
    assert.equal(env.onConflict, 'id,gerente_id');
    // O registro enviado é exatamente o gravado no aparelho (mesmo id, valores e saldos)
    assert.deepEqual(env.payload, { ...locais[i] });
  });
  assert.equal(pagamentos[0].payload.valor, 40);
  assert.equal(pagamentos[0].payload.saldo_anterior, 100);
  assert.equal(pagamentos[0].payload.saldo_resultante, 60);
  assert.equal(pagamentos[1].payload.forma_pagamento, 'dinheiro');
  assert.equal(pagamentos[1].payload.saldo_resultante, 35);

  // Chave estrangeira na nuvem: o Cliente atualizado precisa subir ANTES do pagamento
  const idxPag = novos.findIndex((o) => o.table === 'PagamentoDebitoCliente');
  const idxCli = novos.findIndex((o) => o.table === 'Cliente');
  assert.ok(idxCli >= 0 && idxCli < idxPag, 'Cliente deve ser enviado antes do pagamento');
});

test('Schema · PagamentoDebitoCliente aceita o upsert onConflict id,gerente_id', () => {
  const schema = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8');
  // Sem restrição única em (id, gerente_id) o Postgres rejeita o upsert do app
  const loop = schema.match(/FOREACH t IN ARRAY ARRAY\[([^\]]+)\] LOOP\s+IF NOT EXISTS \(SELECT 1 FROM pg_constraint WHERE conname = t \|\| '_id_gerente_key'\)/);
  assert.ok(loop, 'bloco de restrições únicas (id, gerente_id) não encontrado no schema.sql');
  assert.match(loop[1], /'PagamentoDebitoCliente'/);
  assert.match(schema, /"PagamentoDebitoCliente_id_gerente_key" UNIQUE \(id, gerente_id\)/);
});
