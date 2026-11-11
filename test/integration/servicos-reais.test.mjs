// ============================================================================
// TESTES DE INTEGRAÇÃO DOS SERVICES REAIS (S06 + S07)
// Diferente de test/lucrocerto.test.mjs, aqui NADA é reimplementado: os testes
// chamam as funções de src/services/* e src/database/db.js sobre um SQLite em
// memória (adaptador do expo-sqlite em test/integration/stubs/dbInstance.mjs).
//
// Rodar: node --no-warnings --import ./test/integration/register.mjs --test test/integration/servicos-reais.test.mjs
// ============================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { __resetDb } from './stubs/dbInstance.mjs';
import { initializeDatabase } from '../../src/database/db.js';
import {
  abrirTurnoCaixa, bloquearTurnoCaixa, desbloquearTurnoCaixa, fecharTurnoCaixa,
  registrarSuprimentoSangria, obterTurnoPorId, auditarTurnoCaixa,
  obterComprovanteMovimentacao, gerarAssinaturaMovimentacao,
} from '../../src/services/cashService.js';
import {
  saveCliente, validateLimiteFiado, alterarBloqueioInadimplente, getClienteById,
  fetchExtratoCliente, registrarPagamentoDebitoCliente,
} from '../../src/services/clientService.js';
import {
  registrarEntradaMercadorias, sugerirSaidaLotesFIFO, fetchTriagemValidadeLotes,
} from '../../src/services/stockService.js';
import {
  finalizarVendaCompleta, cancelarVendaComAutorizacao, processarDevolucaoParcial,
} from '../../src/services/saleService.js';
import { hashPassword } from '../../src/utils/crypto.js';

const G = 1;            // gerente_id do estabelecimento seed
const GERENTE = 1;      // usuário admin (gerente, senha 123456)
const BALCAO = 3;       // usuário balconista seed
const FORNECEDOR = 1;

// Banco novo e inicializado pelo initializeDatabase() real do app
async function novoBanco() {
  const db = __resetDb();
  const erros = [];
  const orig = console.error;
  const origLog = console.log;
  console.error = (...a) => erros.push(a);
  console.log = () => {};
  try { await initializeDatabase(); } finally { console.error = orig; console.log = origLog; }
  assert.deepEqual(erros, [], 'initializeDatabase não deve registrar erros');
  return db;
}

const one = (db, sql, ...p) => db.raw.prepare(sql).get(...p);
const all = (db, sql, ...p) => db.raw.prepare(sql).all(...p);

function addDias(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().substring(0, 10);
}

function criarProduto(db, nome, { custo = 5, venda = 10, estoque = 0 } = {}) {
  const r = db.raw.prepare(
    `INSERT INTO Produto (nome, categoria, preco_custo, preco_venda, estoque, estoque_minimo, gerente_id)
     VALUES (?, 'Teste', ?, ?, ?, 0, ?);`
  ).run(nome, custo, venda, estoque, G);
  return Number(r.lastInsertRowid);
}

const vender = (itens, pagamentos, extra = {}) =>
  finalizarVendaCompleta({ carrinho: itens, pagamentos, usuarioId: BALCAO, ...extra }, G);

