import React from 'react';
import { StyleSheet, ActivityIndicator, View, Text, Image } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { AppProvider, useApp } from './src/context/AppContext';
import AppNavigator from './src/navigation/AppNavigator';
import { StatusBar } from 'expo-status-bar';

// Componente intermediário para aguardar a inicialização do banco SQLite
function MainContent() {
  const { dbReady } = useApp();

  if (!dbReady) {
    return (
      <View style={styles.loadingContainer}>
        <StatusBar style="light" />
        <Image 
          source={require('./assets/logo_lucrocerto.png')} 
          style={styles.loadingLogo}
          resizeMode="contain"
        />
        <ActivityIndicator size="large" color="#6366F1" style={{ marginTop: 20 }} />
        <Text style={styles.loadingText}>Inicializando LucroCerto...</Text>
        <Text style={styles.loadingSubtext}>Carregando banco de dados local</Text>
      </View>
    );
  }

  return <AppNavigator />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <NavigationContainer>
          <MainContent />
        </NavigationContainer>
      </AppProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0F172A', // Slate 900
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingLogo: {
    width: 120,
    height: 120,
    borderRadius: 24,
  },
  loadingText: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 16,
  },
  loadingSubtext: {
    color: '#64748B',
    fontSize: 14,
    marginTop: 6,
  },
});
