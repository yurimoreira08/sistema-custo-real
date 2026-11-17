// ============================================================================
// TESTES DE INTEGRAÇÃO — SEMANA 8 (services reais sobre SQLite em memória)
//  1. Fechamento Cego & Quebra de Caixa
//  2. Amortização & Cobrança WhatsApp
//  3. Painel de Alertas & Notificações (liquidação antecipada antes do vencimento)
//
// Rodar: npm run test:integration
// ============================================================================
import test from 'node:test';
import assert from 'node:assert/strict';

import { __resetDb } from './stubs/dbInstance.mjs';
import { initializeDatabase } from '../../src/database/db.js';
import {
  abrirTurnoCaixa, fecharTurnoCaixa, obterTurnoPorId, registrarSuprimentoSangria,
  gerarRelatorioFechamento, formatarRelatorioFechamentoTexto, obterComprovanteMovimentacao,
} from '../../src/services/cashService.js';
import {
  saveCliente, validateLimiteFiado, registrarPagamentoDebitoCliente, getClienteById,
  gerarCobrancaWhatsApp, fetchFilaCobrancaWhatsApp, alterarBloqueioInadimplente,
} from '../../src/services/clientService.js';
import { registrarEntradaMercadorias } from '../../src/services/stockService.js';
import { finalizarVendaCompleta } from '../../src/services/saleService.js';
import { fetchPainelAlertas, sugerirPrecoLiquidacao } from '../../src/services/alertService.js';
import { calcularTotalContagem, classificarDiferencaCaixa } from '../../src/utils/fechamentoCaixa.js';
import { normalizarTelefoneWhatsApp, gerarLinkWhatsApp } from '../../src/utils/cobrancaWhatsApp.js';

const G = 1;          // gerente_id do estabelecimento seed
const GERENTE = 1;    // usuário admin (gerente)
const BALCAO = 3;     // usuário balconista seed
const FORNECEDOR = 1;

async function novoBanco() {
  const db = __resetDb();
  const orig = console.error, origLog = console.log;
  console.error = () => {};
  console.log = () => {};
  try { await initializeDatabase(); } finally { console.error = orig; console.log = origLog; }
  return db;
}

const one = (db, sql, ...p) => db.raw.prepare(sql).get(...p);

function addDias(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().substring(0, 10);
}

function criarProduto(db, nome, { custo = 5, venda = 10, estoque = 0, minimo = 0 } = {}) {
  const r = db.raw.prepare(
    `INSERT INTO Produto (nome, categoria, preco_custo, preco_venda, estoque, estoque_minimo, gerente_id)
     VALUES (?, 'Teste', ?, ?, ?, ?, ?);`
  ).run(nome, custo, venda, estoque, minimo, G);
  return Number(r.lastInsertRowid);
}

const vender = (itens, pagamentos, extra = {}) =>
  finalizarVendaCompleta({ carrinho: itens, pagamentos, usuarioId: BALCAO, ...extra }, G);

// ---------------------------------------------------------------------------
test('S08 · Utilitários de contagem cega e tipificação da diferença', () => {
  const c = calcularTotalContagem({ '100': 1, '5': 1, '2': 2, '0.25': 3, '0,05': 1 });
  assert.equal(c.total, 109.8);
  assert.equal(c.totalCedulas, 109);
  assert.equal(c.totalMoedas, 0.8);
  assert.deepEqual(c.itens.map((i) => i.valor), [100, 5, 2, 0.25, 0.05], 'ordenado da maior para a menor');

  assert.throws(() => calcularTotalContagem({ '3': 1 }), /Denominação desconhecida/);
  assert.throws(() => calcularTotalContagem({ '10': 1.5 }), /Quantidade inválida/);
  assert.throws(() => calcularTotalContagem({ '10': -1 }), /Quantidade inválida/);

  const g = (d) => classificarDiferencaCaixa(d).gravidade;
  assert.equal(g(0), 'EXATO');
  assert.equal(g(-1), 'DENTRO_TOLERANCIA');
  assert.equal(g(1.01), 'LEVE');
  assert.equal(g(-19.99), 'LEVE');
  assert.equal(g(-20), 'GRAVE');
  assert.equal(classificarDiferencaCaixa(-5).tipo, 'FALTA');
  assert.equal(classificarDiferencaCaixa(-5).situacao, 'QUEBRA_DE_CAIXA');
  assert.equal(classificarDiferencaCaixa(3).tipo, 'SOBRA');
  assert.equal(classificarDiferencaCaixa(25).exigeJustificativa, true);
  assert.equal(classificarDiferencaCaixa(-5, { toleranciaAceitavel: 5 }).gravidade, 'DENTRO_TOLERANCIA', 'tolerância configurável');
});