// ---------------------------------------------------------------------------
test('S06 · Abertura e Turnos de Caixa (services reais)', async () => {
  const db = await novoBanco();
  const leite = 1; // seed: R$ 4,50

  // Sem caixa: checkout bloqueado
  await assert.rejects(vender([{ id: leite, quantidade: 1 }], [{ forma_pagamento: 'dinheiro', valor: 4.5 }]), /Checkout bloqueado/);

  // Abertura com fundo de troco
  const turno = await abrirTurnoCaixa({ gerenteId: G, operadorId: BALCAO, fundoTrocoInicial: 100 });
  const t0 = await obterTurnoPorId(turno.id, G);
  assert.equal(t0.status, 'aberto');
  assert.equal(t0.fundo_troco_inicial, 100);
  assert.equal(t0.saldo_esperado_dinheiro, 100);
  assert.equal(t0.operador_id, BALCAO);
  assert.ok(one(db, "SELECT 1 AS ok FROM MovimentacaoCaixa WHERE turno_caixa_id = ? AND tipo_operacao = 'ABERTURA'", turno.id));

  // Não pode abrir dois turnos para o mesmo operador
  await assert.rejects(abrirTurnoCaixa({ gerenteId: G, operadorId: BALCAO, fundoTrocoInicial: 10 }), /já possui um turno/);

  // Bloqueado: checkout bloqueado
  await bloquearTurnoCaixa({ turnoId: turno.id, operadorId: BALCAO, motivo: 'Pausa para almoço', gerenteId: G });
  assert.equal((await obterTurnoPorId(turno.id, G)).status, 'bloqueado');
  await assert.rejects(vender([{ id: leite, quantidade: 1 }], [{ forma_pagamento: 'dinheiro', valor: 4.5 }]), /BLOQUEADO/);

  // Desbloqueado: venda passa e entra na gaveta
  await desbloquearTurnoCaixa({ turnoId: turno.id, operadorId: BALCAO, gerenteId: G });
  const v = await vender([{ id: leite, quantidade: 2 }], [{ forma_pagamento: 'dinheiro', valor: 9 }]);
  const venda = one(db, 'SELECT turno_caixa_id, usuario_id FROM Venda WHERE id = ?', v.vendaId);
  assert.equal(venda.turno_caixa_id, turno.id, 'venda vinculada ao turno');
  assert.equal(venda.usuario_id, BALCAO, 'venda vinculada ao operador');
  assert.equal((await obterTurnoPorId(turno.id, G)).saldo_esperado_dinheiro, 109);

  // Outro operador (gerente) sem caixa próprio continua bloqueado
  await assert.rejects(
    finalizarVendaCompleta({ carrinho: [{ id: leite, quantidade: 1 }], pagamentos: [{ forma_pagamento: 'dinheiro', valor: 4.5 }], usuarioId: GERENTE }, G),
    /Checkout bloqueado/
  );

  // Auditoria por operador
  const aud = await auditarTurnoCaixa(turno.id, G);
  assert.ok(aud, 'auditoria retorna dados');
  const tipos = all(db, 'SELECT tipo_operacao, operador_id FROM MovimentacaoCaixa WHERE turno_caixa_id = ? ORDER BY id', turno.id);
  assert.deepEqual(tipos.map((t) => t.tipo_operacao), ['ABERTURA', 'BLOQUEIO', 'DESBLOQUEIO', 'VENDA']);
  assert.ok(tipos.every((t) => t.operador_id === BALCAO));

  // Fechamento com conferência
  await fecharTurnoCaixa({ turnoId: turno.id, operadorId: BALCAO, saldoInformado: 105, gerenteId: G });
  const tf = await obterTurnoPorId(turno.id, G);
  assert.equal(tf.status, 'fechado');
  assert.equal(tf.diferenca_fechamento, -4, 'quebra de caixa de R$ 4,00');
  await assert.rejects(vender([{ id: leite, quantidade: 1 }], [{ forma_pagamento: 'dinheiro', valor: 4.5 }]), /Checkout bloqueado/);
});

// ---------------------------------------------------------------------------
test('S06 · Cadastro de Clientes & Limite (services reais)', async () => {
  await novoBanco();

  await assert.rejects(saveCliente({ nome: 'Doc Inválido', cpf_cnpj: '111.111.111-11' }, G), /Documento do cliente inválido/);
  await assert.rejects(saveCliente({ nome: 'Tel Inválido', telefone: '123' }, G), /[Tt]elefone/);
  await assert.rejects(saveCliente({ nome: '   ' }, G), /Nome do cliente é obrigatório/);

  const cli = await saveCliente({ nome: 'Maria Souza', cpf_cnpj: '52998224725', telefone: '11987654321', limite_fiado: 50 }, G);
  assert.equal(cli.cpf, '529.982.247-25', 'CPF formatado (coluna cpf no app)');
  assert.match(cli.telefone, /\(11\) ?9?8765-?4321/, 'telefone formatado');
  assert.equal(cli.limite_fiado, 50);

  const cnpj = await saveCliente({ nome: 'Padaria Ltda', cpf_cnpj: '11.222.333/0001-81' }, G);
  assert.equal(cnpj.cpf, '11.222.333/0001-81');

  // Teto de crédito
  const ok = await validateLimiteFiado(cli.id, 30, G);
  assert.equal(ok.disponivel, 50);
  await assert.rejects(validateLimiteFiado(cli.id, 50.01, G), /Teto de crédito excedido/);

  // Bloqueio preventivo de inadimplente
  await alterarBloqueioInadimplente({ clienteId: cli.id, gerenteId: G, bloquear: true, motivo: 'Atraso de 60 dias' });
  assert.equal((await getClienteById(cli.id, G)).bloqueado_inadimplente, 1);
  await assert.rejects(validateLimiteFiado(cli.id, 1, G), /bloqueio preventivo/);
  await alterarBloqueioInadimplente({ clienteId: cli.id, gerenteId: G, bloquear: false });
  await validateLimiteFiado(cli.id, 1, G);
});

