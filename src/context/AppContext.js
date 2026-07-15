import React, { createContext, useState, useEffect, useContext } from 'react';
import { 
  initializeDatabase, 
  authenticateUser, 
  fetchProducts, 
  fetchSettings, 
  saveSettings, 
  fetchSalesHistory, 
  fetchDashboardStats,
  fetchDashboardDetails
} from '../database/db';
import { checkNetworkAndSync, getSyncQueueCount } from '../database/syncService';
import { isSupabaseConfigured } from '../database/supabaseClient';
import * as Network from 'expo-network';

const AppContext = createContext();

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

  // Inicializar o banco de dados local
  useEffect(() => {
    async function setupDb() {
      await initializeDatabase();
      setDbReady(true);
      // Processar fila de sync pendente (operações offline anteriores)
      checkNetworkAndSync().catch(err =>
        console.warn('[AppContext] Erro no sync inicial:', err)
      );
    }
    setupDb();
  }, []);

  // Atualiza o status de sync depois que o banco estiver pronto e a cada 15s
  useEffect(() => {
    if (!dbReady) return;
    refreshSyncStatus();
    const id = setInterval(refreshSyncStatus, 15000);
    return () => clearInterval(id);
  }, [dbReady]);

  // Carregar dados gerais quando o banco estiver pronto ou quando o usuário logar
  useEffect(() => {
    if (dbReady && user) {
      loadAllData();
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
    const list = await fetchProducts();
    setProducts(list);
  };

  const loadSettings = async () => {
    const currentSettings = await fetchSettings();
    setSettings(currentSettings);
  };

  const loadSalesHistory = async () => {
    const list = await fetchSalesHistory();
    setSales(list);
  };

  const loadDashboardStats = async () => {
    const stats = await fetchDashboardStats();
    setDashboardStats(stats);
  };

  const loadDashboardDetails = async () => {
    const details = await fetchDashboardDetails();
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

  const handleUpdateSettings = async (cmv, opex, lucro, oscbrUsuario = null, oscbrSenha = null) => {
    await saveSettings(cmv, opex, lucro, oscbrUsuario, oscbrSenha);
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

  // Recarrega todos os dados do banco (útil após inserções ou atualizações)
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

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp deve ser usado dentro de um AppProvider');
  }
  return context;
}
