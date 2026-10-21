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
import { fetchFormasPagamento, saveFormaPagamentoConfig } from '../services/paymentService';

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
              <Ionicons name="card" size={20} color="#FFF" />
              <Text style={styles.headerTitle}>Taxas das Formas de Pagamento</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color="#FFF" />
            </TouchableOpacity>
          </View>

          <View style={styles.bodyContent}>
            <Text style={styles.subtitle}>
              Configure as taxas cobradas pelas maquininhas e meios de pagamento:
            </Text>

            {loading ? (
              <View style={{ padding: 30, alignItems: 'center' }}>
                <ActivityIndicator color="#1E63EC" size="small" />
              </View>
            ) : (
              <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
                {formas.map((f) => {
                  const vals = taxasState[f.id] || { pct: '0', fix: '0' };
                  const isSaving = savingId === f.id;

                  return (
                    <View key={f.id} style={styles.formaRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.formaNome}>{f.nome}</Text>
                        <Text style={styles.formaOperadora}>Operadora: {f.operadora || 'Padrão'}</Text>
                      </View>

                      <View style={styles.inputsRow}>
                        <View style={styles.inputCol}>
                          <Text style={styles.inputMiniLabel}>Taxa %</Text>
                          <TextInput
                            style={styles.taxInput}
                            keyboardType="numeric"
                            value={vals.pct}
                            onChangeText={(txt) => handleUpdateField(f.id, 'pct', txt)}
                          />
                        </View>

                        <View style={styles.inputCol}>
                          <Text style={styles.inputMiniLabel}>Fixa R$</Text>
                          <TextInput
                            style={styles.taxInput}
                            keyboardType="numeric"
                            value={vals.fix}
                            onChangeText={(txt) => handleUpdateField(f.id, 'fix', txt)}
                          />
                        </View>

                        <TouchableOpacity
                          style={[styles.saveBtn, isSaving && { opacity: 0.6 }]}
                          onPress={() => handleSaveTaxa(f)}
                          disabled={isSaving}
                        >
                          {isSaving ? (
                            <ActivityIndicator size="small" color="#FFF" />
                          ) : (
                            <Ionicons name="checkmark" size={18} color="#FFF" />
                          )}
                        </TouchableOpacity>
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
              <Ionicons name="save-outline" size={17} color="#FFF" style={{ marginRight: 6 }} />
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
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16
  },
  card: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '90%',
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
  bodyContent: {
    padding: 16
  },
  subtitle: {
    fontSize: 12,
    color: '#718096',
    marginBottom: 14,
    lineHeight: 16
  },
  body: {
    maxHeight: 460
  },
  formaRow: {
    backgroundColor: '#F7FAFC',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  formaNome: {
    color: '#2D3748',
    fontSize: 13,
    fontWeight: 'bold'
  },
  formaOperadora: {
    color: '#718096',
    fontSize: 11,
    marginTop: 2
  },
  inputsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6
  },
  inputCol: {
    alignItems: 'center'
  },
  inputMiniLabel: {
    color: '#718096',
    fontSize: 10,
    fontWeight: '600',
    marginBottom: 3
  },
  taxInput: {
    width: 58,
    height: 36,
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    color: '#2D3748',
    fontSize: 12,
    textAlign: 'center'
  },
  saveBtn: {
    width: 36,
    height: 36,
    backgroundColor: '#1E63EC',
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center'
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
    padding: 16,
    backgroundColor: '#FFFFFF'
  },
  closeBtnFooter: {
    flex: 1,
    height: 48,
    borderRadius: 8,
    backgroundColor: '#EDF2F7',
    justifyContent: 'center',
    alignItems: 'center'
  },
  closeBtnFooterText: {
    color: '#4A5568',
    fontWeight: 'bold',
    fontSize: 14
  },
  saveAllBtnFooter: {
    flex: 2,
    height: 48,
    borderRadius: 8,
    backgroundColor: '#1E63EC',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center'
  },
  saveAllBtnFooterText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 14
  }
});