// ---------------------------------------------------------------------------
test('S06 · Lotes & Validade com saída PEPS/FIFO (services reais)', async () => {
  const db = await novoBanco();
  const prod = criarProduto(db, 'Iogurte Teste', { custo: 2, venda: 5 });

  // Duas entradas: lote antigo vence depois, lote novo vence antes
  await registrarEntradaMercadorias({ fornecedorId: FORNECEDOR, numeroNota: 'NF-1', responsavelId: GERENTE,
    itens: [{ produtoId: prod, quantidade: 5, custoUnitario: 2, lote: 'L-ANTIGO', dataValidade: addDias(60) }] }, G);
  await registrarEntradaMercadorias({ fornecedorId: FORNECEDOR, numeroNota: 'NF-2', responsavelId: GERENTE,
    itens: [{ produtoId: prod, quantidade: 5, custoUnitario: 2, lote: 'L-NOVO', dataValidade: addDias(20) }] }, G);

  const lotes = all(db, 'SELECT numero_lote, data_validade, quantidade_saldo, entrada_id FROM LoteEstoque WHERE produto_id = ? ORDER BY id', prod);
  assert.equal(lotes.length, 2);
  assert.ok(lotes.every((l) => l.entrada_id), 'lote vinculado à entrada de mercadoria');
  assert.equal(lotes[1].data_validade, addDias(20));
  assert.equal(one(db, 'SELECT estoque FROM Produto WHERE id = ?', prod).estoque, 10);

  // Validade inválida é rejeitada
  await assert.rejects(registrarEntradaMercadorias({ fornecedorId: FORNECEDOR, numeroNota: 'NF-X',
    itens: [{ produtoId: prod, quantidade: 1, custoUnitario: 2, lote: 'X', dataValidade: '31/02/2027' }] }, G), /não existe no calendário/);

  // Sugestão de saída
  const sug = await sugerirSaidaLotesFIFO(prod, 7, G);
  assert.deepEqual(sug.sugestoes.map((s) => [s.numeroLote, s.quantidadeSugerida]), [['L-NOVO', 5], ['L-ANTIGO', 2]]);

  // Venda real baixa os lotes na ordem sugerida
  await abrirTurnoCaixa({ gerenteId: G, operadorId: BALCAO, fundoTrocoInicial: 0 });
  const v = await vender([{ id: prod, quantidade: 7 }], [{ forma_pagamento: 'dinheiro', valor: 35 }]);
  const pos = Object.fromEntries(all(db, 'SELECT numero_lote, quantidade_saldo, status FROM LoteEstoque WHERE produto_id = ?', prod)
    .map((l) => [l.numero_lote, [l.quantidade_saldo, l.status]]));
  assert.deepEqual(pos, { 'L-NOVO': [0, 'esgotado'], 'L-ANTIGO': [3, 'ativo'] });

  // Cancelamento devolve aos lotes de origem
  await cancelarVendaComAutorizacao({ vendaId: v.vendaId, gerenteId: G, usuarioId: GERENTE, senhaGerente: '123456', justificativa: 'Cliente desistiu da compra' });
  const pos2 = Object.fromEntries(all(db, 'SELECT numero_lote, quantidade_saldo FROM LoteEstoque WHERE produto_id = ?', prod)
    .map((l) => [l.numero_lote, l.quantidade_saldo]));
  assert.deepEqual(pos2, { 'L-NOVO': 5, 'L-ANTIGO': 5 });
  assert.equal(one(db, 'SELECT estoque FROM Produto WHERE id = ?', prod).estoque, 10);
});

