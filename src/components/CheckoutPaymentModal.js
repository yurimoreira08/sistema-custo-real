import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Modal,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fetchClientes } from '../services/clientService';
import { fetchFormasPagamento, calcularTaxaPagamento } from '../services/paymentService';
import PaymentTaxConfigModal from './PaymentTaxConfigModal';
import ClientsModal from './ClientsModal';

export default function CheckoutPaymentModal({
  visible,
  totalVenda,
  gerenteId,
  onConfirmSale,
  onClose,
  loading = false
}) {
  const [formasConfig, setFormasConfig] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [selectedClienteId, setSelectedClienteId] = useState(null);
  const [canalVenda, setCanalVenda] = useState('balcao');
  const [descontoGlobal, setDescontoGlobal] = useState('0');
  const [showTaxConfigModal, setShowTaxConfigModal] = useState(false);
  const [showClientsModal, setShowClientsModal] = useState(false);

  // Lista de pagamentos adicionados: [{ forma_pagamento, operadora, valor, taxa_percentual, taxa_fixa, valor_taxa, valor_liquido }]
  const [pagamentos, setPagamentos] = useState([]);

  // Form para adicionar nova parcela
  const [selectedForma, setSelectedForma] = useState('dinheiro');
  const [valorParcela, setValorParcela] = useState('');
  const [selectedOperadora, setSelectedOperadora] = useState('Padrao');
  const [erroMsg, setErroMsg] = useState('');

  useEffect(() => {
    if (visible && gerenteId) {
      loadInitialData();
    }
  }, [visible, gerenteId, totalVenda]);

  const loadInitialData = async () => {
    setErroMsg('');
    try {
      const [formas, cliList] = await Promise.all([
        fetchFormasPagamento(gerenteId),
        fetchClientes(gerenteId)
      ]);
      setFormasConfig(formas);
      setClientes(cliList);

      const subtotalInicial = parseFloat(totalVenda) || 0;
      setPagamentos([
        {
          forma_pagamento: 'dinheiro',
          operadora: 'Padrao',
          valor: subtotalInicial,
          taxa_percentual: 0,
          taxa_fixa: 0,
          valor_taxa: 0,
          valor_liquido: subtotalInicial
        }
      ]);
      setDescontoGlobal('0');
      setSelectedClienteId(null);
      setCanalVenda('balcao');
    } catch (e) {
      console.error('Erro ao carregar dados do checkout:', e);
    }
  };

  const formatCurrency = (val) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(val || 0);
  };

  const descNum = Math.max(0, parseFloat((descontoGlobal || '0').replace(',', '.')) || 0);
  const valorTotalComDesconto = Math.max(0, parseFloat((totalVenda - descNum).toFixed(2)));

  const totalPago = parseFloat(
    pagamentos.reduce((acc, p) => acc + (parseFloat(p.valor) || 0), 0).toFixed(2)
  );

  const saldoRestante = parseFloat((valorTotalComDesconto - totalPago).toFixed(2));
  const totalTaxas = parseFloat(
    pagamentos.reduce((acc, p) => acc + (parseFloat(p.valor_taxa) || 0), 0).toFixed(2)
  );
  const totalLiquido = parseFloat((valorTotalComDesconto - totalTaxas).toFixed(2));

  const temFiado = pagamentos.some(p => p.forma_pagamento === 'fiado');

  const handleAddPagamento = () => {
    setErroMsg('');
    const val = parseFloat((valorParcela || '').replace(',', '.'));
    if (isNaN(val) || val <= 0) {
      setErroMsg('Informe um valor de pagamento válido.');
      return;
    }

    if (selectedForma === 'fiado') {
      if (!selectedClienteId) {
        setErroMsg('Selecione um cliente para autorizar o pagamento em Fiado.');
        return;
      }
      const cli = clientes.find(c => c.id === selectedClienteId);
      if (cli) {
        if (cli.bloqueado_inadimplente === 1) {
          setErroMsg(`Venda bloqueada: O cliente "${cli.nome}" está com bloqueio preventivo de crédito (${cli.motivo_bloqueio || 'Inadimplência registrada'}).`);
          return;
        }
        const saldoAtual = Number(cli.saldo_devedor) || 0;
        const limite = Number(cli.limite_fiado) || 0;
        if (limite > 0 && (saldoAtual + val) > (limite + 0.001)) {
          setErroMsg(`Teto de crédito excedido para "${cli.nome}". Limite: R$ ${limite.toFixed(2)}, Saldo: R$ ${saldoAtual.toFixed(2)}, Tentativa: R$ ${val.toFixed(2)}.`);
          return;
        }
      }
    }

    const cfg = formasConfig.find(
      f => f.codigo === selectedForma && f.operadora === selectedOperadora
    ) || formasConfig.find(f => f.codigo === selectedForma) || {
      taxa_percentual: 0,
      taxa_fixa: 0
    };

    const calc = calcularTaxaPagamento(val, cfg.taxa_percentual, cfg.taxa_fixa);

    setPagamentos([
      ...pagamentos,
      {
        forma_pagamento: selectedForma,
        operadora: selectedOperadora,
        valor: calc.valorBruto,
        taxa_percentual: calc.taxaPercentual,
        taxa_fixa: calc.taxaFixa,
        valor_taxa: calc.valorTaxa,
        valor_liquido: calc.valorLiquido
      }
    ]);

    setValorParcela('');
  };

  const handleSelectForma = (formaCodigo) => {
    setSelectedForma(formaCodigo);

    if (pagamentos.length <= 1) {
      const valorBase = valorTotalComDesconto > 0 ? valorTotalComDesconto : (parseFloat(totalVenda) || 0);
      const cfg = formasConfig.find(
        f => f.codigo === formaCodigo && f.operadora === selectedOperadora
      ) || formasConfig.find(f => f.codigo === formaCodigo) || {
        taxa_percentual: 0,
        taxa_fixa: 0
      };

      const calc = calcularTaxaPagamento(valorBase, cfg.taxa_percentual, cfg.taxa_fixa);

      setPagamentos([
        {
          forma_pagamento: formaCodigo,
          operadora: selectedOperadora,
          valor: calc.valorBruto,
          taxa_percentual: calc.taxaPercentual,
          taxa_fixa: calc.taxaFixa,
          valor_taxa: calc.valorTaxa,
          valor_liquido: calc.valorLiquido
        }
      ]);
    }
  };

  const handleRemovePagamento = (index) => {
    const updated = [...pagamentos];
    updated.splice(index, 1);
    setPagamentos(updated);
  };

  const handleFinalize = () => {
    setErroMsg('');

    if (Math.abs(saldoRestante) > 0.01) {
      setErroMsg(
        `O total pago (${formatCurrency(totalPago)}) diverge do total da venda (${formatCurrency(valorTotalComDesconto)}). Saldo restante: ${formatCurrency(saldoRestante)}.`
      );
      return;
    }

    if (temFiado && !selectedClienteId) {
      setErroMsg('Selecione um cliente para autorizar o pagamento em Fiado.');
      return;
    }

    onConfirmSale({
      pagamentos,
      clienteId: selectedClienteId,
      descontoGlobal: descNum,
      canalVenda,
      totalVenda: valorTotalComDesconto,
      totalTaxas,
      totalLiquido
    });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.card}>
          {/* Header padrão LucroCerto */}
          <View style={styles.header}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="card" size={20} color="#FFF" />
              <Text style={styles.headerTitle}>Checkout & Pagamentos</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color="#FFF" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
            {/* Resumo superior do valor */}
            <View style={styles.totalBox}>
              <View style={styles.totalBoxRow}>
                <Text style={styles.totalBoxLabel}>Subtotal da Venda:</Text>
                <Text style={styles.totalBoxValue}>{formatCurrency(totalVenda)}</Text>
              </View>

              {/* Desconto */}
              <View style={styles.descontoRow}>
                <Text style={styles.descontoLabel}>Desconto (R$):</Text>
                <TextInput
                  style={styles.descontoInput}
                  placeholder="0,00"
                  placeholderTextColor="#A0AEC0"
                  keyboardType="numeric"
                  value={descontoGlobal}
                  onChangeText={setDescontoGlobal}
                />
              </View>

              <View style={styles.divider} />

              <View style={styles.totalBoxRow}>
                <Text style={styles.totalFinalLabel}>Total a Pagar:</Text>
                <Text style={styles.totalFinalValue}>{formatCurrency(valorTotalComDesconto)}</Text>
              </View>
            </View>

            {/* Canal de Venda */}
            <Text style={styles.sectionLabel}>Canal de Venda</Text>
            <View style={styles.canalRow}>
              {['balcao', 'delivery', 'encomenda'].map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[styles.canalBtn, canalVenda === c && styles.canalBtnActive]}
                  onPress={() => setCanalVenda(c)}
                >
                  <Text
                    style={[
                      styles.canalBtnText,
                      canalVenda === c && styles.canalBtnTextActive
                    ]}
                  >
                    {c === 'balcao' ? '🏪 Balcão' : c === 'delivery' ? '🛵 Delivery' : '📦 Encomenda'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Seleção de Cliente */}
            <View style={styles.clientSection}>
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginBottom: 4 }}>
                <TouchableOpacity onPress={() => setShowClientsModal(true)} style={styles.adjustTaxesBtn}>
                  <Ionicons name="people-outline" size={13} color="#1E63EC" />
                  <Text style={styles.adjustTaxesBtnText}>Cadastrar / Limites</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.sectionLabel}>
                Cliente {temFiado ? '(Obrigatório para Fiado *)' : '(Opcional)'}
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                <TouchableOpacity
                  style={[styles.clientChip, !selectedClienteId && styles.clientChipActive]}
                  onPress={() => setSelectedClienteId(null)}
                >
                  <Text style={[styles.clientChipText, !selectedClienteId && styles.clientChipTextActive]}>
                    Consumidor Geral
                  </Text>
                </TouchableOpacity>
                {clientes.map(cli => {
                  const isSel = selectedClienteId === cli.id;
                  return (
                    <TouchableOpacity
                      key={cli.id}
                      style={[styles.clientChip, isSel && styles.clientChipActive]}
                      onPress={() => setSelectedClienteId(cli.id)}
                    >
                      <Text style={[styles.clientChipText, isSel && styles.clientChipTextActive]}>
                        👤 {cli.nome} (Devendo {formatCurrency(cli.saldo_devedor)})
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>

            {/* Pagamentos da Venda */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <Text style={styles.sectionLabel}>Pagamentos da Venda ({pagamentos.length})</Text>
              <TouchableOpacity
                onPress={() => setShowTaxConfigModal(true)}
                style={styles.adjustTaxesBtn}
              >
                <Ionicons name="options-outline" size={13} color="#1E63EC" />
                <Text style={styles.adjustTaxesBtnText}>Ajustar Taxas (%)</Text>
              </TouchableOpacity>
            </View>

            {pagamentos.map((pag, idx) => (
              <View key={idx} style={styles.pagamentoCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.pagFormaNome}>
                    {pag.forma_pagamento.toUpperCase()} ({pag.operadora || 'Padrão'})
                  </Text>
                  <Text style={styles.pagTaxaText}>
                    Taxa: {formatCurrency(pag.valor_taxa)} ({pag.taxa_percentual}% + {formatCurrency(pag.taxa_fixa)}) • Líquido: {formatCurrency(pag.valor_liquido)}
                  </Text>
                </View>
                <Text style={styles.pagValorBruto}>{formatCurrency(pag.valor)}</Text>
                <TouchableOpacity onPress={() => handleRemovePagamento(idx)} style={styles.removePagBtn}>
                  <Ionicons name="trash-outline" size={18} color="#E53E3E" />
                </TouchableOpacity>
              </View>
            ))}

            {/* Adicionar Parcela de Pagamento */}
            <View style={styles.addParcelaBox}>
              <Text style={styles.addParcelaTitle}>Forma de Pagamento / Dividir Parcela</Text>
              <Text style={styles.addParcelaSubtitle}>Toque para alternar o meio ou informe um valor para dividir:</Text>
              <View style={styles.addParcelaRow}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                  {['dinheiro', 'pix', 'cartao_debito', 'cartao_credito', 'fiado'].map(f => (
                    <TouchableOpacity
                      key={f}
                      style={[styles.formaChip, selectedForma === f && styles.formaChipActive]}
                      onPress={() => handleSelectForma(f)}
                    >
                      <Text style={[styles.formaChipText, selectedForma === f && styles.formaChipTextActive]}>
                        {f === 'dinheiro' ? '💵 Dinheiro' : f === 'pix' ? '⚡ PIX' : f === 'cartao_debito' ? '💳 Débito' : f === 'cartao_credito' ? '💳 Crédito' : '📓 Fiado'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <TextInput
                  style={styles.valorInput}
                  placeholder={saldoRestante > 0 ? `Valor (Ex: ${Number(saldoRestante || 0).toFixed(2)})` : 'Valor R$'}
                  placeholderTextColor="#A0AEC0"
                  keyboardType="numeric"
                  value={valorParcela}
                  onChangeText={setValorParcela}
                />
                <TouchableOpacity style={styles.addPagBtn} onPress={handleAddPagamento}>
                  <Ionicons name="add" size={18} color="#FFF" />
                  <Text style={styles.addPagBtnText}>Adicionar</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Painel de Apuração em Tempo Real */}
            <View style={styles.financeiroSummary}>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryItemLabel}>Total Pago:</Text>
                <Text style={[styles.summaryItemValue, { color: '#276749' }]}>{formatCurrency(totalPago)}</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryItemLabel}>Falta Pagar:</Text>
                <Text style={[
                  styles.summaryItemValue,
                  Math.abs(saldoRestante) > 0.01 ? { color: '#E53E3E' } : { color: '#276749' }
                ]}>
                  {formatCurrency(saldoRestante)}
                </Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryItemLabel}>Taxas Operacionais:</Text>
                <Text style={[styles.summaryItemValue, { color: '#DD6B20' }]}>-{formatCurrency(totalTaxas)}</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryItemLabel}>Valor Líquido:</Text>
                <Text style={[styles.summaryItemValue, { color: '#1E63EC', fontWeight: 'bold' }]}>{formatCurrency(totalLiquido)}</Text>
              </View>
            </View>

            {erroMsg ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={18} color="#E53E3E" />
                <Text style={styles.errorBoxText}>{erroMsg}</Text>
              </View>
            ) : null}
          </ScrollView>

          {/* Footer Ações */}
          <View style={styles.footer}>
            <TouchableOpacity style={styles.btnCancelar} onPress={onClose} disabled={loading}>
              <Text style={styles.btnCancelarText}>Voltar</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.btnConfirmar,
                (Math.abs(saldoRestante) > 0.01 || loading) && styles.btnConfirmarDisabled
              ]}
              onPress={handleFinalize}
              disabled={Math.abs(saldoRestante) > 0.01 || loading}
            >
              {loading ? (
                <ActivityIndicator color="#FFF" size="small" />
              ) : (
                <>
                  <Ionicons name="checkmark-done" size={20} color="#FFF" style={{ marginRight: 6 }} />
                  <Text style={styles.btnConfirmarText}>Confirmar e Finalizar</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Modal de Configuração de Taxas integrado ao Checkout */}
        <PaymentTaxConfigModal
          visible={showTaxConfigModal}
          gerenteId={gerenteId}
          onClose={() => setShowTaxConfigModal(false)}
          onSaved={async () => {
            const formas = await fetchFormasPagamento(gerenteId || 1);
            setFormasConfig(formas);
            if (pagamentos.length <= 1) {
              const currentForma = pagamentos[0]?.forma_pagamento || selectedForma || 'dinheiro';
              handleSelectForma(currentForma);
            }
          }}
        />
        <ClientsModal
          visible={showClientsModal}
          gerenteId={gerenteId}
          onClose={() => {
            setShowClientsModal(false);
            loadInitialData();
          }}
        />
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16
  },
  card: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '92%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 6
  },
  header: {
    backgroundColor: '#1E63EC',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF'
  },
  closeBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 14,
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center'
  },
  body: {
    maxHeight: 520
  },
  bodyContent: {
    padding: 16
  },
  totalBox: {
    backgroundColor: '#F7FAFC',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0'
  },
  totalBoxRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4
  },
  totalBoxLabel: {
    color: '#4A5568',
    fontSize: 13
  },
  totalBoxValue: {
    color: '#2D3748',
    fontSize: 15,
    fontWeight: 'bold'
  },
  descontoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 4
  },
  descontoLabel: {
    color: '#DD6B20',
    fontSize: 13,
    fontWeight: '600'
  },
  descontoInput: {
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    color: '#2D3748',
    fontSize: 13,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    textAlign: 'right',
    width: 85,
    height: 36
  },
  divider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: 8
  },
  totalFinalLabel: {
    color: '#1A202C',
    fontSize: 15,
    fontWeight: 'bold'
  },
  totalFinalValue: {
    color: '#1E63EC',
    fontSize: 20,
    fontWeight: 'bold'
  },
  sectionLabel: {
    color: '#4A5568',
    fontSize: 13,
    fontWeight: 'bold',
    marginBottom: 8
  },
  canalRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16
  },
  canalBtn: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center'
  },
  canalBtnActive: {
    backgroundColor: '#1E63EC',
    borderColor: '#1E63EC'
  },
  canalBtnText: {
    color: '#4A5568',
    fontSize: 12,
    fontWeight: '600'
  },
  canalBtnTextActive: {
    color: '#FFFFFF'
  },
  clientSection: {
    marginBottom: 14
  },
  clientChip: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginRight: 8
  },
  clientChipActive: {
    backgroundColor: '#1E63EC',
    borderColor: '#1E63EC'
  },
  clientChipText: {
    color: '#4A5568',
    fontSize: 12,
    fontWeight: '500'
  },
  clientChipTextActive: {
    color: '#FFFFFF',
    fontWeight: 'bold'
  },
  pagamentoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F7FAFC',
    padding: 10,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0'
  },
  pagFormaNome: {
    color: '#2D3748',
    fontSize: 13,
    fontWeight: 'bold'
  },
  pagTaxaText: {
    color: '#718096',
    fontSize: 11,
    marginTop: 2
  },
  pagValorBruto: {
    color: '#276749',
    fontSize: 14,
    fontWeight: 'bold',
    marginRight: 8
  },
  removePagBtn: {
    padding: 6
  },
  addParcelaBox: {
    backgroundColor: '#F7FAFC',
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0'
  },
  addParcelaTitle: {
    color: '#2D3748',
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 8
  },
  addParcelaRow: {
    marginBottom: 8
  },
  formaChip: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0'
  },
  formaChipActive: {
    backgroundColor: '#1E63EC',
    borderColor: '#1E63EC'
  },
  formaChipText: {
    color: '#4A5568',
    fontSize: 11,
    fontWeight: '500'
  },
  formaChipTextActive: {
    color: '#FFFFFF',
    fontWeight: 'bold'
  },
  valorInput: {
    flex: 1,
    height: 42,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    paddingHorizontal: 12,
    color: '#2D3748',
    fontSize: 13,
    borderWidth: 1,
    borderColor: '#E2E8F0'
  },
  addPagBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E63EC',
    paddingHorizontal: 14,
    height: 42,
    borderRadius: 8,
    gap: 4
  },
  addPagBtnText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: 'bold'
  },
  financeiroSummary: {
    backgroundColor: '#F7FAFC',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0'
  },
  summaryItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3
  },
  summaryItemLabel: {
    color: '#718096',
    fontSize: 12
  },
  summaryItemValue: {
    fontSize: 12,
    fontWeight: 'bold'
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF5F5',
    borderWidth: 1,
    borderColor: '#FEB2B2',
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
    gap: 8
  },
  errorBoxText: {
    color: '#C53030',
    fontSize: 12,
    fontWeight: '600',
    flex: 1
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    padding: 16,
    backgroundColor: '#FFFFFF'
  },
  btnCancelar: {
    flex: 1,
    height: 48,
    borderRadius: 8,
    backgroundColor: '#EDF2F7',
    justifyContent: 'center',
    alignItems: 'center'
  },
  btnCancelarText: {
    color: '#4A5568',
    fontWeight: 'bold',
    fontSize: 14
  },
  btnConfirmar: {
    flex: 2,
    flexDirection: 'row',
    height: 48,
    borderRadius: 8,
    backgroundColor: '#1E63EC',
    justifyContent: 'center',
    alignItems: 'center'
  },
  btnConfirmarDisabled: {
    backgroundColor: '#CBD5E1',
    opacity: 0.7
  },
  btnConfirmarText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 14
  },
  adjustTaxesBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EBF8FF',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6
  },
  adjustTaxesBtnText: {
    color: '#1E63EC',
    fontSize: 12,
    fontWeight: '700'
  },
  addParcelaSubtitle: {
    fontSize: 11,
    color: '#718096',
    marginBottom: 8
  }
});
