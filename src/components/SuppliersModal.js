import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Modal,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fetchFornecedores, saveFornecedor } from '../services/stockService';

export default function SuppliersModal({
  visible,
  gerenteId,
  onClose,
  onSupplierSelected
}) {
  const [fornecedores, setFornecedores] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [nome, setNome] = useState('');
  const [cnpjCpf, setCnpjCpf] = useState('');
  const [telefone, setTelefone] = useState('');
  const [email, setEmail] = useState('');
  const [cidade, setCidade] = useState('');

  useEffect(() => {
    if (visible && gerenteId) {
      loadFornecedores();
      resetForm();
    }
  }, [visible, gerenteId]);

  const loadFornecedores = async () => {
    setLoading(true);
    try {
      const list = await fetchFornecedores(gerenteId);
      setFornecedores(list);
    } catch (e) {
      console.error('Erro ao carregar fornecedores:', e);
      Alert.alert('Erro', 'Não foi possível carregar a lista de fornecedores.');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setIsFormOpen(false);
    setEditingId(null);
    setNome('');
    setCnpjCpf('');
    setTelefone('');
    setEmail('');
    setCidade('');
  };

  const handleEdit = (f) => {
    setEditingId(f.id);
    setNome(f.nome || '');
    setCnpjCpf(f.cnpj_cpf || '');
    setTelefone(f.telefone || '');
    setEmail(f.email || '');
    setCidade(f.cidade || '');
    setIsFormOpen(true);
  };

  const handleSave = async () => {
    if (!nome.trim()) {
      Alert.alert('Atenção', 'O nome ou razão social do fornecedor é obrigatório.');
      return;
    }

    setSaving(true);
    try {
      const saved = await saveFornecedor({
        id: editingId,
        nome: nome.trim(),
        cnpj_cpf: cnpjCpf.trim() || null,
        telefone: telefone.trim() || null,
        email: email.trim() || null,
        cidade: cidade.trim() || null,
        ativo: 1
      }, gerenteId);

      Alert.alert('Sucesso', `Fornecedor "${saved.nome}" salvo com sucesso!`);
      resetForm();
      await loadFornecedores();
      if (onSupplierSelected) {
        onSupplierSelected(saved);
      }
    } catch (e) {
      Alert.alert('Erro', e.message || 'Falha ao salvar fornecedor.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.modalOverlay}
      >
        <View style={styles.modalContent}>
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerTitle}>🏢 Gestão de Fornecedores</Text>
              <Text style={styles.headerSubtitle}>
                Cadastre e consulte os parceiros de compras e reposição
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color="#4A5568" />
            </TouchableOpacity>
          </View>

          {/* Action to Toggle Form */}
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.toggleBtn, isFormOpen ? styles.toggleBtnCancel : styles.toggleBtnAdd]}
              onPress={() => {
                if (isFormOpen) {
                  resetForm();
                } else {
                  setIsFormOpen(true);
                }
              }}
            >
              <Ionicons
                name={isFormOpen ? 'close-circle-outline' : 'add-circle-outline'}
                size={18}
                color="#FFF"
              />
              <Text style={styles.toggleBtnText}>
                {isFormOpen ? 'Cancelar Formulário' : '+ Novo Fornecedor'}
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
            {/* Form Section */}
            {isFormOpen && (
              <View style={styles.formCard}>
                <Text style={styles.formTitle}>
                  {editingId ? '✏️ Editar Fornecedor' : '✨ Cadastrar Novo Fornecedor'}
                </Text>

                <Text style={styles.inputLabel}>Nome / Razão Social *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Ex: Distribuidora Aliança Ltda"
                  placeholderTextColor="#A0AEC0"
                  value={nome}
                  onChangeText={setNome}
                />

                <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>CNPJ ou CPF</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="00.000.000/0000-00"
                      placeholderTextColor="#A0AEC0"
                      value={cnpjCpf}
                      onChangeText={setCnpjCpf}
                      keyboardType="numeric"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>Telefone / WhatsApp</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="(00) 00000-0000"
                      placeholderTextColor="#A0AEC0"
                      value={telefone}
                      onChangeText={setTelefone}
                      keyboardType="phone-pad"
                    />
                  </View>
                </View>

                <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>E-mail</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="vendas@fornecedor.com"
                      placeholderTextColor="#A0AEC0"
                      value={email}
                      onChangeText={setEmail}
                      autoCapitalize="none"
                      keyboardType="email-address"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>Cidade / UF</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="São Paulo - SP"
                      placeholderTextColor="#A0AEC0"
                      value={cidade}
                      onChangeText={setCidade}
                    />
                  </View>
                </View>

                <TouchableOpacity
                  style={styles.saveBtn}
                  onPress={handleSave}
                  disabled={saving}
                >
                  {saving ? (
                    <ActivityIndicator color="#FFF" />
                  ) : (
                    <Text style={styles.saveBtnText}>
                      {editingId ? 'Salvar Alterações' : 'Cadastrar Fornecedor'}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            )}

            {/* List Section */}
            <Text style={styles.listTitle}>
              Fornecedores Cadastrados ({fornecedores.length})
            </Text>

            {loading ? (
              <ActivityIndicator size="large" color="#1E63EC" style={{ marginVertical: 30 }} />
            ) : fornecedores.length === 0 ? (
              <View style={styles.emptyBox}>
                <Ionicons name="business-outline" size={44} color="#A0AEC0" />
                <Text style={styles.emptyTitle}>Nenhum fornecedor cadastrado</Text>
                <Text style={styles.emptySub}>
                  Toque em "+ Novo Fornecedor" acima para cadastrar seu primeiro parceiro.
                </Text>
              </View>
            ) : (
              fornecedores.map((f) => (
                <View key={f.id.toString()} style={styles.supplierCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.supplierName}>{f.nome}</Text>
                    <View style={styles.infoRow}>
                      {f.cnpj_cpf ? (
                        <Text style={styles.infoItem}>📄 {f.cnpj_cpf}</Text>
                      ) : null}
                      {f.telefone ? (
                        <Text style={styles.infoItem}>📞 {f.telefone}</Text>
                      ) : null}
                    </View>
                    <View style={styles.infoRow}>
                      {f.cidade ? (
                        <Text style={styles.infoItem}>📍 {f.cidade}</Text>
                      ) : null}
                      {f.email ? (
                        <Text style={styles.infoItem}>✉️ {f.email}</Text>
                      ) : null}
                    </View>
                  </View>

                  <TouchableOpacity
                    style={styles.editBtn}
                    onPress={() => handleEdit(f)}
                  >
                    <Ionicons name="pencil" size={16} color="#1E63EC" />
                    <Text style={styles.editBtnText}>Editar</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
    minHeight: '65%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1A202C',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#718096',
    marginTop: 2,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#EDF2F7',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 10,
  },
  actionRow: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 8,
  },
  toggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
    gap: 8,
  },
  toggleBtnAdd: {
    backgroundColor: '#1E63EC',
  },
  toggleBtnCancel: {
    backgroundColor: '#718096',
  },
  toggleBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    paddingHorizontal: 20,
    paddingBottom: 30,
  },
  formCard: {
    backgroundColor: '#F7FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 16,
    marginBottom: 20,
  },
  formTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#1A202C',
    marginBottom: 12,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4A5568',
    marginBottom: 4,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    color: '#1A202C',
  },
  saveBtn: {
    backgroundColor: '#2F855A',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 16,
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  listTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#4A5568',
    marginTop: 8,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  emptyBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#4A5568',
    marginTop: 12,
  },
  emptySub: {
    fontSize: 12,
    color: '#A0AEC0',
    textAlign: 'center',
    marginTop: 4,
    paddingHorizontal: 20,
  },
  supplierCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  supplierName: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#1A202C',
  },
  infoRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 4,
  },
  infoItem: {
    fontSize: 12,
    color: '#718096',
  },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EBF8FF',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    gap: 4,
    marginLeft: 8,
  },
  editBtnText: {
    color: '#1E63EC',
    fontSize: 12,
    fontWeight: '600',
  },
});