// ---------------------------------------------------------------------------
test('S07 · Sangrias, Suprimentos & Estornos na gaveta (services reais)', async () => {
  const db = await novoBanco();
  const prod = criarProduto(db, 'Café Teste', { custo: 6, venda: 10, estoque: 50 });
  const turno = await abrirTurnoCaixa({ gerenteId: G, operadorId: BALCAO, fundoTrocoInicial: 50 });
  const saldo = async () => (await obterTurnoPorId(turno.id, G)).saldo_esperado_dinheiro;

  // Validações
  await assert.rejects(registrarSuprimentoSangria({ turnoId: turno.id, operadorId: BALCAO, tipo: 'SANGRIA', valor: 10, justificativa: '  ', gerenteId: G }), /Justificativa obrigatória/);
  await assert.rejects(registrarSuprimentoSangria({ turnoId: turno.id, operadorId: BALCAO, tipo: 'SANGRIA', valor: 0, justificativa: 'x', gerenteId: G }), /maior que zero/);
  await assert.rejects(registrarSuprimentoSangria({ turnoId: turno.id, operadorId: BALCAO, tipo: 'SANGRIA', valor: 1000, justificativa: 'Cofre', gerenteId: G }), /Sangria não permitida/);

  // Suprimento e sangria
  await registrarSuprimentoSangria({ turnoId: turno.id, operadorId: BALCAO, tipo: 'SUPRIMENTO', valor: 30, justificativa: 'Troco extra', gerenteId: G });
  assert.equal(await saldo(), 80);
  await registrarSuprimentoSangria({ turnoId: turno.id, operadorId: BALCAO, tipo: 'SANGRIA', valor: 20, justificativa: 'Envio ao cofre', gerenteId: G });
  assert.equal(await saldo(), 60);

  // Comprovante assinado: SHA-256 real e verificável
  assert.equal(hashPassword('abc'), createHash('sha256').update('abc').digest('hex'), 'hashPassword é SHA-256');
  const mov = one(db, "SELECT * FROM MovimentacaoCaixa WHERE tipo_operacao = 'SANGRIA'");
  const assin = gerarAssinaturaMovimentacao(mov);
  assert.equal(mov.assinatura_digital, createHash('sha256').update(assin.payloadCanonico).digest('hex'));
  assert.match(mov.comprovante_hash, /^LC-SAN-[0-9A-F]{12}$/);
  const comp = await obterComprovanteMovimentacao(mov.id, G);
  assert.equal(comp.valido, true);

  // Adulteração do valor invalida o comprovante
  db.raw.prepare('UPDATE MovimentacaoCaixa SET valor = 2 WHERE id = ?').run(mov.id);
  assert.equal((await obterComprovanteMovimentacao(mov.id, G)).valido, false, 'adulteração detectada');
  db.raw.prepare('UPDATE MovimentacaoCaixa SET valor = 20 WHERE id = ?').run(mov.id);

  // Venda em dinheiro + cancelamento: estorno deduzido da gaveta
  const v1 = await vender([{ id: prod, quantidade: 1 }], [{ forma_pagamento: 'dinheiro', valor: 10 }]);
  assert.equal(await saldo(), 70);
  await cancelarVendaComAutorizacao({ vendaId: v1.vendaId, gerenteId: G, usuarioId: GERENTE, senhaGerente: '123456', justificativa: 'Erro de digitação' });
  assert.equal(await saldo(), 60, 'cancelamento estornado da gaveta');
  assert.ok(one(db, "SELECT 1 AS ok FROM MovimentacaoCaixa WHERE tipo_operacao = 'ESTORNO' AND turno_caixa_id = ?", turno.id));

  // Senha gerencial errada não cancela nem mexe na gaveta
  const v2 = await vender([{ id: prod, quantidade: 4 }], [{ forma_pagamento: 'dinheiro', valor: 40 }]);
  assert.equal(await saldo(), 100);
  await assert.rejects(cancelarVendaComAutorizacao({ vendaId: v2.vendaId, gerenteId: G, usuarioId: GERENTE, senhaGerente: 'errada', justificativa: 'Tentativa indevida' }));
  assert.equal(await saldo(), 100);

  // Devolução parcial: estorno proporcional em dinheiro
  const item = one(db, 'SELECT id FROM ItensVenda WHERE venda_id = ?', v2.vendaId);
  await processarDevolucaoParcial({ vendaId: v2.vendaId, usuarioId: BALCAO, motivo: 'Produto com defeito',
    itensDevolver: [{ itemVendaId: item.id, quantidade: 1, aptoRetorno: true }] }, G);
  assert.equal(await saldo(), 90, 'devolução de 1 un. (R$ 10) deduzida da gaveta');

  // Fechamento bate com a gaveta
  await fecharTurnoCaixa({ turnoId: turno.id, operadorId: BALCAO, saldoInformado: 90, gerenteId: G });
  assert.equal((await obterTurnoPorId(turno.id, G)).diferenca_fechamento, 0);
});

