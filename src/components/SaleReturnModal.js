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
import { fetchSaleItems } from '../database/db';
import { processarDevolucaoParcial } from '../services/saleService';

export default function SaleReturnModal({
  visible,
  venda,
  gerenteId,
  usuarioId,
  onSuccess,
  onClose
}) {
  const [itensVenda, setItensVenda] = useState([]);
  const [quantidadesDevolucao, setQuantidadesDevolucao] = useState({});
  const [aptoRetornoMap, setAptoRetornoMap] = useState({});
  const [motivo, setMotivo] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [loadingItens, setLoadingItens] = useState(false);
  const [erroMsg, setErroMsg] = useState('');

  useEffect(() => {
    if (visible && venda?.id) {
      loadItens();
      setMotivo('');
      setErroMsg('');
      setQuantidadesDevolucao({});
      setAptoRetornoMap({});
    }
  }, [visible, venda]);

  const loadItens = async () => {
    setLoadingItens(true);
    try {
      const items = await fetchSaleItems(venda.id);
      setItensVenda(items);
      const initialApto = {};
      for (const it of items) {
        initialApto[it.id] = true;
      }
      setAptoRetornoMap(initialApto);
    } catch (e) {
      console.error('Erro ao buscar itens da venda:', e);
    } finally {
      setLoadingItens(false);
    }
  };

  const formatCurrency = (val) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(val || 0);
  };

  const handleQtyChange = (itemId, text) => {
    setQuantidadesDevolucao(prev => ({ ...prev, [itemId]: text }));
  };

  const toggleApto = (itemId) => {
    setAptoRetornoMap(prev => ({ ...prev, [itemId]: !prev[itemId] }));
  };

  const handleConfirmReturn = async () => {
    setErroMsg('');

    const itensParaDevolver = [];
    for (const it of itensVenda) {
      const rawQty = quantidadesDevolucao[it.id];
      const q = parseFloat((rawQty || '0').replace(',', '.'));
      if (q > 0) {
        const jaDevolvido = parseFloat(it.quantidade_devolvida) || 0;
        const saldoMax = parseFloat((it.quantidade - jaDevolvido).toFixed(3));
        if (q > saldoMax) {
          setErroMsg(`Quantidade a devolver para "${it.nome}" (${q}) excede o saldo disponível (${saldoMax}).`);
          return;
        }
        itensParaDevolver.push({
          itemVendaId: it.id,
          quantidade: q,
          aptoRetorno: aptoRetornoMap[it.id] !== false
        });
      }
    }

    if (itensParaDevolver.length === 0) {
      setErroMsg('Informe a quantidade de ao menos um item a ser devolvido.');
      return;
    }

    if (!motivo.trim() || motivo.trim().length < 5) {
      setErroMsg('O motivo da devolução é obrigatório e deve ter no mínimo 5 caracteres.');
      return;
    }

    setLoading(true);
    try {
      const comprovante = await processarDevolucaoParcial(
        {
          vendaId: venda.id,
          usuarioId: usuarioId,
          motivo: motivo.trim(),
          itensDevolver: itensParaDevolver
        },
        gerenteId
      );

      onSuccess(comprovante);
      onClose();
    } catch (e) {
      setErroMsg(e.message || 'Erro ao processar devolução parcial.');
    } finally {
      setLoading(false);
    }
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
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="return-down-back" size={20} color="#FFF" />
                <Text style={styles.headerTitle}>Devolução Parcial de Itens</Text>
              </View>
              <Text style={styles.headerSubtitle} numberOfLines={1}>
                Venda #{venda?.id} • Total Original: {formatCurrency(venda?.valor_total)}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color="#FFF" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
            <Text style={styles.sectionLabel}>Selecione as quantidades devolvidas:</Text>

            {loadingItens ? (
              <View style={{ padding: 24, alignItems: 'center' }}>
                <ActivityIndicator color="#1E63EC" size="small" />
              </View>
            ) : (
              itensVenda.map((it) => {
                const jaDevolvido = parseFloat(it.quantidade_devolvida) || 0;
                const saldoDisponivel = parseFloat((it.quantidade - jaDevolvido).toFixed(3));
                const apto = aptoRetornoMap[it.id] !== false;

                return (
                  <View key={it.id} style={styles.itemRow}>
                    <View style={{ flex: 1, marginRight: 10 }}>
                      <Text style={styles.itemNome}>{it.nome}</Text>
                      <Text style={styles.itemMeta}>
                        Unit: {formatCurrency(it.preco_unitario)} • Vendido: {it.quantidade} un (Já devolvido: {jaDevolvido} un)
                      </Text>
                      <Text style={[styles.itemSaldo, saldoDisponivel === 0 && { color: '#E53E3E' }]}>
                        Disponível para devolução: {saldoDisponivel} un
                      </Text>
                    </View>

                    <View style={styles.actionCol}>
                      <TextInput
                        style={[styles.inputQty, saldoDisponivel === 0 && { opacity: 0.5 }]}
                        placeholder="Qtd"
                        placeholderTextColor="#A0AEC0"
                        keyboardType="numeric"
                        editable={saldoDisponivel > 0}
                        value={quantidadesDevolucao[it.id] || ''}
                        onChangeText={(txt) => handleQtyChange(it.id, txt)}
                      />

                      <TouchableOpacity
                        style={[styles.aptoBtn, apto ? styles.aptoBtnAtivo : styles.aptoBtnInativo]}
                        onPress={() => toggleApto(it.id)}
                      >
                        <Ionicons
                          name={apto ? 'checkmark-circle' : 'close-circle'}
                          size={13}
                          color={apto ? '#03543F' : '#9B1C1C'}
                        />
                        <Text style={[styles.aptoBtnText, { color: apto ? '#03543F' : '#9B1C1C' }]}>
                          {apto ? 'Apto' : 'Avaria'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })
            )}

            <Text style={[styles.sectionLabel, { marginTop: 14 }]}>Motivo da Devolução *</Text>
            <TextInput
              style={styles.textArea}
              placeholder="Ex: Embalagem violada / Produto fora da validade / Troca de sabor..."
              placeholderTextColor="#A0AEC0"
              multiline
              numberOfLines={3}
              value={motivo}
              onChangeText={setMotivo}
            />

            {erroMsg ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={18} color="#E53E3E" />
                <Text style={styles.errorText}>{erroMsg}</Text>
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={loading}>
              <Text style={styles.cancelBtnText}>Cancelar</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.confirmBtn, loading && { opacity: 0.5 }]}
              onPress={handleConfirmReturn}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#FFF" size="small" />
              ) : (
                <Text style={styles.confirmBtnText}>Processar Devolução</Text>
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
  headerSubtitle: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.8)',
    marginTop: 2
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
  sectionLabel: {
    color: '#4A5568',
    fontSize: 13,
    fontWeight: 'bold',
    marginBottom: 8
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F7FAFC',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0'
  },
  itemNome: {
    color: '#2D3748',
    fontSize: 13,
    fontWeight: 'bold'
  },
  itemMeta: {
    color: '#718096',
    fontSize: 11,
    marginTop: 2
  },
  itemSaldo: {
    color: '#2B6CB0',
    fontSize: 11,
    fontWeight: 'bold',
    marginTop: 2
  },
  actionCol: {
    alignItems: 'flex-end',
    gap: 6
  },
  inputQty: {
    width: 75,
    height: 38,
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    color: '#2D3748',
    fontSize: 13,
    textAlign: 'center'
  },
  aptoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    gap: 4
  },
  aptoBtnAtivo: {
    backgroundColor: '#DEF7EC',
    borderColor: '#BEE3F8'
  },
  aptoBtnInativo: {
    backgroundColor: '#FDE8E8',
    borderColor: '#FEB2B2'
  },
  aptoBtnText: {
    fontSize: 10,
    fontWeight: 'bold'
  },
  textArea: {
    backgroundColor: '#F7FAFC',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 12,
    color: '#2D3748',
    fontSize: 13,
    height: 75,
    textAlignVertical: 'top'
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF5F5',
    borderWidth: 1,
    borderColor: '#FEB2B2',
    padding: 10,
    borderRadius: 8,
    marginTop: 10,
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
  }
});