// ---------------------------------------------------------------------------
test('S08 · Fechamento Cego & Quebra de Caixa (services reais)', async () => {
  const db = await novoBanco();
  const prod = criarProduto(db, 'Arroz Teste', { custo: 6, venda: 10, estoque: 100 });

  // Turno: fundo 100 + venda 30 dinheiro + venda 20 pix − sangria 10 = 120 esperado em dinheiro
  const turno = await abrirTurnoCaixa({ gerenteId: G, operadorId: BALCAO, fundoTrocoInicial: 100 });
  await vender([{ id: prod, quantidade: 3 }], [{ forma_pagamento: 'dinheiro', valor: 30 }]);
  await vender([{ id: prod, quantidade: 2 }], [{ forma_pagamento: 'pix', valor: 20 }]);
  // Justificativa com caractere fora do Latin-1 ("—") gera comprovante válido
  const sang = await registrarSuprimentoSangria({ turnoId: turno.id, operadorId: BALCAO, tipo: 'SANGRIA', valor: 10, justificativa: 'Cofre — às 14h', gerenteId: G });
  assert.equal((await obterComprovanteMovimentacao(sang.comprovante.id, G)).valido, true);
  assert.equal((await obterTurnoPorId(turno.id, G)).saldo_esperado_dinheiro, 120);

  // Falta GRAVE (R$ 25) sem justificativa: bloqueia e não grava nada
  await assert.rejects(
    fecharTurnoCaixa({ turnoId: turno.id, operadorId: BALCAO, contagemCedulas: { '50': 1, '20': 2, '5': 1 }, gerenteId: G }),
    /Falta de R\$ 25\.00 acima do limite/
  );
  assert.equal((await obterTurnoPorId(turno.id, G)).status, 'aberto');

  // Total digitado divergente da contagem é rejeitado
  await assert.rejects(
    fecharTurnoCaixa({ turnoId: turno.id, operadorId: BALCAO, contagemCedulas: { '100': 1 }, saldoInformado: 120, gerenteId: G }),
    /não confere com a contagem/
  );

  // Fechamento cego com justificativa: falta de R$ 25 tipificada como GRAVE
  const res = await fecharTurnoCaixa({
    turnoId: turno.id, operadorId: BALCAO, gerenteId: G,
    contagemCedulas: { '50': 1, '20': 2, '5': 1 },
    justificativaDiferenca: 'Troco devolvido a maior para cliente',
  });
  assert.equal(res.saldoEsperado, 120);
  assert.equal(res.saldoInformado, 95);
  assert.equal(res.diferenca, -25);
  assert.equal(res.tipo, 'FALTA');
  assert.equal(res.gravidade, 'GRAVE');
  assert.equal(res.situacao, 'QUEBRA_DE_CAIXA');

  const t = await obterTurnoPorId(turno.id, G);
  assert.equal(t.status, 'fechado');
  assert.equal(t.tipo_diferenca, 'FALTA');
  assert.equal(t.classificacao_diferenca, 'GRAVE');
  assert.equal(t.justificativa_diferenca, 'Troco devolvido a maior para cliente');
  assert.equal(JSON.parse(t.contagem_cega_json).length, 3);

  // Movimentação de FECHAMENTO assinada e válida
  const mov = one(db, "SELECT id FROM MovimentacaoCaixa WHERE tipo_operacao = 'FECHAMENTO' AND turno_caixa_id = ?", turno.id);
  assert.equal((await obterComprovanteMovimentacao(mov.id, G)).valido, true);

  // Relatório detalhado de encerramento
  const rel = res.relatorio;
  assert.deepEqual(rel.composicaoSaldo, {
    fundoTrocoInicial: 100, vendasDinheiro: 30, suprimentos: 0, recebimentosFiado: 0, sangrias: 10, estornos: 0, saldoEsperado: 120,
  });
  assert.equal(rel.vendas.quantidade, 2);
  assert.equal(rel.vendas.total, 50);
  assert.deepEqual(rel.vendas.porFormaPagamento.map((f) => [f.forma, f.total]), [['dinheiro', 30], ['pix', 20]]);
  assert.equal(rel.conferencia.saldoContado, 95);
  assert.equal(rel.conferencia.gravidade, 'GRAVE');
  assert.equal(rel.conferencia.contagemPorCedula[0].rotulo, 'R$ 50');
  assert.equal(rel.auditoria.conforme, true, 'quebra de caixa não é divergência de auditoria: ' + JSON.stringify(rel.auditoria.divergencias));
  assert.deepEqual(await gerarRelatorioFechamento(turno.id, G), { ...rel, duracaoMinutos: rel.duracaoMinutos });

  const texto = formatarRelatorioFechamentoTexto(rel);
  assert.match(texto, /CONFERÊNCIA CEGA/);
  assert.match(texto, /R\$ 20 × 2 = R\$ 40,00/);
  assert.match(texto, /Justificativa: Troco devolvido/);

  await assert.rejects(fecharTurnoCaixa({ turnoId: turno.id, operadorId: BALCAO, saldoInformado: 1, gerenteId: G }), /já foi fechado/);

  // Novo turno: sobra leve sem justificativa é aceita
  const t2 = await abrirTurnoCaixa({ gerenteId: G, operadorId: BALCAO, fundoTrocoInicial: 50 });
  const r2 = await fecharTurnoCaixa({ turnoId: t2.id, operadorId: BALCAO, saldoInformado: 53.5, gerenteId: G });
  assert.equal(r2.tipo, 'SOBRA');
  assert.equal(r2.gravidade, 'LEVE');
  assert.equal(r2.diferenca, 3.5);
  assert.equal(r2.relatorio.conferencia.contagemDetalhada, false);
});