// ---------------------------------------------------------------------------
test('S07 · Motor de Fiado & Caderneta Digital (services reais)', async () => {
  const db = await novoBanco();
  const prod = criarProduto(db, 'Pão Teste', { custo: 4, venda: 10, estoque: 100 });
  const turno = await abrirTurnoCaixa({ gerenteId: G, operadorId: BALCAO, fundoTrocoInicial: 0 });
  const cli = await saveCliente({ nome: 'João Fiado', cpf_cnpj: '52998224725', limite_fiado: 100 }, G);
  const saldoCli = async () => (await getClienteById(cli.id, G)).saldo_devedor;

  // Fiado no checkout abate o crédito
  const v1 = await vender([{ id: prod, quantidade: 3 }], [{ forma_pagamento: 'fiado', valor: 30 }], { clienteId: cli.id });
  assert.equal(await saldoCli(), 30);
  assert.equal((await validateLimiteFiado(cli.id, 1, G)).disponivel, 70);

  // Pagamento misto (dinheiro + fiado)
  await vender([{ id: prod, quantidade: 2 }], [{ forma_pagamento: 'dinheiro', valor: 5 }, { forma_pagamento: 'fiado', valor: 15 }], { clienteId: cli.id });
  assert.equal(await saldoCli(), 45);
  const t = await obterTurnoPorId(turno.id, G);
  assert.equal(t.saldo_esperado_dinheiro, 5, 'só o dinheiro entra na gaveta');

  // Estourar o limite: venda inteira rejeitada, nada persiste
  const vendasAntes = one(db, 'SELECT COUNT(*) AS n FROM Venda').n;
  const estoqueAntes = one(db, 'SELECT estoque FROM Produto WHERE id = ?', prod).estoque;
  await assert.rejects(vender([{ id: prod, quantidade: 6 }], [{ forma_pagamento: 'fiado', valor: 60 }], { clienteId: cli.id }), /Teto de crédito excedido/);
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM Venda').n, vendasAntes);
  assert.equal(one(db, 'SELECT estoque FROM Produto WHERE id = ?', prod).estoque, estoqueAntes);
  assert.equal(await saldoCli(), 45);

  // Fiado sem cliente é rejeitado
  await assert.rejects(vender([{ id: prod, quantidade: 1 }], [{ forma_pagamento: 'fiado', valor: 10 }]));

  // Cliente bloqueado não compra fiado
  await alterarBloqueioInadimplente({ clienteId: cli.id, gerenteId: G, bloquear: true, motivo: 'Inadimplente' });
  await assert.rejects(vender([{ id: prod, quantidade: 1 }], [{ forma_pagamento: 'fiado', valor: 10 }], { clienteId: cli.id }), /bloqueio preventivo/);
  await alterarBloqueioInadimplente({ clienteId: cli.id, gerenteId: G, bloquear: false });

  // Pagamento de débito em dinheiro: abate a caderneta e entra na gaveta
  await registrarPagamentoDebitoCliente({ clienteId: cli.id, valor: 20, operadorId: BALCAO, gerenteId: G });
  assert.equal(await saldoCli(), 25);
  assert.equal((await obterTurnoPorId(turno.id, G)).saldo_esperado_dinheiro, 25, 'R$ 5 da venda + R$ 20 recebidos');

  // Cancelamento de venda fiado já parcialmente paga: excedente vira crédito a favor
  await cancelarVendaComAutorizacao({ vendaId: v1.vendaId, gerenteId: G, usuarioId: GERENTE, senhaGerente: '123456', justificativa: 'Cancelamento teste' });
  assert.equal(await saldoCli(), -5, 'R$ 25 - R$ 30 = R$ 5 de crédito para o cliente');
  const extCredito = await fetchExtratoCliente(cli.id, G);
  assert.equal(extCredito.totais.saldoDevedorAtual, -5);
  assert.equal(extCredito.transacoes[0].saldoAcumuladoApos, -5, 'saldo acumulado do extrato bate com o cadastro');
  await assert.rejects(registrarPagamentoDebitoCliente({ clienteId: cli.id, valor: 5, operadorId: BALCAO, gerenteId: G }), /não possui saldo devedor/);

  // Próxima compra fiado consome o crédito
  await vender([{ id: prod, quantidade: 1 }], [{ forma_pagamento: 'fiado', valor: 10 }], { clienteId: cli.id });
  assert.equal(await saldoCli(), 5);

  // Pagamento acima da dívida é limitado ao saldo devedor
  const pag = await registrarPagamentoDebitoCliente({ clienteId: cli.id, valor: 1000, operadorId: BALCAO, gerenteId: G });
  assert.equal(pag.valorPago, 5);
  assert.equal(await saldoCli(), 0);

  // Extrato fecha: compras - estornos - pagamentos = saldo
  const ext = await fetchExtratoCliente(cli.id, G);
  assert.deepEqual(ext.transacoes.map((t) => t.tipo).sort(),
    ['CANCELAMENTO_ESTORNO', 'COMPRA_FIADO', 'COMPRA_FIADO', 'COMPRA_FIADO', 'PAGAMENTO_DEBITO', 'PAGAMENTO_DEBITO']);
  assert.equal(ext.totais.totalComprasFiado, 55);
  assert.equal(ext.totais.totalEstornos, 30);
  assert.equal(ext.totais.totalPagamentos, 25);
  assert.equal(ext.totais.saldoDevedorAtual, 0);
  assert.equal(ext.totais.totalComprasFiado - ext.totais.totalEstornos - ext.totais.totalPagamentos, ext.totais.saldoDevedorAtual);
  assert.equal(ext.totais.limiteDisponivel, 100);
});

