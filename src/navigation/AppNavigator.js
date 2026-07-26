import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';

// Telas do Aplicativo
import LoginScreen from '../screens/LoginScreen';
import DashboardScreen from '../screens/DashboardScreen';
import ProductsScreen from '../screens/ProductsScreen';
import NewSaleScreen from '../screens/NewSaleScreen';
import ReportsScreen from '../screens/ReportsScreen';
import DailyClosingScreen from '../screens/DailyClosingScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

// Bottom Tab Navigator para o fluxo logado do LucroCerto
function AppTabs() {
  const { user } = useApp();
  const isGerente = user?.cargo === 'gerente';

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarIcon: ({ focused, color, size }) => {
          let iconName;

          if (route.name === 'Início') {
            iconName = focused ? 'home' : 'home-outline';
          } else if (route.name === 'Produtos') {
            iconName = focused ? 'cube' : 'cube-outline';
          } else if (route.name === 'Venda') {
            iconName = focused ? 'document-text' : 'document-text-outline';
          } else if (route.name === 'Relatórios') {
            iconName = focused ? 'bar-chart' : 'bar-chart-outline';
          } else if (route.name === 'Caixa') {
            iconName = focused ? 'cash' : 'cash-outline';
          }

          return <Ionicons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: '#6366F1', // Indigo 500
        tabBarInactiveTintColor: '#64748B', // Slate 400
        tabBarStyle: {
          backgroundColor: '#1E293B', // Slate 800
          borderTopColor: '#334155', // Slate 700
          height: 64,
          paddingBottom: 8,
          paddingTop: 8,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
      })}
    >
      <Tab.Screen name="Início" component={DashboardScreen} />
      <Tab.Screen name="Produtos" component={ProductsScreen} />
      <Tab.Screen name="Venda" component={NewSaleScreen} />
      {isGerente && <Tab.Screen name="Relatórios" component={ReportsScreen} />}
      {isGerente && <Tab.Screen name="Caixa" component={DailyClosingScreen} />}
    </Tab.Navigator>
  );
}

// Stack principal com tratamento dinâmico de Login
export default function AppNavigator() {
  const { user } = useApp();

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {user ? (
        <Stack.Screen name="MainApp" component={AppTabs} />
      ) : (
        <Stack.Screen name="Login" component={LoginScreen} />
      )}
    </Stack.Navigator>
  );
}
