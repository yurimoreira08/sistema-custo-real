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
import { registrarPerdaEstoque, TIPOS_PERDA_VALIDOS } from '../services/stockService';

export default function StockLossModal({
  visible,
  gerenteId,
  usuarioId,
  products = [],
  onSuccess,
  onClose
}) {
  const [selectedProdId, setSelectedProdId] = useState(null);
  const [tipoPerda, setTipoPerda] = useState('quebra');
  const [quantidade, setQuantidade] = useState('');
  const [justificativa, setJustificativa] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [erroMsg, setErroMsg] = useState('');

  useEffect(() => {
    if (visible) {
      setSelectedProdId(products[0]?.id || null);
      setTipoPerda('quebra');
      setQuantidade('');
      setJustificativa('');
      setErroMsg('');
    }
  }, [visible, products]);

  const prod = products.find(p => p.id === selectedProdId) || null;
  const saldoAtual = prod ? (parseFloat(prod.estoque) || 0) : 0;
  const custoUnit = prod ? (parseFloat(prod.preco_custo) || 0) : 0;
  const qtdNum = Math.max(0, parseFloat((quantidade || '0').replace(',', '.')) || 0);
  const impactoCalculado = parseFloat((qtdNum * custoUnit).toFixed(2));

  const formatCurrency = (val) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(val || 0);
  };

  const handleConfirmLoss = async () => {
    setErroMsg('');
    if (!selectedProdId) {
      setErroMsg('Selecione um produto.');
      return;
    }
    if (qtdNum <= 0) {
      setErroMsg('Informe uma quantidade válida para a baixa.');
      return;
    }
    if (qtdNum > saldoAtual) {
      setErroMsg(`A quantidade (${qtdNum}) excede o saldo em estoque (${saldoAtual}).`);
      return;
    }
    if (!justificativa.trim() || justificativa.trim().length < 5) {
      setErroMsg('A justificativa é obrigatória e deve ter pelo menos 5 caracteres.');
      return;
    }

    setLoading(true);
    try {
      const res = await registrarPerdaEstoque(
        {
          produtoId: selectedProdId,
          usuarioId: usuarioId,
          tipoPerda: tipoPerda,
          quantidade: qtdNum,
          justificativa: justificativa.trim()
        },
        gerenteId
      );

      onSuccess(res);
      onClose();
    } catch (e) {
      setErroMsg(e.message || 'Erro ao registrar baixa por perda.');
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
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="trash" size={20} color="#FFF" />
              <Text style={styles.headerTitle}>Baixa de Perdas e Avarias</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color="#FFF" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
            {/* Seleção do Produto */}
            <Text style={styles.label}>Produto *</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
              {products.map(p => {
                const isSel = selectedProdId === p.id;
                return (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.chip, isSel && styles.chipActive]}
                    onPress={() => setSelectedProdId(p.id)}
                  >
                    <Text style={[styles.chipText, isSel && styles.chipTextActive]}>
                      {p.nome} (Saldo: {p.estoque} un)
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* Tipificação da Perda */}
            <Text style={styles.label}>Tipo de Perda *</Text>
            <View style={styles.tipoRow}>
              {TIPOS_PERDA_VALIDOS.map(t => {
                const isSel = tipoPerda === t;
                const emoji = t === 'quebra' ? '💥' : t === 'avaria' ? '⚠️' : t === 'extravio' ? '📦' : '🚨';
                return (
                  <TouchableOpacity
                    key={t}
                    style={[styles.tipoBtn, isSel && styles.tipoBtnActive]}
                    onPress={() => setTipoPerda(t)}
                  >
                    <Text style={[styles.tipoBtnText, isSel && styles.tipoBtnTextActive]}>
                      {emoji} {t.toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Quantidade e Resumo */}
            <View style={{ flexDirection: 'row', gap: 10, marginVertical: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Quantidade Perdida *</Text>
                <TextInput
                  style={styles.input}
                  placeholder={`Máx: ${saldoAtual}`}
                  placeholderTextColor="#A0AEC0"
                  keyboardType="numeric"
                  value={quantidade}
                  onChangeText={setQuantidade}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Impacto Financeiro</Text>
                <View style={styles.impactoBox}>
                  <Text style={styles.impactoText}>{formatCurrency(impactoCalculado)}</Text>
                  <Text style={styles.impactoSub}>Custo unit: {formatCurrency(custoUnit)}</Text>
                </View>
              </View>
            </View>

            {/* Justificativa */}
            <Text style={styles.label}>Justificativa Obrigatória para Auditoria *</Text>
            <TextInput
              style={styles.textArea}
              placeholder="Descreva detalhadamente o motivo da baixa..."
              placeholderTextColor="#A0AEC0"
              multiline
              numberOfLines={3}
              value={justificativa}
              onChangeText={setJustificativa}
            />

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
              style={[styles.confirmBtn, loading && { opacity: 0.5 }]}
              onPress={handleConfirmLoss}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#FFF" size="small" />
              ) : (
                <Text style={styles.confirmBtnText}>Confirmar Baixa</Text>
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
    backgroundColor: '#E53E3E', // Vermelho no padrão do sistema para perdas/baixas
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
  tipoRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8
  },
  tipoBtn: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0'
  },
  tipoBtnActive: {
    backgroundColor: '#FFF5F5',
    borderColor: '#E53E3E'
  },
  tipoBtnText: {
    color: '#4A5568',
    fontSize: 12,
    fontWeight: '600'
  },
  tipoBtnTextActive: {
    color: '#E53E3E',
    fontWeight: 'bold'
  },
  input: {
    backgroundColor: '#F7FAFC',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 12,
    height: 48,
    color: '#2D3748',
    fontSize: 14
  },
  impactoBox: {
    backgroundColor: '#FFF5F5',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FEB2B2',
    paddingHorizontal: 12,
    height: 48,
    justifyContent: 'center'
  },
  impactoText: {
    color: '#C53030',
    fontSize: 14,
    fontWeight: 'bold'
  },
  impactoSub: {
    color: '#E53E3E',
    fontSize: 10,
    marginTop: 2
  },
  textArea: {
    backgroundColor: '#F7FAFC',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 12,
    color: '#2D3748',
    fontSize: 13,
    height: 80,
    textAlignVertical: 'top',
    marginBottom: 14
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
    backgroundColor: '#E53E3E',
    justifyContent: 'center',
    alignItems: 'center'
  },
  confirmBtnText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 14
  }
});