// ---------------------------------------------------------------------------
test('S07 · Triagem de Vencimento Crítico e capital parado (services reais)', async () => {
  const db = await novoBanco();
  const prod = criarProduto(db, 'Queijo Teste', { custo: 10, venda: 20 });

  const casos = [
    ['VENC', -2, 1], ['HOJE', 0, 2], ['D7', 7, 3], ['D8', 8, 4], ['D15', 15, 5],
    ['D16', 16, 6], ['D30', 30, 7], ['D31', 31, 8],
  ];
  for (const [lote, dias, qtd] of casos) {
    await registrarEntradaMercadorias({ fornecedorId: FORNECEDOR, numeroNota: `NF-${lote}`, responsavelId: GERENTE,
      itens: [{ produtoId: prod, quantidade: qtd, custoUnitario: 10, lote, dataValidade: addDias(dias) }] }, G);
  }

  const tri = await fetchTriagemValidadeLotes(G);
  const nomes = (f) => tri.faixas[f].lotes.map((l) => l.numero_lote);
  assert.deepEqual(nomes('vencidos'), ['VENC']);
  assert.deepEqual(nomes('critico'), ['HOJE', 'D7']);
  assert.deepEqual(nomes('medio'), ['D8', 'D15']);
  assert.deepEqual(nomes('alerta'), ['D16', 'D30']);
  assert.deepEqual(nomes('seguro'), ['D31']);

  assert.equal(tri.faixas.vencidos.capitalParado, 10);
  assert.equal(tri.faixas.critico.capitalParado, 50);
  assert.equal(tri.faixas.medio.capitalParado, 90);
  assert.equal(tri.faixas.alerta.capitalParado, 130);
  assert.equal(tri.capitalTotalEmRisco, 280, 'seguro (D31) fora do capital em risco');
  assert.equal(tri.totalLotesEmRisco, 7);

  // A view SQL concorda com o service
  const view = Object.fromEntries(all(db, 'SELECT numero_lote, faixa_risco FROM vw_triagem_validade_lotes').map((r) => [r.numero_lote, r.faixa_risco]));
  assert.deepEqual(view, { VENC: 'VENCIDO', HOJE: 'RISCO_CRITICO', D7: 'RISCO_CRITICO', D8: 'RISCO_MEDIO', D15: 'RISCO_MEDIO', D16: 'ALERTA', D30: 'ALERTA', D31: 'SEGURO' });

  // Lote esgotado sai da triagem
  db.raw.prepare("UPDATE LoteEstoque SET quantidade_saldo = 0, status = 'esgotado' WHERE numero_lote = 'VENC'").run();
  const tri2 = await fetchTriagemValidadeLotes(G);
  assert.equal(tri2.faixas.vencidos.quantidadeLotes, 0);
  assert.equal(tri2.capitalTotalEmRisco, 270);
});

