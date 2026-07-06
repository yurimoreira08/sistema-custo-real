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

const AppContext = createContext();

export function AppProvider({ children }) {
  const [dbReady, setDbReady] = useState(false);
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
    }
    setupDb();
  }, []);

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

  const handleUpdateSettings = async (cmv, opex, lucro) => {
    await saveSettings(cmv, opex, lucro);
    await loadSettings();
    await loadDashboardStats();
    await loadDashboardDetails();
  };

  // Recarrega todos os dados do banco (útil após inserções ou atualizações)
  const refreshData = async () => {
    await loadProducts();
    await loadSalesHistory();
    await loadDashboardStats();
    await loadDashboardDetails();
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
        loadProducts
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
