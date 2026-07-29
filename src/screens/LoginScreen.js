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
  Alert,
  Image
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useApp } from '../context/AppContext';
import { Ionicons } from '@expo/vector-icons';
import { registerUser } from '../database/db';

// Tela de Login e Cadastro de comerciante/gerente
export default function LoginScreen() {
  const { login } = useApp();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [isSignup, setIsSignup] = useState(false);
  const [signupNome, setSignupNome] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupSenha, setSignupSenha] = useState('');
  const [signupConfirmarSenha, setSignupConfirmarSenha] = useState('');
  const [showSignupPassword, setShowSignupPassword] = useState(false);

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

  const handleSignupSubmit = async () => {
    if (!signupNome.trim() || !signupEmail.trim() || !signupSenha.trim() || !signupConfirmarSenha.trim()) {
      Alert.alert('Erro', 'Por favor, preencha todos os campos.');
      return;
    }
    if (signupSenha !== signupConfirmarSenha) {
      Alert.alert('Erro', 'As senhas não coincidem.');
      return;
    }

    setLoading(true);
    try {
      await registerUser(signupNome, signupEmail, signupSenha, 'gerente');
      Alert.alert('Sucesso', 'Comércio e gerente cadastrados com sucesso! Faça login para começar.');
      setUsername(signupEmail);
      setPassword(signupSenha);
      setIsSignup(false);
      setSignupNome('');
      setSignupEmail('');
      setSignupSenha('');
      setSignupConfirmarSenha('');
    } catch (error) {
      Alert.alert('Erro no Cadastro', error.message || 'Não foi possível realizar o cadastro.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
        <View style={styles.topSection}>
          <View style={styles.logoContainer}>
            <Image 
              source={require('../../assets/logo_lucrocerto.png')} 
              style={styles.logoImage} 
              resizeMode="contain"
            />
          </View>
          <Text style={styles.brandTitle}>LucroCerto</Text>
          <Text style={styles.brandSubtitle}>Gestão Inteligente de Estoque, Custos & Lucro</Text>
          
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

        <View style={styles.bottomCard}>
          {!isSignup ? (
            <View style={{ flex: 1 }}>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Usuário ou E-mail</Text>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.textInput}
                    placeholder="Digite seu usuário ou e-mail"
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

              <TouchableOpacity 
                style={styles.toggleBtn}
                onPress={() => setIsSignup(true)}
              >
                <Text style={styles.toggleText}>Novo comércio? <Text style={styles.toggleTextBold}>Cadastrar Gerente</Text></Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={{ flex: 1 }}>
              <Text style={styles.formTitle}>Cadastrar Gerente / Comércio</Text>
              <Text style={styles.formSubtitle}>Crie a conta de administrador para gerenciar seu negócio.</Text>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Nome Completo</Text>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.textInput}
                    placeholder="Ex: João da Silva"
                    placeholderTextColor="#A0AEC0"
                    value={signupNome}
                    onChangeText={setSignupNome}
                    autoCorrect={false}
                  />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>E-mail / Usuário</Text>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.textInput}
                    placeholder="Ex: joao@comercio.com"
                    placeholderTextColor="#A0AEC0"
                    value={signupEmail}
                    onChangeText={setSignupEmail}
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
                    placeholder="Crie uma senha de acesso"
                    placeholderTextColor="#A0AEC0"
                    value={signupSenha}
                    onChangeText={setSignupSenha}
                    secureTextEntry={!showSignupPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <TouchableOpacity 
                    style={styles.eyeBtn} 
                    onPress={() => setShowSignupPassword(!showSignupPassword)}
                  >
                    <Ionicons 
                      name={showSignupPassword ? "eye-off-outline" : "eye-outline"} 
                      size={20} 
                      color="#A0AEC0" 
                    />
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Confirmar Senha</Text>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.textInput}
                    placeholder="Repita a senha criada"
                    placeholderTextColor="#A0AEC0"
                    value={signupConfirmarSenha}
                    onChangeText={setSignupConfirmarSenha}
                    secureTextEntry={!showSignupPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
              </View>

              <TouchableOpacity 
                style={styles.loginBtn} 
                onPress={handleSignupSubmit}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <Text style={styles.loginBtnText}>Cadastrar Comércio</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity 
                style={styles.toggleBtn}
                onPress={() => setIsSignup(false)}
              >
                <Text style={styles.toggleText}>Já possui uma conta? <Text style={styles.toggleTextBold}>Entrar</Text></Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.footerRow}>
            <View style={styles.footerLeft}>
              <Text style={styles.footerText}>🔒 Acesso criptografado e seguro</Text>
            </View>
            <Text style={styles.footerVersion}>v2.0.0</Text>
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
    backgroundColor: '#1E63EC',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 70 : 60,
    paddingBottom: 40,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
  },
  logoContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 15,
    elevation: 8,
    marginBottom: 16,
  },
  logoImage: {
    width: 130,
    height: 130,
  },
  brandTitle: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  brandSubtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.85)',
    marginTop: 6,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  capsulesContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginTop: 24,
  },
  capsule: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
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
    paddingTop: 28,
    paddingBottom: 24,
    justifyContent: 'flex-start',
  },
  formTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2D3748',
    marginBottom: 6,
  },
  formSubtitle: {
    fontSize: 13,
    color: '#718096',
    marginBottom: 20,
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2D3748',
    marginBottom: 6,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 16,
    height: 50,
  },
  textInput: {
    flex: 1,
    color: '#2D3748',
    fontSize: 15,
    height: '100%',
  },
  eyeBtn: {
    padding: 6,
  },
  loginBtn: {
    backgroundColor: '#1E63EC',
    borderRadius: 8,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
    shadowColor: '#1E63EC',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 3,
  },
  loginBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  toggleBtn: {
    alignItems: 'center',
    marginTop: 20,
    paddingVertical: 8,
  },
  toggleText: {
    color: '#718096',
    fontSize: 14,
  },
  toggleTextBold: {
    color: '#1E63EC',
    fontWeight: 'bold',
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