// ---------------------------------------------------------------------------
test('S07 · Recebimento de fiado em dinheiro entra na gaveta do caixa', async () => {
  const db = await novoBanco();
  const prod = criarProduto(db, 'Bolo Teste', { custo: 4, venda: 10, estoque: 10 });
  const cli = await saveCliente({ nome: 'Ana Fiado', limite_fiado: 100 }, G);

  const turno = await abrirTurnoCaixa({ gerenteId: G, operadorId: BALCAO, fundoTrocoInicial: 0 });
  await vender([{ id: prod, quantidade: 3 }], [{ forma_pagamento: 'fiado', valor: 30 }], { clienteId: cli.id });

  // Sem operador: rejeitado
  await assert.rejects(registrarPagamentoDebitoCliente({ clienteId: cli.id, valor: 5, gerenteId: G }), /Operador/);

  // Operador sem caixa aberto não recebe em dinheiro (nada é gravado)
  await assert.rejects(registrarPagamentoDebitoCliente({ clienteId: cli.id, valor: 5, formaPagamento: 'dinheiro', operadorId: GERENTE, gerenteId: G }), /abra/);
  assert.equal((await getClienteById(cli.id, G)).saldo_devedor, 30);
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM PagamentoDebitoCliente').n, 0);

  // ... mas pode receber em PIX, que não passa pela gaveta
  await registrarPagamentoDebitoCliente({ clienteId: cli.id, valor: 10, formaPagamento: 'pix', operadorId: GERENTE, gerenteId: G });
  assert.equal((await obterTurnoPorId(turno.id, G)).saldo_esperado_dinheiro, 0);

  // Dinheiro com caixa aberto
  const r = await registrarPagamentoDebitoCliente({ clienteId: cli.id, valor: 20, formaPagamento: 'dinheiro', operadorId: BALCAO, gerenteId: G });
  assert.equal(r.turnoCaixaId, turno.id);
  const t = await obterTurnoPorId(turno.id, G);
  assert.equal(t.saldo_esperado_dinheiro, 20);
  assert.equal(t.total_recebimentos_fiado, 20);
  assert.equal(t.total_vendas_dinheiro, 0, 'não conta como venda (a venda fiado já foi registrada)');

  const pags = all(db, 'SELECT operador_id, forma_pagamento FROM PagamentoDebitoCliente ORDER BY id');
  assert.deepEqual(pags.map((p) => [p.operador_id, p.forma_pagamento]), [[GERENTE, 'pix'], [BALCAO, 'dinheiro']], 'operador real registrado');

  // Comprovante assinado e auditoria do turno conforme
  const mov = one(db, "SELECT id FROM MovimentacaoCaixa WHERE tipo_operacao = 'RECEBIMENTO_FIADO'");
  assert.equal((await obterComprovanteMovimentacao(mov.id, G)).valido, true);
  const aud = await auditarTurnoCaixa(turno.id, G);
  assert.equal(aud.conforme, true, JSON.stringify(aud.divergencias));

  // Fechamento bate
  const fech = await fecharTurnoCaixa({ turnoId: turno.id, operadorId: BALCAO, saldoInformado: 20, gerenteId: G });
  assert.equal(fech.diferenca, 0);
});