// ---------------------------------------------------------------------------
test('S08 · Amortização com recomposição instantânea do limite e cobrança WhatsApp', async () => {
  const db = await novoBanco();
  const prod = criarProduto(db, 'Feijão Teste', { custo: 5, venda: 10, estoque: 100 });
  const cli = await saveCliente({ nome: 'Maria Souza', telefone: '(86) 99988-7766', limite_fiado: 100 }, G);
  const turno = await abrirTurnoCaixa({ gerenteId: G, operadorId: BALCAO, fundoTrocoInicial: 0 });

  await vender([{ id: prod, quantidade: 8 }], [{ forma_pagamento: 'fiado', valor: 80 }], { clienteId: cli.id });
  await assert.rejects(validateLimiteFiado(cli.id, 30, G), /Teto de crédito excedido/);

  // Pagamento PARCIAL: limite recomposto na hora
  const p1 = await registrarPagamentoDebitoCliente({ clienteId: cli.id, valor: 50, formaPagamento: 'pix', operadorId: BALCAO, gerenteId: G });
  assert.equal(p1.valorPago, 50);
  assert.equal(p1.saldoRestante, 30);
  assert.equal(p1.quitado, false);
  assert.equal(p1.limiteDisponivelAnterior, 20);
  assert.equal(p1.limiteDisponivel, 70);
  assert.equal(p1.limiteRecomposto, 50);
  assert.equal(p1.troco, 0);
  assert.ok(p1.linkReciboWhatsApp.startsWith('https://wa.me/5586999887766?text='));
  const recibo = decodeURIComponent(p1.linkReciboWhatsApp.split('text=')[1]);
  assert.match(recibo, /Recebemos seu pagamento de R\$ 50,00/);
  assert.match(recibo, /Limite disponível para novas compras: R\$ 70,00/);

  // O crédito liberado já vale na próxima venda fiado
  assert.equal((await validateLimiteFiado(cli.id, 70, G)).disponivel, 70);
  await vender([{ id: prod, quantidade: 6 }], [{ forma_pagamento: 'fiado', valor: 60 }], { clienteId: cli.id });
  assert.equal((await getClienteById(cli.id, G)).saldo_devedor, 90);

  // Cobrança ativa via WhatsApp
  const cob = await gerarCobrancaWhatsApp(cli.id, G, { nomeLoja: 'Mercadinho Teste' });
  assert.equal(cob.saldoDevedor, 90);
  assert.equal(cob.telefoneValido, true);
  assert.equal(cob.diasEmAberto, 0);
  assert.match(cob.mensagem, /Olá, Maria!/);
  assert.match(cob.mensagem, /Aqui é da Mercadinho Teste/);
  assert.match(cob.mensagem, /R\$ 90,00/);
  assert.equal(cob.link, `https://wa.me/5586999887766?text=${encodeURIComponent(cob.mensagem)}`);

  // Pagamento em dinheiro acima da dívida: quita, devolve troco e entra na gaveta só o devido
  const p2 = await registrarPagamentoDebitoCliente({ clienteId: cli.id, valor: 100, formaPagamento: 'dinheiro', operadorId: BALCAO, gerenteId: G });
  assert.equal(p2.valorPago, 90);
  assert.equal(p2.troco, 10);
  assert.equal(p2.quitado, true);
  assert.equal(p2.limiteDisponivel, 100);
  assert.equal((await obterTurnoPorId(turno.id, G)).saldo_esperado_dinheiro, 90);
  await assert.rejects(gerarCobrancaWhatsApp(cli.id, G), /não possui saldo devedor/);

  // Fila de cobrança: bloqueados/teto atingido primeiro; telefone inválido sem link
  const semFone = await saveCliente({ nome: 'José Sem Fone', limite_fiado: 0 }, G);
  const bloq = await saveCliente({ nome: 'Carlos Bloqueado', telefone: '86988776655', limite_fiado: 200 }, G);
  db.raw.prepare('UPDATE Cliente SET saldo_devedor = 300 WHERE id = ?').run(semFone.id);
  db.raw.prepare('UPDATE Cliente SET saldo_devedor = 40 WHERE id = ?').run(bloq.id);
  await alterarBloqueioInadimplente({ clienteId: bloq.id, gerenteId: G, bloquear: true, motivo: 'Atraso' });

  const fila = await fetchFilaCobrancaWhatsApp(G);
  assert.deepEqual(fila.map((f) => f.nome), ['Carlos Bloqueado', 'José Sem Fone']);
  assert.equal(fila[1].telefoneValido, false);
  assert.equal(fila[1].link, null);
  assert.match(fila[1].mensagem, /Aqui é do seu mercado de confiança/);

  // Normalização de telefone para wa.me
  assert.equal(normalizarTelefoneWhatsApp('5586999887766'), '5586999887766');
  assert.equal(normalizarTelefoneWhatsApp('(86) 3232-1234'), '558632321234');
  assert.equal(normalizarTelefoneWhatsApp('123'), null);
  assert.equal(gerarLinkWhatsApp('', 'oi'), null);
});

