import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Modal,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function ManagerAuthModal({
  visible,
  title = 'Autorização Gerencial',
  subtitle = 'Informe a senha do gerente e a justificativa para prosseguir:',
  actionButtonText = 'Confirmar',
  onConfirm,
  onCancel,
  loading = false
}) {
  const [senha, setSenha] = useState('');
  const [justificativa, setJustificativa] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleConfirm = () => {
    setErrorMessage('');
    if (!senha.trim()) {
      setErrorMessage('Informe a senha do gerente.');
      return;
    }
    if (!justificativa.trim() || justificativa.trim().length < 5) {
      setErrorMessage('A justificativa deve ter ao menos 5 caracteres.');
      return;
    }

    onConfirm({ senha: senha.trim(), justificativa: justificativa.trim() });
  };

  const handleClose = () => {
    setSenha('');
    setJustificativa('');
    setErrorMessage('');
    onCancel();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.modalContent}>
          {/* Header padrão LucroCerto */}
          <View style={styles.modalHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="shield-checkmark" size={20} color="#FFF" />
              <Text style={styles.modalTitle}>{title}</Text>
            </View>
            <TouchableOpacity onPress={handleClose} style={styles.closeModalBtn}>
              <Ionicons name="close" size={20} color="#FFF" />
            </TouchableOpacity>
          </View>

          <View style={styles.modalBody}>
            {subtitle ? (
              <Text style={styles.subtitle}>{subtitle}</Text>
            ) : null}

            {errorMessage ? (
              <View style={styles.errorBanner}>
                <Ionicons name="alert-circle" size={16} color="#E53E3E" />
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            ) : null}

            {/* Campo Senha */}
            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Senha do Gerente *</Text>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={styles.formInput}
                  placeholder="Digite a senha..."
                  placeholderTextColor="#A0AEC0"
                  secureTextEntry={!showPassword}
                  value={senha}
                  onChangeText={setSenha}
                  autoCapitalize="none"
                />
                <TouchableOpacity
                  onPress={() => setShowPassword(!showPassword)}
                  style={styles.eyeBtn}
                >
                  <Ionicons
                    name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={20}
                    color="#A0AEC0"
                  />
                </TouchableOpacity>
              </View>
            </View>

            {/* Campo Justificativa */}
            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Justificativa Obrigatória *</Text>
              <TextInput
                style={styles.textArea}
                placeholder="Ex: Cliente desistiu da compra / Erro no valor digitado..."
                placeholderTextColor="#A0AEC0"
                multiline
                numberOfLines={3}
                value={justificativa}
                onChangeText={setJustificativa}
              />
            </View>

            {/* Ações */}
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelModalBtn}
                onPress={handleClose}
                disabled={loading}
              >
                <Text style={styles.cancelModalBtnText}>Voltar</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.confirmModalBtn, loading && { opacity: 0.7 }]}
                onPress={handleConfirm}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Text style={styles.confirmModalBtnText}>{actionButtonText}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    width: '100%',
    maxWidth: 420,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 6
  },
  modalHeader: {
    backgroundColor: '#E53E3E', // Vermelho elegante para operações críticas de cancelamento
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF'
  },
  closeModalBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 14,
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center'
  },
  modalBody: {
    padding: 20
  },
  subtitle: {
    fontSize: 13,
    color: '#718096',
    marginBottom: 16,
    lineHeight: 18
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF5F5',
    borderWidth: 1,
    borderColor: '#FEB2B2',
    padding: 10,
    borderRadius: 8,
    marginBottom: 14,
    gap: 8
  },
  errorText: {
    color: '#C53030',
    fontSize: 12,
    fontWeight: '600',
    flex: 1
  },
  formGroup: {
    marginBottom: 16
  },
  formLabel: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#4A5568',
    marginBottom: 8
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F7FAFC',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 12,
    height: 48
  },
  formInput: {
    flex: 1,
    color: '#2D3748',
    fontSize: 14,
    height: '100%'
  },
  eyeBtn: {
    padding: 6
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
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 10
  },
  cancelModalBtn: {
    flex: 1,
    backgroundColor: '#EDF2F7',
    borderRadius: 8,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center'
  },
  cancelModalBtnText: {
    color: '#4A5568',
    fontSize: 14,
    fontWeight: 'bold'
  },
  confirmModalBtn: {
    flex: 1.5,
    backgroundColor: '#E53E3E',
    borderRadius: 8,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center'
  },
  confirmModalBtnText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: 'bold'
  }
});
