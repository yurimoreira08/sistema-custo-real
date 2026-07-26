import React, { useState, useCallback } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  ScrollView, 
  TouchableOpacity, 
  RefreshControl,
  FlatList,
  Dimensions,
  Image
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useApp } from '../context/AppContext';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import SyncBadge from '../components/SyncBadge';

export default function DashboardScreen() {
  const { user, logout, dashboardDetails, refreshData } = useApp();
  const [refreshing, setRefreshing] = useState(false);
  const navigation = useNavigation();

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshData();
    setRefreshing(false);
  }, [refreshData]);

  // Formatar valores monetários em R$
  const formatCurrency = (val) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(val || 0);
  };

  // Saudação de acordo com o horário do dia
  const getGreeting = () => {
    const hours = new Date().getHours();
    if (hours >= 6 && hours < 12) return 'Bom dia';
    if (hours >= 12 && hours < 18) return 'Boa tarde';
    return 'Boa noite';
  };

  // Formatar data: "Quinta, 4 de jun de 2026"
  const getFormattedDate = () => {
    const date = new Date();
    const weekdays = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    const months = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    
    const weekday = weekdays[date.getDay()];
    const day = date.getDate();
    const month = months[date.getMonth()];
    const year = date.getFullYear();
    
    return `${weekday}, ${day} de ${month} de ${year}`;
  };

  // Calcula o tempo decorrido amigável
  const getTimeElapsed = (dateString) => {
    const diffMs = new Date() - new Date(dateString);
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Agora mesmo';
    if (diffMins < 60) return `Há ${diffMins} min`;
    
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `Há ${diffHours} h`;
    
    const diffDays = Math.floor(diffHours / 24);
    return `Há ${diffDays} dias`;
  };

  const stats = dashboardDetails || {
    vendasHoje: 0,
    transacoesHoje: 0,
    itensVendidosHoje: 0,
    estoqueBaixoCount: 0,
    ultimasVendas: []
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <StatusBar style="light" />
      
      {/* Header Bar */}
      <View style={styles.header}>
        <View style={[styles.headerLeft, { flex: 1 }]}>
          <Image source={require('../../assets/logo_lucrocerto.png')} style={{ width: 28, height: 28, borderRadius: 6, marginRight: 8 }} />
          <Text style={[styles.headerTitle, { flexShrink: 1 }]} numberOfLines={1}>LucroCerto</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <SyncBadge />
          <TouchableOpacity style={styles.logoutBtn} onPress={logout}>
            <Text style={styles.logoutText}>Sair</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView 
        contentContainerStyle={styles.scrollContainer}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#1E63EC" />
        }
      >
        {/* Banner de Boas-Vindas */}
        <View style={styles.welcomeBanner}>
          <View style={styles.bannerInfo}>
            <Text style={styles.welcomeText}>
              {getGreeting()}, {user?.nome || 'Admin'}! 👋
            </Text>
            <Text style={styles.dateText}>{getFormattedDate()}</Text>
          </View>
          <Ionicons name="cart" size={72} color="rgba(255, 255, 255, 0.15)" style={styles.bannerCartIcon} />
        </View>

        {/* Grid de Cards (2x2) */}
        <View style={styles.gridContainer}>
          <View style={styles.gridRow}>
            {/* Card 1: Vendas Hoje */}
            <View style={styles.statCard}>
              <Text style={styles.cardEmoji}>💰</Text>
              <Text style={styles.cardLabel}>VENDAS HOJE</Text>
              <Text style={styles.cardValue}>{formatCurrency(stats.vendasHoje)}</Text>
              <View style={styles.badgeTrend}>
                <Text style={styles.badgeTrendText}>▲ 12% vs ontem</Text>
              </View>
            </View>

            {/* Card 2: Transações */}
            <View style={styles.statCard}>
              <Text style={styles.cardEmoji}>📄</Text>
              <Text style={styles.cardLabel}>TRANSAÇÕES</Text>
              <Text style={styles.cardValue}>{stats.transacoesHoje}</Text>
              <Text style={styles.cardSubtext}>pedidos hoje</Text>
            </View>
          </View>

          <View style={styles.gridRow}>
            {/* Card 3: Itens Vendidos */}
            <View style={styles.statCard}>
              <Text style={styles.cardEmoji}>📦</Text>
              <Text style={styles.cardLabel}>ITENS VENDIDOS</Text>
              <Text style={styles.cardValue}>{stats.itensVendidosHoje}</Text>
              <Text style={styles.cardSubtext}>unidades</Text>
            </View>

            {/* Card 4: Estoque Baixo */}
            <View style={styles.statCard}>
              <Text style={styles.cardEmoji}>⚠️</Text>
              <Text style={styles.cardLabel}>ESTOQUE BAIXO</Text>
              <Text style={[styles.cardValue, stats.estoqueBaixoCount > 0 && { color: '#D97706' }]}>
                {stats.estoqueBaixoCount}
              </Text>
              <Text style={[styles.cardSubtext, { color: '#D97706', fontWeight: 'bold' }]}>Atenção</Text>
            </View>
          </View>
        </View>

        {/* Título Seção Últimas Vendas */}
        <View style={styles.sectionHeader}>
          <View style={styles.sectionHeaderLeft}>
            <Text style={{ fontSize: 16, marginRight: 6 }}>📋</Text>
            <Text style={styles.sectionTitle}>Últimas Vendas</Text>
          </View>
          {user?.cargo === 'gerente' && (
            <TouchableOpacity onPress={() => navigation.navigate('Relatórios')}>
              <Text style={styles.historyLink}>Ver histórico →</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Card Azul Container de Vendas de Hoje */}
        <View style={styles.salesContainer}>
          <View style={styles.salesHeader}>
            <View style={styles.salesHeaderLeft}>
              <Text style={{ fontSize: 16, color: '#FFF', marginRight: 6 }}>📋</Text>
              <Text style={styles.salesHeaderTitle}>Vendas de Hoje</Text>
            </View>
            {user?.cargo === 'gerente' && (
              <TouchableOpacity style={styles.verTudoBtn} onPress={() => navigation.navigate('Relatórios')}>
                <Text style={styles.verTudoText}>Ver tudo</Text>
              </TouchableOpacity>
            )}
          </View>

          {stats.ultimasVendas.length === 0 ? (
            <View style={styles.emptySalesCard}>
              <Text style={styles.emptySalesText}>Nenhuma venda registrada hoje.</Text>
            </View>
          ) : (
            <View style={styles.salesList}>
              {stats.ultimasVendas.map((item, index) => (
                <View 
                  key={item.id.toString()} 
                  style={[
                    styles.saleItemRow, 
                    index === stats.ultimasVendas.length - 1 && { borderBottomWidth: 0 }
                  ]}
                >
                  <View style={styles.saleItemLeft}>
                    <View style={styles.saleIconBg}>
                      <Ionicons name="fast-food-outline" size={20} color="#1E63EC" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.saleItemTitle} numberOfLines={1}>{item.descricaoItens}</Text>
                      <Text style={styles.saleItemSubtitle} numberOfLines={1}>
                        {getTimeElapsed(item.data_venda)} — {item.totalQtdItens} itens
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.saleItemValue}>{formatCurrency(item.valor_total)}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#1E63EC', // Mantém o azul no topo seguro
  },
  header: {
    backgroundColor: '#1E63EC',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFF',
  },
  logoutBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 8,
  },
  logoutText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  scrollContainer: {
    backgroundColor: '#F0F4F8', // Cor de fundo cinza azulada idêntica à imagem
    padding: 16,
    paddingBottom: 32,
    flexGrow: 1,
  },
  welcomeBanner: {
    backgroundColor: '#1E63EC',
    borderRadius: 20,
    padding: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    position: 'relative',
    overflow: 'hidden',
    shadowColor: '#1E63EC',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  bannerInfo: {
    zIndex: 1,
  },
  welcomeText: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#FFF',
  },
  dateText: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
    marginTop: 6,
  },
  bannerCartIcon: {
    position: 'absolute',
    right: 16,
    bottom: -6,
    opacity: 0.15,
  },
  gridContainer: {
    gap: 12,
    marginBottom: 24,
  },
  gridRow: {
    flexDirection: 'row',
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
    minHeight: 115,
  },
  cardEmoji: {
    fontSize: 20,
    marginBottom: 6,
  },
  cardLabel: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#A0AEC0',
    letterSpacing: 0.5,
  },
  cardValue: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#2D3748',
    marginVertical: 4,
  },
  badgeTrend: {
    backgroundColor: '#DEF7EC',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
    marginTop: 'auto',
  },
  badgeTrendText: {
    color: '#03543F',
    fontSize: 10,
    fontWeight: 'bold',
  },
  cardSubtext: {
    color: '#718096',
    fontSize: 12,
    marginTop: 'auto',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2D3748',
  },
  historyLink: {
    color: '#1E63EC',
    fontSize: 14,
    fontWeight: '600',
  },
  salesContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 3,
  },
  salesHeader: {
    backgroundColor: '#1E63EC',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  salesHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  salesHeaderTitle: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: 'bold',
  },
  verTudoBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
  },
  verTudoText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  emptySalesCard: {
    padding: 24,
    alignItems: 'center',
  },
  emptySalesText: {
    color: '#718096',
    fontSize: 14,
  },
  salesList: {
    paddingHorizontal: 16,
  },
  saleItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2F7',
  },
  saleItemLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 12,
  },
  saleIconBg: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#EBF8FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  saleItemTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#2D3748',
  },
  saleItemSubtitle: {
    fontSize: 11,
    color: '#718096',
    marginTop: 2,
  },
  saleItemValue: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#2F855A', // Verde de faturamento
    flexShrink: 0,
    marginLeft: 8,
    textAlign: 'right',
  },
});