// ---------------------------------------------------------------------------
test('S08 · Painel de Alertas: liquidação antecipada antes do vencimento', async () => {
  const db = await novoBanco();
  db.raw.exec('UPDATE Produto SET estoque_minimo = 0;'); // isola dos produtos seed com estoque baixo
  const queijo = criarProduto(db, 'Queijo Teste', { custo: 10, venda: 20 });
  const iogurte = criarProduto(db, 'Iogurte Teste', { custo: 9, venda: 10 });
  criarProduto(db, 'Sabão Teste', { estoque: 1, minimo: 5 });
  criarProduto(db, 'Óleo Teste', { estoque: 0, minimo: 2 });

  const entrada = (prod, lote, dias, qtd, custo) => registrarEntradaMercadorias({
    fornecedorId: FORNECEDOR, numeroNota: `NF-${lote}`, responsavelId: GERENTE,
    itens: [{ produtoId: prod, quantidade: qtd, custoUnitario: custo, lote, dataValidade: addDias(dias) }],
  }, G);
  await entrada(queijo, 'Q-VENC', -1, 2, 10);
  await entrada(queijo, 'Q-D3', 3, 5, 10);
  await entrada(queijo, 'Q-D10', 10, 4, 10);
  await entrada(queijo, 'Q-D20', 20, 3, 10);
  await entrada(queijo, 'Q-D40', 40, 9, 10);
  await entrada(iogurte, 'I-D2', 2, 10, 9);

  // Cliente com teto de fiado atingido
  const cli = await saveCliente({ nome: 'Pedro Teto', limite_fiado: 50 }, G);
  db.raw.prepare('UPDATE Cliente SET saldo_devedor = 50 WHERE id = ?').run(cli.id);

  const painel = await fetchPainelAlertas(G);
  const porId = Object.fromEntries(painel.alertas.map((a) => [a.id, a]));
  const loteId = (n) => one(db, 'SELECT id FROM LoteEstoque WHERE numero_lote = ?', n).id;

  // Preço sugerido por faixa (30% / 20% / 10%) sobre R$ 20
  assert.equal(porId[`lote-liquidar-${loteId('Q-D3')}`].sugestao.precoSugerido, 14);
  assert.equal(porId[`lote-liquidar-${loteId('Q-D3')}`].severidade, 'critica');
  assert.equal(porId[`lote-liquidar-${loteId('Q-D10')}`].sugestao.precoSugerido, 16);
  assert.equal(porId[`lote-liquidar-${loteId('Q-D10')}`].severidade, 'alta');
  assert.equal(porId[`lote-liquidar-${loteId('Q-D20')}`].sugestao.precoSugerido, 18);
  assert.equal(porId[`lote-liquidar-${loteId('Q-D20')}`].severidade, 'media');
  assert.equal(porId[`lote-liquidar-${loteId('Q-D40')}`], undefined, 'lote seguro não gera alerta');

  // Desconto nunca leva o preço abaixo do custo
  const iog = porId[`lote-liquidar-${loteId('I-D2')}`].sugestao;
  assert.equal(iog.precoSugerido, 9);
  assert.equal(iog.travadoNoCusto, true);
  assert.equal(iog.descontoEfetivo, 10);

  // Vencido: retirar da venda e registrar perda
  const venc = porId[`lote-vencido-${loteId('Q-VENC')}`];
  assert.equal(venc.acao, 'REGISTRAR_PERDA');
  assert.equal(venc.valor, 20);

  // Estoque e fiado
  assert.equal(painel.alertas.find((a) => a.titulo === 'Óleo Teste sem estoque').severidade, 'alta');
  assert.equal(painel.alertas.find((a) => a.titulo === 'Sabão Teste com estoque baixo').severidade, 'media');
  assert.equal(porId[`fiado-${cli.id}`].acao, 'COBRAR_WHATSAPP');

  // Ordenação e contadores do badge
  assert.equal(painel.alertas[0].severidade, 'critica');
  assert.deepEqual(painel.contadores, { critica: 3, alta: 2, media: 3, info: 0, total: 8 });
  assert.equal(painel.badgeCount, 5);
  assert.equal(painel.liquidacao.lotesParaLiquidar, 4);
  assert.equal(painel.liquidacao.lotesVencidos, 1);
  assert.equal(painel.liquidacao.receitaPotencial, 14 * 5 + 16 * 4 + 18 * 3 + 9 * 10);

  // Sem lote em risco nem pendências: painel vazio
  await novoBanco();
  const vazio = await fetchPainelAlertas(G);
  assert.equal(vazio.badgeCount, 0);
  assert.equal(vazio.alertas.filter((a) => a.categoria === 'validade').length, 0);

  assert.equal(sugerirPrecoLiquidacao({ precoVenda: 10, custoUnitario: 5, quantidade: 1, faixaCodigo: 'SEGURO' }), null);
});

// ---------------------------------------------------------------------------
test('Build · detecção de rede tolerante e sincronização ao entrar no app', async () => {
  const { estaOnline } = await import('../../src/database/syncService.js');
  const { sincronizarDadosDaNuvem } = await import('../../src/database/db.js');

  // isInternetReachable null (indeterminado no Android) não pode bloquear o sync
  assert.equal(estaOnline({ isConnected: true, isInternetReachable: null }), true);
  assert.equal(estaOnline({ isConnected: true, isInternetReachable: true }), true);
  assert.equal(estaOnline({ isConnected: true, isInternetReachable: false }), false);
  assert.equal(estaOnline({ isConnected: false, isInternetReachable: null }), false);
  assert.equal(estaOnline(null), false);

  // Sem Supabase configurado: não tenta baixar nada
  await novoBanco();
  assert.deepEqual(await sincronizarDadosDaNuvem(G), { puxou: false, motivo: 'nao_configurado' });
});
