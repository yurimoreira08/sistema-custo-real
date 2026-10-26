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
  ActivityIndicator,
  Alert
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fetchFormasPagamento, saveFormaPagamentoConfig } from '../services/paymentService';

const getFormaIcon = (codigo, nome) => {
  const c = String(codigo || nome || '').toLowerCase();
  if (c.includes('dinheiro')) return { icon: 'cash-outline', bg: '#DEF7EC', color: '#03543F' };
  if (c.includes('debito')) return { icon: 'card-outline', bg: '#EBF8FF', color: '#2B6CB0' };
  if (c.includes('credito')) return { icon: 'card', bg: '#FAF5FF', color: '#6B46C1' };
  if (c.includes('pix')) return { icon: 'flash-outline', bg: '#E6FFFA', color: '#234E52' };
  if (c.includes('fiado') || c.includes('carne')) return { icon: 'document-text-outline', bg: '#FEEBC8', color: '#7B341E' };
  return { icon: 'wallet-outline', bg: '#EDF2F7', color: '#4A5568' };
};

export default function PaymentTaxConfigModal({
  visible,
  gerenteId,
  onClose,
  onSaved
}) {
  const [formas, setFormas] = useState([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState(null);
  const [taxasState, setTaxasState] = useState({}); // { id: { pct: string, fix: string } }
  const [erroMsg, setErroMsg] = useState('');

  const gid = gerenteId || 1;

  useEffect(() => {
    if (visible) {
      loadFormas();
    }
  }, [visible, gerenteId]);

  const loadFormas = async () => {
    setLoading(true);
    setErroMsg('');
    try {
      const list = await fetchFormasPagamento(gid);
      setFormas(list);
      const stateObj = {};
      for (const f of list) {
        stateObj[f.id] = {
          pct: String(f.taxa_percentual != null ? f.taxa_percentual : '0'),
          fix: String(f.taxa_fixa != null ? f.taxa_fixa : '0')
        };
      }
      setTaxasState(stateObj);
    } catch (e) {
      console.error('Erro ao carregar taxas de pagamento:', e);
      setErroMsg('Não foi possível carregar as taxas de pagamento.');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateField = (id, field, value) => {
    setTaxasState(prev => ({
      ...prev,
      [id]: {
        ...prev[id],
        [field]: value
      }
    }));
  };

  const handleSaveTaxa = async (forma) => {
    setSavingId(forma.id);
    setErroMsg('');
    try {
      const vals = taxasState[forma.id] || { pct: '0', fix: '0' };
      const pctNum = Math.max(0, parseFloat(String(vals.pct).replace(',', '.')) || 0);
      const fixNum = Math.max(0, parseFloat(String(vals.fix).replace(',', '.')) || 0);

      await saveFormaPagamentoConfig(
        {
          id: forma.id,
          codigo: forma.codigo,
          nome: forma.nome,
          operadora: forma.operadora || 'Padrao',
          taxa_percentual: pctNum,
          taxa_fixa: fixNum,
          ativo: 1
        },
        gid
      );

      Alert.alert('Sucesso', `Taxas de "${forma.nome}" salvas com sucesso!`);
      await loadFormas();
      if (onSaved) onSaved();
    } catch (e) {
      setErroMsg(e.message || 'Erro ao salvar taxa.');
    } finally {
      setSavingId(null);
    }
  };

  const handleSaveAllTaxas = async () => {
    setLoading(true);
    setErroMsg('');
    try {
      for (const forma of formas) {
        const vals = taxasState[forma.id] || { pct: '0', fix: '0' };
        const pctNum = Math.max(0, parseFloat(String(vals.pct).replace(',', '.')) || 0);
        const fixNum = Math.max(0, parseFloat(String(vals.fix).replace(',', '.')) || 0);

        await saveFormaPagamentoConfig(
          {
            id: forma.id,
            codigo: forma.codigo,
            nome: forma.nome,
            operadora: forma.operadora || 'Padrao',
            taxa_percentual: pctNum,
            taxa_fixa: fixNum,
            ativo: 1
          },
          gid
        );
      }
      Alert.alert('Sucesso', 'Taxas de todas as formas de pagamento atualizadas!');
      await loadFormas();
      if (onSaved) onSaved();
      onClose();
    } catch (e) {
      setErroMsg(e.message || 'Erro ao salvar taxas.');
      Alert.alert('Erro', e.message || 'Erro ao salvar taxas.');
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
              <View style={styles.headerIconCircle}>
                <Ionicons name="card" size={18} color="#1E63EC" />
              </View>
              <View>
                <Text style={styles.headerTitle}>Taxas das Formas de Pagamento</Text>
                <Text style={styles.headerSubtitle}>Configure tarifas fixas e percentuais por operadora</Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} accessibilityLabel="Fechar">
              <Ionicons name="close" size={20} color="#FFF" />
            </TouchableOpacity>
          </View>

          <View style={styles.bodyContent}>
            {loading ? (
              <View style={{ padding: 40, alignItems: 'center', justifyContent: 'center' }}>
                <ActivityIndicator color="#1E63EC" size="large" />
                <Text style={{ marginTop: 12, color: '#718096', fontSize: 13 }}>Carregando taxas...</Text>
              </View>
            ) : (
              <ScrollView style={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                {formas.map((f) => {
                  const vals = taxasState[f.id] || { pct: '0', fix: '0' };
                  const isSaving = savingId === f.id;
                  const iconMeta = getFormaIcon(f.codigo, f.nome);

                  return (
                    <View key={f.id} style={styles.formaCard}>
                      {/* Linha 1: Identificação da Forma + Botão Salvar desta forma */}
                      <View style={styles.formaCardHeader}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 10, marginRight: 8 }}>
                          <View style={[styles.formaIconBox, { backgroundColor: iconMeta.bg }]}>
                            <Ionicons name={iconMeta.icon} size={18} color={iconMeta.color} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.formaNome} numberOfLines={1}>{f.nome}</Text>
                            <Text style={styles.formaOperadora}>Operadora: {f.operadora || 'Padrão'}</Text>
                          </View>
                        </View>

                        <TouchableOpacity
                          style={[styles.saveBtnCard, isSaving && { opacity: 0.6 }]}
                          onPress={() => handleSaveTaxa(f)}
                          disabled={isSaving}
                          accessibilityLabel={`Salvar taxas de ${f.nome}`}
                        >
                          {isSaving ? (
                            <ActivityIndicator size="small" color="#1E63EC" />
                          ) : (
                            <>
                              <Ionicons name="checkmark-done" size={15} color="#1E63EC" />
                              <Text style={styles.saveBtnCardText}>Salvar</Text>
                            </>
                          )}
                        </TouchableOpacity>
                      </View>

                      {/* Linha 2: Campos de Entrada Organizados (50% cada) */}
                      <View style={styles.formaInputsRow}>
                        <View style={styles.inputFieldWrapper}>
                          <Text style={styles.fieldLabel}>Taxa Percentual</Text>
                          <View style={styles.fieldInputGroup}>
                            <TextInput
                              style={styles.fieldInput}
                              keyboardType="numeric"
                              placeholder="0.00"
                              placeholderTextColor="#A0AEC0"
                              value={vals.pct}
                              onChangeText={(txt) => handleUpdateField(f.id, 'pct', txt)}
                            />
                            <View style={styles.fieldSuffix}>
                              <Text style={styles.fieldSuffixText}>%</Text>
                            </View>
                          </View>
                        </View>

                        <View style={styles.inputFieldWrapper}>
                          <Text style={styles.fieldLabel}>Taxa Fixa</Text>
                          <View style={styles.fieldInputGroup}>
                            <View style={styles.fieldPrefix}>
                              <Text style={styles.fieldPrefixText}>R$</Text>
                            </View>
                            <TextInput
                              style={styles.fieldInput}
                              keyboardType="numeric"
                              placeholder="0.00"
                              placeholderTextColor="#A0AEC0"
                              value={vals.fix}
                              onChangeText={(txt) => handleUpdateField(f.id, 'fix', txt)}
                            />
                          </View>
                        </View>
                      </View>
                    </View>
                  );
                })}

                {erroMsg ? (
                  <View style={styles.errorBox}>
                    <Ionicons name="alert-circle" size={16} color="#E53E3E" />
                    <Text style={styles.errorText}>{erroMsg}</Text>
                  </View>
                ) : null}
              </ScrollView>
            )}
          </View>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.closeBtnFooter} onPress={onClose}>
              <Text style={styles.closeBtnFooterText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveAllBtnFooter} onPress={handleSaveAllTaxas}>
              <Ionicons name="save-outline" size={18} color="#FFF" style={{ marginRight: 6 }} />
              <Text style={styles.saveAllBtnFooterText}>Salvar Todas as Taxas</Text>
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
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 14
  },
  card: {
    width: '100%',
    maxWidth: 460,
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
    paddingHorizontal: 16,
    paddingVertical: 14
  },
  headerIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center'
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#FFFFFF'
  },
  headerSubtitle: {
    fontSize: 10.5,
    color: 'rgba(255, 255, 255, 0.8)',
    marginTop: 1
  },
  closeBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 14,
    width: 30,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center'
  },
  bodyContent: {
    padding: 14
  },
  body: {
    maxHeight: 460
  },
  formaCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
    gap: 10
  },
  formaCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  formaIconBox: {
    width: 34,
    height: 34,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center'
  },
  formaNome: {
    color: '#1A202C',
    fontSize: 13.5,
    fontWeight: 'bold'
  },
  formaOperadora: {
    color: '#718096',
    fontSize: 11,
    marginTop: 1
  },
  activePill: {
    backgroundColor: '#DEF7EC',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12
  },
  activePillText: {
    color: '#03543F',
    fontSize: 10,
    fontWeight: 'bold'
  },
  formaInputsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    backgroundColor: '#F8FAFC',
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#EDF2F7'
  },
  inputFieldWrapper: {
    flex: 1
  },
  fieldLabel: {
    fontSize: 10,
    color: '#718096',
    fontWeight: '600',
    marginBottom: 4
  },
  fieldInputGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    height: 36,
    overflow: 'hidden'
  },
  fieldInput: {
    flex: 1,
    height: '100%',
    paddingHorizontal: 8,
    fontSize: 12.5,
    color: '#1A202C',
    fontWeight: 'bold'
  },
  fieldSuffix: {
    backgroundColor: '#EDF2F7',
    paddingHorizontal: 8,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    borderLeftWidth: 1,
    borderLeftColor: '#CBD5E1'
  },
  fieldSuffixText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#4A5568'
  },
  fieldPrefix: {
    backgroundColor: '#EDF2F7',
    paddingHorizontal: 8,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    borderRightWidth: 1,
    borderRightColor: '#CBD5E1'
  },
  fieldPrefixText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#4A5568'
  },
  saveBtnCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EBF8FF',
    borderWidth: 1,
    borderColor: '#BEE3F8',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    flexShrink: 0,
  },
  saveBtnCardText: {
    color: '#1E63EC',
    fontSize: 11.5,
    fontWeight: 'bold',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF5F5',
    borderWidth: 1,
    borderColor: '#FEB2B2',
    padding: 10,
    borderRadius: 8,
    marginVertical: 8,
    gap: 6
  },
  errorText: {
    color: '#C53030',
    fontSize: 12,
    flex: 1
  },
  footer: {
    flexDirection: 'row',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    padding: 14,
    backgroundColor: '#FFFFFF'
  },
  closeBtnFooter: {
    flex: 1,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#EDF2F7',
    justifyContent: 'center',
    alignItems: 'center'
  },
  closeBtnFooterText: {
    color: '#4A5568',
    fontWeight: 'bold',
    fontSize: 13.5
  },
  saveAllBtnFooter: {
    flex: 2,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#1E63EC',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center'
  },
  saveAllBtnFooterText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 13.5
  }
});
