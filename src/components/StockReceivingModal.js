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
import { fetchFornecedores, saveFornecedor, registrarEntradaMercadorias, calcularNovoPMP } from '../services/stockService';

export default function StockReceivingModal({
  visible,
  gerenteId,
  usuarioId,
  products = [],
  onSuccess,
  onClose
}) {
  const [fornecedores, setFornecedores] = useState([]);
  const [selectedFornecedorId, setSelectedFornecedorId] = useState(null);
  const [showAddFornecedor, setShowAddFornecedor] = useState(false);
  const [novoFornNome, setNovoFornNome] = useState('');
  const [novoFornCnpj, setNovoFornCnpj] = useState('');
  const [novoFornTelefone, setNovoFornTelefone] = useState('');
  const [novoFornCidade, setNovoFornCidade] = useState('');
  const [savingFornecedor, setSavingFornecedor] = useState(false);
  const [numeroNota, setNumeroNota] = useState('');
  const [observacoes, setObservacoes] = useState('');
  
  // Itens da entrada: [{ produtoId, nome, quantidade, custoUnitario, lote, pmpAtual, estoqueAtual, novoPmpCalculado }]
  const [itens, setItens] = useState([]);
  
  // Form de adição de item
  const [selectedProdId, setSelectedProdId] = useState(null);
  const [qtdItem, setQtdItem] = useState('');
  const [custoItem, setCustoItem] = useState('');
  const [loteItem, setLoteItem] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [erroMsg, setErroMsg] = useState('');

  useEffect(() => {
    if (visible && gerenteId) {
      loadFornecedores();
      resetForm();
    }
  }, [visible, gerenteId]);

  const loadFornecedores = async () => {
    try {
      const list = await fetchFornecedores(gerenteId);
      setFornecedores(list);
      if (list.length > 0 && !selectedFornecedorId) {
        setSelectedFornecedorId(list[0].id);
      }
    } catch (e) {
      console.error('Erro ao buscar fornecedores:', e);
    }
  };

  const resetForm = () => {
    setNumeroNota('');
    setObservacoes('');
    setItens([]);
    setSelectedProdId(products[0]?.id || null);
    setQtdItem('');
    setCustoItem('');
    setLoteItem('');
    setErroMsg('');
    setShowAddFornecedor(false);
    setNovoFornNome('');
    setNovoFornCnpj('');
    setNovoFornTelefone('');
    setNovoFornCidade('');
  };

  const handleCreateFornecedor = async () => {
    if (!novoFornNome.trim()) {
      Alert.alert('Atenção', 'Informe o nome ou razão social do fornecedor.');
      return;
    }
    setSavingFornecedor(true);
    try {
      const saved = await saveFornecedor({
        nome: novoFornNome.trim(),
        cnpj_cpf: novoFornCnpj.trim() || null,
        telefone: novoFornTelefone.trim() || null,
        cidade: novoFornCidade.trim() || null,
        ativo: 1
      }, gerenteId);
      Alert.alert('Sucesso', `Fornecedor "${saved.nome}" cadastrado com sucesso!`);
      setNovoFornNome('');
      setNovoFornCnpj('');
      setNovoFornTelefone('');
      setNovoFornCidade('');
      setShowAddFornecedor(false);
      await loadFornecedores();
      setSelectedFornecedorId(saved.id);
    } catch (e) {
      Alert.alert('Erro', e.message || 'Erro ao cadastrar fornecedor.');
    } finally {
      setSavingFornecedor(false);
    }
  };

  const formatCurrency = (val) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(val || 0);
  };

  const handleAddItem = () => {
    setErroMsg('');
    if (!selectedProdId) {
      setErroMsg('Selecione um produto.');
      return;
    }
    const q = parseFloat((qtdItem || '').replace(',', '.'));
    const c = parseFloat((custoItem || '').replace(',', '.'));

    if (isNaN(q) || q <= 0) {
      setErroMsg('Informe uma quantidade válida (maior que zero).');
      return;
    }
    if (isNaN(c) || c < 0) {
      setErroMsg('Informe um custo unitário válido.');
      return;
    }

    const prod = products.find(p => p.id === selectedProdId);
    if (!prod) return;

    const estoqueAtual = parseFloat(prod.estoque) || 0;
    const custoAtual = parseFloat(prod.preco_custo) || 0;
    const novoPmp = calcularNovoPMP(estoqueAtual, custoAtual, q, c);

    setItens([
      ...itens,
      {
        produtoId: prod.id,
        nome: prod.nome,
        quantidade: q,
        custoUnitario: c,
        custoTotal: parseFloat((q * c).toFixed(2)),
        lote: loteItem.trim() || null,
        estoqueAtual,
        pmpAtual: custoAtual,
        novoPmpCalculado: novoPmp
      }
    ]);

    setQtdItem('');
    setCustoItem('');
    setLoteItem('');
  };

  const handleRemoveItem = (index) => {
    const updated = [...itens];
    updated.splice(index, 1);
    setItens(updated);
  };

  const handleFinalizeReceiving = async () => {
    setErroMsg('');
    if (!selectedFornecedorId) {
      setErroMsg('Selecione um fornecedor.');
      return;
    }
    if (itens.length === 0) {
      setErroMsg('Adicione ao menos um item à entrada de mercadorias.');
      return;
    }

    setLoading(true);
    try {
      const res = await registrarEntradaMercadorias(
        {
          fornecedorId: selectedFornecedorId,
          numeroNota: numeroNota.trim() || null,
          observacoes: observacoes.trim() || null,
          itens: itens.map(i => ({
            produtoId: i.produtoId,
            quantidade: i.quantidade,
            custoUnitario: i.custoUnitario,
            lote: i.lote
          })),
          responsavelId: usuarioId
        },
        gerenteId
      );

      onSuccess(res);
      onClose();
    } catch (e) {
      setErroMsg(e.message || 'Erro ao registrar entrada de mercadoria.');
    } finally {
      setLoading(false);
    }
  };

  const totalNotaCalculado = itens.reduce((acc, i) => acc + i.custoTotal, 0);

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
              <Ionicons name="archive" size={20} color="#FFF" />
              <Text style={styles.headerTitle}>Entrada de Mercadorias (PMP)</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color="#FFF" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
            {/* Fornecedor */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <Text style={styles.label}>Fornecedor *</Text>
              <TouchableOpacity onPress={() => setShowAddFornecedor(!showAddFornecedor)}>
                <Text style={{ color: '#1E63EC', fontWeight: 'bold', fontSize: 13 }}>
                  {showAddFornecedor ? '✕ Cancelar' : '+ Cadastrar Novo'}
                </Text>
              </TouchableOpacity>
            </View>

            {showAddFornecedor ? (
              <View style={styles.newSupplierBox}>
                <Text style={styles.newSupplierTitle}>✨ Novo Fornecedor</Text>
                <TextInput
                  style={[styles.input, { marginBottom: 8 }]}
                  placeholder="Nome / Razão Social *"
                  placeholderTextColor="#A0AEC0"
                  value={novoFornNome}
                  onChangeText={setNovoFornNome}
                />
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    placeholder="CNPJ / CPF"
                    placeholderTextColor="#A0AEC0"
                    value={novoFornCnpj}
                    onChangeText={setNovoFornCnpj}
                  />
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    placeholder="Telefone"
                    placeholderTextColor="#A0AEC0"
                    value={novoFornTelefone}
                    onChangeText={setNovoFornTelefone}
                  />
                </View>
                <TextInput
                  style={[styles.input, { marginBottom: 10 }]}
                  placeholder="Cidade / UF"
                  placeholderTextColor="#A0AEC0"
                  value={novoFornCidade}
                  onChangeText={setNovoFornCidade}
                />
                <TouchableOpacity
                  style={styles.saveSupplierBtn}
                  onPress={handleCreateFornecedor}
                  disabled={savingFornecedor}
                >
                  {savingFornecedor ? (
                    <ActivityIndicator color="#FFF" />
                  ) : (
                    <Text style={styles.saveSupplierBtnText}>Salvar e Selecionar</Text>
                  )}
                </TouchableOpacity>
              </View>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                {fornecedores.length === 0 ? (
                  <Text style={{ color: '#718096', fontSize: 13, fontStyle: 'italic', paddingVertical: 6 }}>
                    Nenhum fornecedor cadastrado. Toque em "+ Cadastrar Novo".
                  </Text>
                ) : (
                  fornecedores.map(f => {
                    const isSel = selectedFornecedorId === f.id;
                    return (
                      <TouchableOpacity
                        key={f.id}
                        style={[styles.chip, isSel && styles.chipActive]}
                        onPress={() => setSelectedFornecedorId(f.id)}
                      >
                        <Text style={[styles.chipText, isSel && styles.chipTextActive]}>
                          🏢 {f.nome}
                        </Text>
                      </TouchableOpacity>
                    );
                  })
                )}
              </ScrollView>
            )}

            {/* Número da Nota e Observação */}
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Nº da Nota Fiscal</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Ex: NF 12345"
                  placeholderTextColor="#A0AEC0"
                  value={numeroNota}
                  onChangeText={setNumeroNota}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Observações</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Ex: Reposição semanal"
                  placeholderTextColor="#A0AEC0"
                  value={observacoes}
                  onChangeText={setObservacoes}
                />
              </View>
            </View>

            {/* Adicionar Produto */}
            <View style={styles.addBox}>
              <Text style={styles.addBoxTitle}>Adicionar Produto ao Recebimento</Text>

              <Text style={styles.miniLabel}>Produto:</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
                {products.map(p => {
                  const isSel = selectedProdId === p.id;
                  return (
                    <TouchableOpacity
                      key={p.id}
                      style={[styles.chipSmall, isSel && styles.chipSmallActive]}
                      onPress={() => setSelectedProdId(p.id)}
                    >
                      <Text style={[styles.chipSmallText, isSel && styles.chipSmallTextActive]}>
                        {p.nome} (Atual: {p.estoque} un | {formatCurrency(p.preco_custo)})
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.miniLabel}>Quantidade:</Text>
                  <TextInput
                    style={styles.inputSmall}
                    placeholder="Qtd un"
                    placeholderTextColor="#A0AEC0"
                    keyboardType="numeric"
                    value={qtdItem}
                    onChangeText={setQtdItem}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.miniLabel}>Custo Unitário (R$):</Text>
                  <TextInput
                    style={styles.inputSmall}
                    placeholder="0,00"
                    placeholderTextColor="#A0AEC0"
                    keyboardType="numeric"
                    value={custoItem}
                    onChangeText={setCustoItem}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.miniLabel}>Lote (opcional):</Text>
                  <TextInput
                    style={styles.inputSmall}
                    placeholder="Lote"
                    placeholderTextColor="#A0AEC0"
                    value={loteItem}
                    onChangeText={setLoteItem}
                  />
                </View>
              </View>

              <TouchableOpacity style={styles.addItemBtn} onPress={handleAddItem}>
                <Ionicons name="add-circle" size={18} color="#FFF" />
                <Text style={styles.addItemBtnText}>Incluir na Entrada</Text>
              </TouchableOpacity>
            </View>

            {/* Lista de Itens Recebidos e Simulação de PMP */}
            <Text style={styles.label}>Itens da Entrada ({itens.length})</Text>
            {itens.map((it, idx) => (
              <View key={idx} style={styles.itemCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemTitle}>{it.nome}</Text>
                  <Text style={styles.itemSubtext}>
                    Qtd: {it.quantidade} un × {formatCurrency(it.custoUnitario)} = {formatCurrency(it.custoTotal)}
                  </Text>
                  <Text style={styles.pmpBadge}>
                    PMP: {formatCurrency(it.pmpAtual)} ➔ Novo PMP: {formatCurrency(it.novoPmpCalculado)}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => handleRemoveItem(idx)} style={{ padding: 6 }}>
                  <Ionicons name="trash-outline" size={18} color="#E53E3E" />
                </TouchableOpacity>
              </View>
            ))}

            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Valor Total dos Produtos:</Text>
              <Text style={styles.totalValue}>{formatCurrency(totalNotaCalculado)}</Text>
            </View>

            {erroMsg ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={18} color="#E53E3E" />
                <Text style={styles.errorText}>{erroMsg}</Text>
              </View>
            ) : null}
          </ScrollView>

          {/* Footer */}
          <View style={styles.footer}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={loading}>
              <Text style={styles.cancelBtnText}>Cancelar</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.confirmBtn, (itens.length === 0 || loading) && { opacity: 0.5 }]}
              onPress={handleFinalizeReceiving}
              disabled={itens.length === 0 || loading}
            >
              {loading ? (
                <ActivityIndicator color="#FFF" size="small" />
              ) : (
                <Text style={styles.confirmBtnText}>Salvar Entrada & PMP</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
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
  label: {
    color: '#4A5568',
    fontSize: 13,
    fontWeight: 'bold',
    marginBottom: 6
  },
  miniLabel: {
    color: '#718096',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4
  },
  chip: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginRight: 8
  },
  chipActive: {
    backgroundColor: '#1E63EC',
    borderColor: '#1E63EC'
  },
  chipText: {
    color: '#4A5568',
    fontSize: 12,
    fontWeight: '500'
  },
  chipTextActive: {
    color: '#FFFFFF',
    fontWeight: 'bold'
  },
  input: {
    backgroundColor: '#F7FAFC',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 12,
    height: 44,
    color: '#2D3748',
    fontSize: 13
  },
  addBox: {
    backgroundColor: '#F7FAFC',
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0'
  },
  addBoxTitle: {
    color: '#2D3748',
    fontSize: 13,
    fontWeight: 'bold',
    marginBottom: 8
  },
  chipSmall: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    marginRight: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0'
  },
  chipSmallActive: {
    backgroundColor: '#1E63EC',
    borderColor: '#1E63EC'
  },
  chipSmallText: {
    color: '#4A5568',
    fontSize: 11
  },
  chipSmallTextActive: {
    color: '#FFFFFF',
    fontWeight: 'bold'
  },
  inputSmall: {
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 8,
    height: 40,
    color: '#2D3748',
    fontSize: 13
  },
  addItemBtn: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1E63EC',
    height: 40,
    borderRadius: 8,
    gap: 6,
    marginTop: 4
  },
  addItemBtnText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 13
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 10,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0'
  },
  itemTitle: {
    color: '#2D3748',
    fontSize: 13,
    fontWeight: 'bold'
  },
  itemSubtext: {
    color: '#718096',
    fontSize: 11,
    marginTop: 2
  },
  pmpBadge: {
    color: '#2B6CB0',
    fontSize: 11,
    fontWeight: 'bold',
    marginTop: 2
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F7FAFC',
    padding: 12,
    borderRadius: 8,
    marginVertical: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0'
  },
  totalLabel: {
    color: '#4A5568',
    fontSize: 13,
    fontWeight: 'bold'
  },
  totalValue: {
    color: '#1E63EC',
    fontSize: 16,
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
    marginBottom: 10,
    gap: 8
  },
  errorText: {
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
  cancelBtn: {
    flex: 1,
    height: 48,
    borderRadius: 8,
    backgroundColor: '#EDF2F7',
    justifyContent: 'center',
    alignItems: 'center'
  },
  cancelBtnText: {
    color: '#4A5568',
    fontWeight: 'bold',
    fontSize: 14
  },
  confirmBtn: {
    flex: 2,
    height: 48,
    borderRadius: 8,
    backgroundColor: '#1E63EC',
    justifyContent: 'center',
    alignItems: 'center'
  },
  confirmBtnText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 14
  },
  newSupplierBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5E0',
    padding: 12,
    marginBottom: 12
  },
  newSupplierTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#1A202C',
    marginBottom: 8
  },
  saveSupplierBtn: {
    backgroundColor: '#1E63EC',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center'
  },
  saveSupplierBtnText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 13
  }
});