// ---------------------------------------------------------------------------
test('Migração · banco da Semana 6 atualiza sem perder dados', async () => {
  const db = __resetDb();
  // Esquema de caixa como era antes da Semana 7 (sem comprovante e sem RECEBIMENTO_FIADO)
  db.raw.exec(`
    CREATE TABLE Usuario (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, email TEXT UNIQUE NOT NULL, senha TEXT NOT NULL, cargo TEXT NOT NULL DEFAULT 'gerente', gerente_id INTEGER);
    CREATE TABLE TurnoCaixa (
      id INTEGER PRIMARY KEY AUTOINCREMENT, gerente_id INTEGER NOT NULL, operador_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'aberto' CHECK(status IN ('aberto', 'bloqueado', 'fechado')),
      fundo_troco_inicial REAL NOT NULL DEFAULT 0.0, total_vendas_dinheiro REAL NOT NULL DEFAULT 0.0,
      total_vendas_outros REAL NOT NULL DEFAULT 0.0, total_suprimentos REAL NOT NULL DEFAULT 0.0,
      total_sangrias REAL NOT NULL DEFAULT 0.0, saldo_esperado_dinheiro REAL NOT NULL DEFAULT 0.0,
      saldo_fechamento_informado REAL, diferenca_fechamento REAL, motivo_bloqueio TEXT, observacoes TEXT,
      data_abertura TEXT NOT NULL DEFAULT (datetime('now')), data_bloqueio TEXT, data_fechamento TEXT,
      FOREIGN KEY (operador_id) REFERENCES Usuario(id)
    );
    CREATE TABLE MovimentacaoCaixa (
      id INTEGER PRIMARY KEY AUTOINCREMENT, turno_caixa_id INTEGER NOT NULL, gerente_id INTEGER NOT NULL, operador_id INTEGER NOT NULL,
      tipo_operacao TEXT NOT NULL CHECK(tipo_operacao IN ('ABERTURA', 'VENDA', 'SANGRIA', 'SUPRIMENTO', 'BLOQUEIO', 'DESBLOQUEIO', 'FECHAMENTO', 'ESTORNO')),
      forma_pagamento TEXT DEFAULT 'dinheiro', valor REAL NOT NULL, saldo_apos REAL NOT NULL, origem_referencia TEXT, justificativa TEXT,
      data_movimentacao TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (turno_caixa_id) REFERENCES TurnoCaixa(id) ON DELETE CASCADE, FOREIGN KEY (operador_id) REFERENCES Usuario(id)
    );
  `);
  db.raw.prepare("INSERT INTO Usuario (nome, email, senha, cargo, gerente_id) VALUES ('Administrador', 'admin', ?, 'gerente', 1)").run(hashPassword('123456'));
  db.raw.exec(`
    INSERT INTO TurnoCaixa (gerente_id, operador_id, status, fundo_troco_inicial, saldo_esperado_dinheiro) VALUES (1, 1, 'aberto', 70, 70);
    INSERT INTO MovimentacaoCaixa (turno_caixa_id, gerente_id, operador_id, tipo_operacao, valor, saldo_apos, justificativa) VALUES (1, 1, 1, 'ABERTURA', 70, 70, 'Abertura antiga');
  `);

  const erros = [];
  const orig = console.error, origLog = console.log;
  console.error = (...a) => erros.push(a.map(String).join(' '));
  console.log = () => {};
  try { await initializeDatabase(); } finally { console.error = orig; console.log = origLog; }
  assert.deepEqual(erros, [], 'inicialização sobre banco antigo sem erros');

  const cols = all(db, 'PRAGMA table_info(MovimentacaoCaixa)').map((c) => c.name);
  assert.ok(cols.includes('comprovante_hash') && cols.includes('assinatura_digital'));
  assert.ok(all(db, 'PRAGMA table_info(TurnoCaixa)').some((c) => c.name === 'total_recebimentos_fiado'));
  assert.ok(all(db, 'PRAGMA index_list(MovimentacaoCaixa)').some((i) => i.name === 'idx_mov_comprovante'));
  assert.equal(one(db, 'SELECT justificativa FROM MovimentacaoCaixa WHERE id = 1').justificativa, 'Abertura antiga', 'dados preservados');
  assert.deepEqual(all(db, 'PRAGMA foreign_key_check'), []);

  // O turno antigo continua operando, inclusive com o novo tipo
  await registrarSuprimentoSangria({ turnoId: 1, operadorId: 1, tipo: 'SANGRIA', valor: 20, justificativa: 'Cofre', gerenteId: G });
  const cli = await saveCliente({ nome: 'Cliente Antigo', limite_fiado: 50 }, G);
  db.raw.prepare('UPDATE Cliente SET saldo_devedor = 15 WHERE id = ?').run(cli.id);
  await registrarPagamentoDebitoCliente({ clienteId: cli.id, valor: 15, operadorId: 1, gerenteId: G });
  assert.equal((await obterTurnoPorId(1, G)).saldo_esperado_dinheiro, 65);
  assert.equal((await auditarTurnoCaixa(1, G)).conforme, true);
});
