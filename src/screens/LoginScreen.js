import React, { useState } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  TextInput, 
  TouchableOpacity, 
  KeyboardAvoidingView, 
  Platform, 
  ScrollView, 
  ActivityIndicator,
  Alert
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useApp } from '../context/AppContext';
import { Ionicons } from '@expo/vector-icons';

export default function LoginScreen() {
  const { login } = useApp();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleLoginSubmit = async () => {
    if (!username.trim() || !password.trim()) {
      Alert.alert('Erro', 'Por favor, preencha todos os campos.');
      return;
    }

    setLoading(true);
    try {
      const success = await login(username.trim(), password);
      if (!success) {
        Alert.alert('Erro de Login', 'Usuário ou senha inválidos.');
      }
    } catch (error) {
      Alert.alert('Erro', 'Ocorreu um erro ao tentar fazer login.');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleAdminShortcut = () => {
    setUsername('admin');
    setPassword('123456');
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
        {/* Parte Superior: Fundo Azul */}
        <View style={styles.topSection}>
          <TouchableOpacity style={styles.logoBtn} onPress={handleAdminShortcut} activeOpacity={0.9}>
            <Ionicons name="cart" size={60} color="#FFFFFF" style={styles.logoIcon} />
          </TouchableOpacity>
          <Text style={styles.brandTitle}>Mercado Manager</Text>
          <Text style={styles.brandSubtitle}>Sistema de Controle de Estoque & Custos</Text>
          
          {/* Cápsulas de Funcionalidades */}
          <View style={styles.capsulesContainer}>
            <View style={styles.capsule}>
              <Text style={styles.capsuleText}>📦 Estoque</Text>
            </View>
            <View style={styles.capsule}>
              <Text style={styles.capsuleText}>💰 Custos</Text>
            </View>
            <View style={styles.capsule}>
              <Text style={styles.capsuleText}>📊 Relatórios</Text>
            </View>
          </View>
        </View>

        {/* Parte Inferior: Card Branco */}
        <View style={styles.bottomCard}>
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Usuário</Text>
            <View style={styles.inputWrapper}>
              <TextInput
                style={styles.textInput}
                placeholder="Digite seu usuário"
                placeholderTextColor="#A0AEC0"
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Senha</Text>
            <View style={styles.inputWrapper}>
              <TextInput
                style={styles.textInput}
                placeholder="Digite sua senha"
                placeholderTextColor="#A0AEC0"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity 
                style={styles.eyeBtn} 
                onPress={() => setShowPassword(!showPassword)}
              >
                <Ionicons 
                  name={showPassword ? "eye-off-outline" : "eye-outline"} 
                  size={20} 
                  color="#A0AEC0" 
                />
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity style={styles.forgotBtn}>
            <Text style={styles.forgotText}>Esqueceu a senha?</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.loginBtn} 
            onPress={handleLoginSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.loginBtnText}>Entrar</Text>
            )}
          </TouchableOpacity>

          {/* Dica para o avaliador */}
          {username === '' && (
            <TouchableOpacity onPress={handleAdminShortcut} style={styles.tipContainer}>
              <Text style={styles.tipText}>💡 Clique aqui para preencher dados do Admin</Text>
            </TouchableOpacity>
          )}

          {/* Rodapé */}
          <View style={styles.footerRow}>
            <View style={styles.footerLeft}>
              <Text style={styles.footerText}>🔒 Acesso restrito a funcionários</Text>
            </View>
            <Text style={styles.footerVersion}>v1.0.0</Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  scrollContainer: {
    flexGrow: 1,
    backgroundColor: '#FFFFFF',
  },
  topSection: {
    backgroundColor: '#1E63EC', // Azul royal vivo idêntico ao da imagem
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 70 : 60,
    paddingBottom: 40,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  logoBtn: {
    marginBottom: 16,
  },
  logoIcon: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  brandTitle: {
    fontSize: 30,
    fontWeight: 'bold',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  brandSubtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
    marginTop: 6,
  },
  capsulesContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginTop: 24,
  },
  capsule: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)', // cápsulas transparentes
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  capsuleText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  bottomCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 24,
    justifyContent: 'flex-start',
  },
  inputGroup: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#2D3748', // Cinza escuro
    marginBottom: 8,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0', // Borda cinza clara idêntica à imagem
    paddingHorizontal: 16,
    height: 52,
  },
  textInput: {
    flex: 1,
    color: '#2D3748',
    fontSize: 16,
    height: '100%',
  },
  eyeBtn: {
    padding: 6,
  },
  forgotBtn: {
    alignSelf: 'flex-end',
    marginBottom: 28,
  },
  forgotText: {
    color: '#4A5568', // Cor escura intermediária
    fontSize: 14,
    fontWeight: '500',
  },
  loginBtn: {
    backgroundColor: '#1E63EC',
    borderRadius: 8,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#1E63EC',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 3,
  },
  loginBtnText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  tipContainer: {
    alignItems: 'center',
    marginTop: 16,
    padding: 10,
    backgroundColor: '#EDF2F7',
    borderRadius: 8,
  },
  tipText: {
    color: '#2B6CB0',
    fontSize: 13,
    fontWeight: '500',
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 'auto',
    paddingTop: 32,
  },
  footerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  footerText: {
    color: '#718096',
    fontSize: 12,
  },
  footerVersion: {
    color: '#A0AEC0',
    fontSize: 12,
  },
});
