import React, { createContext, useState, useEffect, useContext } from 'react';
import { 
  initializeDatabase, 
  authenticateUser, 
  fetchProducts, 
  fetchSettings, 
  saveSettings, 
  fetchSalesHistory, 
  fetchDashboardStats,
  fetchDashboardDetails,
  syncActiveUser
} from '../database/db';
import { checkNetworkAndSync, getSyncQueueCount } from '../database/syncService';
import { isSupabaseConfigured } from '../database/supabaseClient';
import * as Network from 'expo-network';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const AppContext = createContext();

// Provedor de contexto global do aplicativo responsável pelo estado geral e sincronização
export function AppProvider({ children }) {
  const [dbReady, setDbReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState({
    pendingCount: 0,
    isOnline: true,
    isSyncing: false,
    configured: false,
  });
  const [user, setUser] = useState(null);
  const [products, setProducts] = useState([]);
  const [settings, setSettings] = useState({ percentual_cmv: 60.0, percentual_opex: 20.0, percentual_lucro: 20.0 });
  const [sales, setSales] = useState([]);
  const [dashboardStats, setDashboardStats] = useState({
    faturamentoTotal: 0,
    totalCmv: 0,
    totalOpex: 0,
    totalLucro: 0,
    lowStockCount: 0,
    lowStockProducts: [],
    totalProducts: 0,
    totalSales: 0
  });
  const [dashboardDetails, setDashboardDetails] = useState({
    vendasHoje: 0,
    transacoesHoje: 0,
    itensVendidosHoje: 0,
    estoqueBaixoCount: 0,
    ultimasVendas: []
  });

  useEffect(() => {
    async function setupDb() {
      await initializeDatabase();
      
      try {
        const storedUser = await AsyncStorage.getItem('@user_session');
        if (storedUser) {
          setUser(JSON.parse(storedUser));
        }
      } catch (e) {
        console.warn('[AppContext] Erro ao recuperar sessão do AsyncStorage:', e);
      }

      setDbReady(true);
      checkNetworkAndSync().catch(err =>
        console.warn('[AppContext] Erro no sync inicial:', err)
      );
    }
    setupDb();
  }, []);

  useEffect(() => {
    const updateSession = async () => {
      try {
        if (user) {
          await AsyncStorage.setItem('@user_session', JSON.stringify(user));
        } else if (dbReady) {
          await AsyncStorage.removeItem('@user_session');
        }
      } catch (e) {
        console.warn('[AppContext] Erro ao persistir sessão:', e);
      }
    };
    updateSession();
  }, [user, dbReady]);

  useEffect(() => {
    if (!dbReady) return;

    const drainIfPending = async () => {
      try {
        const count = await getSyncQueueCount();
        if (count > 0) await checkNetworkAndSync();
      } catch (e) {}
      await refreshSyncStatus();
    };

    refreshSyncStatus();

    const intervalId = setInterval(drainIfPending, 15000);

    let netSub;
    try {
      netSub = Network.addNetworkStateListener((state) => {
        if (state.isConnected && state.isInternetReachable) {
          drainIfPending();
        } else {
          refreshSyncStatus();
        }
      });
    } catch (e) {}

    let appStateSub;
    try {
      appStateSub = AppState.addEventListener('change', (next) => {
        if (next === 'active') drainIfPending();
      });
    } catch (e) {}

    return () => {
      clearInterval(intervalId);
      netSub?.remove?.();
      appStateSub?.remove?.();
    };
  }, [dbReady]);

  useEffect(() => {
    if (dbReady && user) {
      syncActiveUser(user, setUser).then(() => {
        loadAllData();
      });
    }
  }, [dbReady, user]);

  const loadAllData = async () => {
    try {
      await Promise.all([
        loadProducts(),
        loadSettings(),
        loadSalesHistory(),
        loadDashboardStats(),
        loadDashboardDetails()
      ]);
    } catch (error) {
      console.error('Erro ao carregar dados gerais:', error);
    }
  };

  const loadProducts = async () => {
    if (!user) return;
    const list = await fetchProducts(user.gerente_id);
    setProducts(list);
  };

  const loadSettings = async () => {
    if (!user) return;
    const currentSettings = await fetchSettings(user.gerente_id);
    setSettings(currentSettings);
  };

  const loadSalesHistory = async () => {
    if (!user) return;
    const list = await fetchSalesHistory(user.gerente_id);
    setSales(list);
  };

  const loadDashboardStats = async () => {
    if (!user) return;
    const stats = await fetchDashboardStats(user.gerente_id);
    setDashboardStats(stats);
  };

  const loadDashboardDetails = async () => {
    if (!user) return;
    const details = await fetchDashboardDetails(user.gerente_id);
    setDashboardDetails(details);
  };

  const handleLogin = async (emailOrUsername, password) => {
    const loggedUser = await authenticateUser(emailOrUsername, password);
    if (loggedUser) {
      setUser(loggedUser);
      return true;
    }
    return false;
  };

  const handleLogout = () => {
    setUser(null);
  };

  const handleUpdateSettings = async (cmv, opex, lucro) => {
    if (!user) return;
    await saveSettings(cmv, opex, lucro, user.gerente_id);
    await loadSettings();
    await loadDashboardStats();
    await loadDashboardDetails();
  };

  const refreshSyncStatus = async () => {
    try {
      const configured = isSupabaseConfigured();
      const pendingCount = await getSyncQueueCount();
      let isOnline = true;
      try {
        const net = await Network.getNetworkStateAsync();
        isOnline = !!(net.isConnected && net.isInternetReachable);
      } catch (e) {}
      setSyncStatus((prev) => ({ ...prev, configured, pendingCount, isOnline }));
    } catch (e) {}
  };

  const forceSync = async () => {
    setSyncStatus((prev) => ({ ...prev, isSyncing: true }));
    try {
      await checkNetworkAndSync();
    } catch (e) {}
    await refreshSyncStatus();
    setSyncStatus((prev) => ({ ...prev, isSyncing: false }));
  };

  const refreshData = async () => {
    await loadProducts();
    await loadSalesHistory();
    await loadDashboardStats();
    await loadDashboardDetails();
    await refreshSyncStatus();
  };

  return (
    <AppContext.Provider
      value={{
        dbReady,
        user,
        products,
        settings,
        sales,
        dashboardStats,
        dashboardDetails,
        login: handleLogin,
        logout: handleLogout,
        updateSettings: handleUpdateSettings,
        refreshData,
        loadProducts,
        syncStatus,
        forceSync,
        refreshSyncStatus
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

// Hook personalizado para consumir o contexto do aplicativo
export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp deve ser usado dentro de um AppProvider');
  }
  return context;
}
