import React, { useState, useEffect, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import ConfirmationModal from '../components/ConfirmationModal';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  TextInput,
  Alert,
  ScrollView,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
  Image,
  ActivityIndicator
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useApp } from '../context/AppContext';
import {
  fetchReportData,
  fetchUsers,
  registerUser,
  deleteUser,
  apurarLucroReal,
  auditarConsistenciaContabil,
  auditarTodosProdutosKardex,
  fetchRelatorioPerdasAvariasDetalhado
} from '../database/db';
import { Ionicons } from '@expo/vector-icons';
import SyncBadge from '../components/SyncBadge';
import PaymentTaxConfigModal from '../components/PaymentTaxConfigModal';

const { width } = Dimensions.get('window');

const getDivergenciaMeta = (tipo) => {
  switch (tipo) {
    case 'DESCONTO_INCOERENTE':
      return {
        label: 'Desconto Incoerente',
        icon: 'pricetag-outline',
        badgeBg: '#FEFCBF',
        badgeText: '#744210',
        borderColor: '#D69E2E',
        hint: 'O total da venda não confere com o bruto menos o desconto cadastrado.'
      };
    case 'DIVERGENCIA_PAGAMENTO_TOTAL':
      return {
        label: 'Pagamento ≠ Total',
        icon: 'cash-outline',
        badgeBg: '#FED7D7',
        badgeText: '#9B1C1C',
        borderColor: '#E53E3E',
        hint: 'A soma das parcelas registradas diverge do valor total da venda.'
      };
    case 'TAXA_LIQUIDO_INCONSISTENTE':
      return {
        label: 'Taxa / Líquido',
        icon: 'calculator-outline',
        badgeBg: '#EBF8FF',
        badgeText: '#2B6CB0',
        borderColor: '#3182CE',
        hint: 'A soma do valor líquido com a taxa difere do valor bruto transacionado.'
      };
    case 'PAGAMENTO_CANCELADO_NAO_ESTORNADO':
      return {
        label: 'Estorno Pendente',
        icon: 'alert-circle-outline',
        badgeBg: '#FFF5F5',
        badgeText: '#C53030',
        borderColor: '#E53E3E',
        hint: 'A venda foi cancelada, mas ainda constam pagamentos ativos não estornados.'
      };
    case 'CANCELAMENTO_SEM_AUDITORIA':
      return {
        label: 'Sem Justificativa',
        icon: 'document-text-outline',
        badgeBg: '#FEEBC8',
        badgeText: '#7B341E',
        borderColor: '#DD6B20',
        hint: 'Venda marcada como cancelada sem registro de autorização gerencial.'
      };
    case 'ESTORNO_EXCEDE_TOTAL':
      return {
        label: 'Estorno em Excesso',
        icon: 'warning-outline',
        badgeBg: '#FED7D7',
        badgeText: '#742A2A',
        borderColor: '#E53E3E',
        hint: 'O montante total estornado ultrapassa o valor original da venda.'
      };
    default:
      return {
        label: 'Inconsistência',
        icon: 'alert-circle-outline',
        badgeBg: '#FED7D7',
        badgeText: '#9B1C1C',
        borderColor: '#FEB2B2',
        hint: 'Discrepância detectada na validação matemática dos registros.'
      };
  }
};

export default function ReportsScreen() {
  const { user, logout, settings, updateSettings, refreshData } = useApp();
  const [activeTab, setActiveTab] = useState('geral'); // 'geral' | 'perdas' | 'auditorias' | 'equipe'
  const [selectedPeriod, setSelectedPeriod] = useState(7);
  const [selectedCanalFilter, setSelectedCanalFilter] = useState('todos');
  const [selectedTipoPerdaFilter, setSelectedTipoPerdaFilter] = useState('todos');
  const [reportData, setReportData] = useState({
    receitaTotal: 0,
    custoTotal: 0,
    lucroTotal: 0,
    valorEstoque: 0,
    prevReceita: 0,
    chartData: []
  });
  const [lucroRealData, setLucroRealData] = useState(null);
  const [perdasReportData, setPerdasReportData] = useState(null);
  const [taxConfigModalVisible, setTaxConfigModalVisible] = useState(false);
  const [loading, setLoading] = useState(false);

  // Estados das Auditorias de Conformidade
  const [auditoriaContabilData, setAuditoriaContabilData] = useState(null);
  const [auditoriaContabilLoading, setAuditoriaContabilLoading] = useState(false);
  const [auditoriaKardexData, setAuditoriaKardexData] = useState(null);
  const [auditoriaKardexLoading, setAuditoriaKardexLoading] = useState(false);

  // Modais de Configurações e Equipe
  const [settingsModalVisible, setSettingsModalVisible] = useState(false);
  const [cmvPercent, setCmvPercent] = useState('');
  const [opexPercent, setOpexPercent] = useState('');
  const [lucroPercent, setLucroPercent] = useState('');

  const [usersList, setUsersList] = useState([]);
  const [teamModalVisible, setTeamModalVisible] = useState(false);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [memberToDelete, setMemberToDelete] = useState(null);
  const [newNome, setNewNome] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newSenha, setNewSenha] = useState('');
  const [newCargo, setNewCargo] = useState('balconista');
  const [showNewPassword, setShowNewPassword] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadReportDetails();
      loadTeamList();
    }, [selectedPeriod, selectedCanalFilter, selectedTipoPerdaFilter, user])
  );

  useEffect(() => {
    if (settings) {
      setCmvPercent(settings.percentual_cmv?.toString() || '60');
      setOpexPercent(settings.percentual_opex?.toString() || '20');
      setLucroPercent(settings.percentual_lucro?.toString() || '20');
    }
  }, [settings, settingsModalVisible]);

  const loadTeamList = async () => {
    if (user?.gerente_id) {
      try {
        const list = await fetchUsers(user.gerente_id);
        setUsersList(list || []);
      } catch (error) {
        console.error('Erro ao buscar lista de equipe:', error);
      }
    }
  };

  const loadReportDetails = async () => {
    setLoading(true);
    try {
      const dInicio = new Date();
      dInicio.setDate(dInicio.getDate() - selectedPeriod);
      const isoInicio = dInicio.toISOString();

      const [data, lucroReal, perdas] = await Promise.all([
        fetchReportData(selectedPeriod, user.gerente_id),
        apurarLucroReal(user.gerente_id, { dataInicio: isoInicio, canalVenda: selectedCanalFilter }),
        fetchRelatorioPerdasAvariasDetalhado(user.gerente_id, { dataInicio: isoInicio, tipoPerda: selectedTipoPerdaFilter })
      ]);
      setReportData(data || { receitaTotal: 0, custoTotal: 0, lucroTotal: 0, valorEstoque: 0, prevReceita: 0, chartData: [] });
      setLucroRealData(lucroReal);
      setPerdasReportData(perdas);
    } catch (error) {
      console.error('Erro ao carregar dados do relatório:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleExecutarAuditoriaContabil = async () => {
    if (!user?.gerente_id) return;
    setAuditoriaContabilLoading(true);
    try {
      const res = await auditarConsistenciaContabil(user.gerente_id);
      setAuditoriaContabilData(res);
      Alert.alert(
        res.statusGeral === 'CONFORME' ? '✅ Auditoria Contábil Aprovada' : '⚠️ Divergência Detectada',
        res.statusGeral === 'CONFORME'
          ? `Todas as ${res.totalVendasAuditadas} vendas e pagamentos foram auditados e estão 100% íntegros.`
          : `Foram encontradas ${res.vendasComDivergencia} divergências entre os registros de vendas/pagamentos.`
      );
    } catch (err) {
      Alert.alert('Erro', 'Falha ao executar auditoria contábil: ' + err.message);
    } finally {
      setAuditoriaContabilLoading(false);
    }
  };

  const handleExecutarAuditoriaKardex = async () => {
    if (!user?.gerente_id) return;
    setAuditoriaKardexLoading(true);
    try {
      const res = await auditarTodosProdutosKardex(user.gerente_id);
      setAuditoriaKardexData(res);
      Alert.alert(
        res.statusGeral === 'CONFORME' ? '✅ Kardex Íntegro' : '⚠️ Divergência de Estoque',
        res.statusGeral === 'CONFORME'
          ? `Todos os ${res.totalProdutosAuditados} produtos auditados têm saldo físico estritamente idêntico ao histórico de movimentações.`
          : `Foram encontradas divergências em ${res.produtosComDivergencia} produto(s).`
      );
    } catch (err) {
      Alert.alert('Erro', 'Falha ao executar auditoria de Kardex: ' + err.message);
    } finally {
      setAuditoriaKardexLoading(false);
    }
  };

  const parseNum = (str) => parseFloat((str || '').toString().replace(',', '.')) || 0;
  const currentSum = parseNum(cmvPercent) + parseNum(opexPercent) + parseNum(lucroPercent);
  const isSumValid = currentSum === 100;

  const formatCurrency = (val) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(val || 0);
  };

  const margemPercent = (reportData && reportData.receitaTotal > 0 && reportData.lucroTotal != null)
    ? ((Number(reportData.lucroTotal) / Number(reportData.receitaTotal)) * 100).toFixed(1)
    : '0.0';

  const custoPercent = (reportData && reportData.receitaTotal > 0 && reportData.custoTotal != null)
    ? ((Number(reportData.custoTotal) / Number(reportData.receitaTotal)) * 100).toFixed(1)
    : '0.0';

  const getReceitaTrend = () => {
    const curr = Number(reportData?.receitaTotal || 0);
    const prev = Number(reportData?.prevReceita || 0);
    if (prev === 0) return '▲ 100% vs anterior';

    const diff = curr - prev;
    const pct = ((diff / prev) * 100).toFixed(1);
    if (diff >= 0) {
      return `▲ ${pct}% vs anterior`;
    } else {
      return `▼ ${Math.abs(pct)}% vs anterior`;
    }
  };

  const handleSaveSettings = async () => {
    const cmv = parseNum(cmvPercent);
    const opex = parseNum(opexPercent);
    const lucro = parseNum(lucroPercent);

    if (cmv < 0 || opex < 0 || lucro < 0) {
      Alert.alert('Erro', 'As porcentagens não podem ser negativas.');
      return;
    }

    if (cmv + opex + lucro !== 100) {
      Alert.alert('Erro de Balanço', 'A soma das carteiras deve ser exatamente 100%.');
      return;
    }

    try {
      await updateSettings(cmv, opex, lucro);
      Alert.alert('Sucesso', 'Configurações atualizadas com sucesso!');
      setSettingsModalVisible(false);
      await refreshData();
      await loadReportDetails();
    } catch (error) {
      Alert.alert('Erro', 'Não foi possível salvar as configurações.');
    }
  };

  const handleAddTeamMember = async () => {
    if (!newNome.trim() || !newEmail.trim() || !newSenha.trim()) {
      Alert.alert('Erro', 'Por favor, preencha todos os campos obrigatórios.');
      return;
    }

    try {
      await registerUser(newNome, newEmail, newSenha, newCargo, user.gerente_id);
      Alert.alert('Sucesso', 'Funcionário cadastrado com sucesso!');
      setTeamModalVisible(false);
      setNewNome('');
      setNewEmail('');
      setNewSenha('');
      setNewCargo('balconista');
      await loadTeamList();
    } catch (error) {
      Alert.alert('Erro no Cadastro', error.message || 'Ocorreu um erro.');
    }
  };

  const handleDeleteTeamMember = (id, nome) => {
    setMemberToDelete({ id, nome });
    setDeleteModalVisible(true);
  };

  const chartPoints = reportData.chartData || [];
  const maxVal = Math.max(...chartPoints.map(item => Math.max(item.receita, item.custo)), 100);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <StatusBar style="light" />

      {/* Header Compacto e Responsivo */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Image source={require('../../assets/logo_lucrocerto.png')} style={styles.headerLogo} />
          <View style={styles.headerTitleCol}>
            <Text style={styles.headerTitle} numberOfLines={1}>LucroCerto</Text>
            <Text style={styles.headerSubtitle} numberOfLines={1}>Painel Gerencial</Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          <SyncBadge />
          <TouchableOpacity
            style={styles.headerIconBtn}
            onPress={() => setTaxConfigModalVisible(true)}
            accessibilityLabel="Configurar Taxas de Pagamento"
          >
            <Ionicons name="card" size={17} color="#1E63EC" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerIconBtn}
            onPress={() => setSettingsModalVisible(true)}
            accessibilityLabel="Configurações Globais"
          >
            <Ionicons name="settings-sharp" size={17} color="#1E63EC" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.logoutBtn}
            onPress={logout}
            accessibilityLabel="Sair do aplicativo"
          >
            <Ionicons name="log-out-outline" size={16} color="#FFFFFF" />
            <Text style={styles.logoutText}>Sair</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Barra de Navegação por Abas (Segmented Control Elegante com Alto Contraste) */}
      <View style={styles.tabBarWrapper}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabBarScroll}>
          <TouchableOpacity
            style={[styles.tabItem, activeTab === 'geral' && styles.tabItemActive]}
            onPress={() => setActiveTab('geral')}
          >
            <Ionicons name="stats-chart" size={20} color={activeTab === 'geral' ? '#1E63EC' : '#FFFFFF'} />
            <Text style={[styles.tabItemText, activeTab === 'geral' && styles.tabItemTextActive]}>Visão Geral</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabItem, activeTab === 'perdas' && styles.tabItemActive]}
            onPress={() => setActiveTab('perdas')}
          >
            <Ionicons name="alert-circle" size={20} color={activeTab === 'perdas' ? '#E53E3E' : '#FFFFFF'} />
            <Text style={[styles.tabItemText, activeTab === 'perdas' && styles.tabItemTextActive]}>Perdas & Avarias</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabItem, activeTab === 'auditorias' && styles.tabItemActive]}
            onPress={() => setActiveTab('auditorias')}
          >
            <Ionicons name="shield-checkmark" size={20} color={activeTab === 'auditorias' ? '#1E63EC' : '#FFFFFF'} />
            <Text style={[styles.tabItemText, activeTab === 'auditorias' && styles.tabItemTextActive]}>Auditorias</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabItem, activeTab === 'equipe' && styles.tabItemActive]}
            onPress={() => setActiveTab('equipe')}
          >
            <Ionicons name="people" size={20} color={activeTab === 'equipe' ? '#1E63EC' : '#FFFFFF'} />
            <Text style={[styles.tabItemText, activeTab === 'equipe' && styles.tabItemTextActive]}>Equipe</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
        {loading && (
          <View style={styles.loadingBanner}>
            <ActivityIndicator size="small" color="#1E63EC" style={{ marginRight: 8 }} />
            <Text style={styles.loadingBannerText}>Atualizando dados consolidados...</Text>
          </View>
        )}

        {/* ======================================================== */}
        {/* ABA 1: VISÃO GERAL (Métricas, Gráfico e Lucro Real)      */}
        {/* ======================================================== */}
        {activeTab === 'geral' && (
          <View>
            {/* Filtro de Período */}
            <View style={styles.periodFilterContainer}>
              <ScrollView
                horizontal={true}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.periodScroll}
              >
                {[
                  { days: 7, label: '7 dias' },
                  { days: 30, label: '30 dias' },
                  { days: 90, label: '3 meses' },
                  { days: 180, label: '6 meses' },
                  { days: 365, label: '1 ano' }
                ].map(p => (
                  <TouchableOpacity
                    key={p.days}
                    style={[styles.periodBtn, selectedPeriod === p.days && styles.periodBtnActive]}
                    onPress={() => setSelectedPeriod(p.days)}
                  >
                    <Text style={[styles.periodBtnText, selectedPeriod === p.days && styles.periodBtnTextActive]}>
                      {p.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            {/* Grid de 4 Cards com tipografia protegida */}
            <View style={styles.gridContainer}>
              <View style={styles.gridRow}>
                {/* Card 1: Lucro Líquido */}
                <View style={[styles.card, styles.blueCard]}>
                  <View style={styles.cardHeaderSmall}>
                    <View style={styles.metricIconBoxWhite}>
                      <Ionicons name="wallet" size={18} color="#1E63EC" />
                    </View>
                    <View style={styles.blueCardBadge}>
                      <Text style={styles.blueCardBadgeText}>{margemPercent}%</Text>
                    </View>
                  </View>
                  <Text style={[styles.cardLabel, { color: 'rgba(255,255,255,0.85)' }]}>LUCRO LÍQUIDO</Text>
                  <Text style={[styles.cardValue, { color: '#FFF' }]} numberOfLines={1} adjustsFontSizeToFit>
                    {formatCurrency(reportData.lucroTotal)}
                  </Text>
                  <Text style={styles.blueCardSubtitle}>Margem de {margemPercent}%</Text>
                </View>

                {/* Card 2: Receita Total */}
                <View style={styles.card}>
                  <View style={styles.cardHeaderSmall}>
                    <View style={[styles.metricIconBox, { backgroundColor: '#DEF7EC' }]}>
                      <Ionicons name="trending-up" size={18} color="#03543F" />
                    </View>
                    <View style={styles.greenBadge}>
                      <Text style={styles.greenBadgeText}>{getReceitaTrend()}</Text>
                    </View>
                  </View>
                  <Text style={styles.cardLabel}>RECEITA TOTAL</Text>
                  <Text style={styles.cardValue} numberOfLines={1} adjustsFontSizeToFit>
                    {formatCurrency(reportData.receitaTotal)}
                  </Text>
                  <Text style={styles.cardSubtext}>Período selecionado</Text>
                </View>
              </View>

              <View style={styles.gridRow}>
                {/* Card 3: Custo Total */}
                <View style={styles.card}>
                  <View style={styles.cardHeaderSmall}>
                    <View style={[styles.metricIconBox, { backgroundColor: '#FDE8E8' }]}>
                      <Ionicons name="pie-chart" size={18} color="#9B1C1C" />
                    </View>
                    <View style={styles.redBadge}>
                      <Text style={styles.redBadgeText}>{custoPercent}% rec.</Text>
                    </View>
                  </View>
                  <Text style={styles.cardLabel}>CUSTO TOTAL</Text>
                  <Text style={styles.cardValue} numberOfLines={1} adjustsFontSizeToFit>
                    {formatCurrency(reportData.custoTotal)}
                  </Text>
                  <Text style={styles.cardSubtext}>CMV + Custos</Text>
                </View>

                {/* Card 4: Valor em Estoque */}
                <View style={styles.card}>
                  <View style={styles.cardHeaderSmall}>
                    <View style={[styles.metricIconBox, { backgroundColor: '#EBF8FF' }]}>
                      <Ionicons name="cube" size={18} color="#2B6CB0" />
                    </View>
                    <View style={styles.neutralBadge}>
                      <Text style={styles.neutralBadgeText}>Ativo</Text>
                    </View>
                  </View>
                  <Text style={styles.cardLabel}>VALOR EM ESTOQUE</Text>
                  <Text style={styles.cardValue} numberOfLines={1} adjustsFontSizeToFit>
                    {formatCurrency(reportData.valorEstoque)}
                  </Text>
                  <Text style={styles.cardSubtext}>Saldo físico atual</Text>
                </View>
              </View>
            </View>

            {/* Gráfico de Barras com Card Próprio e Isolado */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>📈 Comparativo: Receita vs Custo</Text>
            </View>

            <View style={styles.chartCard}>
              <View style={styles.legendRow}>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: '#1E63EC' }]} />
                  <Text style={styles.legendText}>Receita</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: '#ED8936' }]} />
                  <Text style={styles.legendText}>Custo</Text>
                </View>
              </View>

              {chartPoints.length === 0 ? (
                <View style={styles.emptyChart}>
                  <Ionicons name="bar-chart-outline" size={32} color="#CBD5E0" />
                  <Text style={styles.emptyChartText}>Sem movimentações no período selecionado.</Text>
                </View>
              ) : (
                <View style={styles.chartArea}>
                  <View style={styles.gridLinesContainer}>
                    <View style={styles.gridLine} />
                    <View style={styles.gridLine} />
                    <View style={styles.gridLine} />
                    <View style={styles.gridLine} />
                  </View>

                  <View style={styles.barsContainer}>
                    {chartPoints.map((item, index) => {
                      const heightReceita = Math.max((item.receita / maxVal) * 90, 4);
                      const heightCusto = Math.max((item.custo / maxVal) * 90, 4);

                      return (
                        <View key={index.toString()} style={styles.chartCol}>
                          <View style={styles.barsPair}>
                            <View style={[styles.chartBar, { height: heightReceita, backgroundColor: '#1E63EC' }]} />
                            <View style={[styles.chartBar, { height: heightCusto, backgroundColor: '#ED8936' }]} />
                          </View>
                          <Text style={styles.chartLabel} numberOfLines={1}>{item.label}</Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              )}
            </View>

            {/* Motor de Lucro Real e Canais */}
            <View style={styles.sectionHeaderWithAction}>
              <View style={styles.sectionHeaderLeft}>
                <Text style={styles.sectionTitle} numberOfLines={1}>💰 Lucro Real & Canais</Text>
              </View>
              <TouchableOpacity
                style={styles.actionChipBtn}
                onPress={() => setTaxConfigModalVisible(true)}
                accessibilityLabel="Configurar Taxas das Formas"
              >
                <Ionicons name="card-outline" size={13} color="#1E63EC" />
                <Text style={styles.actionChipBtnText}>Taxas</Text>
              </TouchableOpacity>
            </View>

            {/* Filtro de Canais em Scroll Horizontal com todos os canais visíveis e sem quebra */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.channelScrollContainer}>
              {[
                { id: 'todos', label: 'Todos' },
                { id: 'balcao', label: '🏪 Balcão' },
                { id: 'delivery', label: '🛵 Delivery' },
                { id: 'encomenda', label: '📦 Encomenda' },
              ].map((canal) => (
                <TouchableOpacity
                  key={canal.id}
                  style={[
                    styles.channelChip,
                    selectedCanalFilter === canal.id && styles.channelChipActive,
                  ]}
                  onPress={() => setSelectedCanalFilter(canal.id)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.channelChipText,
                      selectedCanalFilter === canal.id && styles.channelChipTextActive,
                    ]}
                    numberOfLines={1}
                  >
                    {canal.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {lucroRealData && (
              <View style={styles.lucroRealContainer}>
                {/* Card Demonstrativo de Resultado */}
                <View style={styles.lucroRealSummaryCard}>
                  <View style={styles.lrCardHeader}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Ionicons name="document-text-outline" size={17} color="#1E63EC" />
                      <Text style={styles.lrCardTitle}>Demonstrativo de Resultado Líquido</Text>
                    </View>
                    <View style={styles.lrStatusBadge}>
                      <Text style={styles.lrStatusBadgeText}>Apurado</Text>
                    </View>
                  </View>

                  {/* Linha 1: Faturamento Elegível */}
                  <View style={styles.lrItemRow}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                      <View style={[styles.lrMiniIcon, { backgroundColor: '#DEF7EC' }]}>
                        <Ionicons name="trending-up" size={14} color="#03543F" />
                      </View>
                      <Text style={styles.lrItemLabel}>Faturamento Elegível</Text>
                    </View>
                    <Text style={styles.lrValGreen}>{formatCurrency(lucroRealData.faturamentoElegivel)}</Text>
                  </View>

                  {/* Linha 2: Custo das Mercadorias (CMV) */}
                  <View style={styles.lrItemRow}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                      <View style={[styles.lrMiniIcon, { backgroundColor: '#FEEBC8' }]}>
                        <Ionicons name="cube-outline" size={14} color="#C05621" />
                      </View>
                      <Text style={styles.lrItemLabel}>(-) Custo Mercadorias (CMV)</Text>
                    </View>
                    <Text style={styles.lrValOrange}>- {formatCurrency(lucroRealData.cmvEfetivo ?? lucroRealData.cmvTotal ?? 0)}</Text>
                  </View>

                  {/* Linha 3: Taxas Operacionais de Meios */}
                  <View style={styles.lrItemRow}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                      <View style={[styles.lrMiniIcon, { backgroundColor: '#FED7D7' }]}>
                        <Ionicons name="card-outline" size={14} color="#C53030" />
                      </View>
                      <Text style={styles.lrItemLabel}>(-) Taxas das Formas</Text>
                    </View>
                    <Text style={styles.lrValRed}>- {formatCurrency(lucroRealData.taxasOperacionais ?? 0)}</Text>
                  </View>

                  {/* Bloco de Destaque: Resultado após CMV e Taxas */}
                  {(() => {
                    const resLucro = Number(lucroRealData.resultadoAposCmvTaxas ?? lucroRealData.resultadoAposCmvETaxas ?? 0);
                    const isPos = resLucro >= 0;
                    return (
                      <View style={[styles.lrHighlightBox, isPos ? styles.lrHighlightBoxPositive : styles.lrHighlightBoxNegative]}>
                        <View style={styles.lrHighlightTop}>
                          <Text style={styles.lrHighlightLabel}>Resultado após CMV e Taxas</Text>
                          <View style={[styles.lrMargemBadge, isPos ? styles.lrMargemBadgePositive : styles.lrMargemBadgeNegative]}>
                            <Text style={[styles.lrMargemBadgeText, isPos ? { color: '#2B6CB0' } : { color: '#9B1C1C' }]}>
                              Margem: {lucroRealData.margemPercentual ?? lucroRealData.margemContribuicaoPercent ?? 0}%
                            </Text>
                          </View>
                        </View>
                        <Text style={[styles.lrValBig, isPos ? styles.textPositive : styles.textNegative]}>
                          {formatCurrency(resLucro)}
                        </Text>
                      </View>
                    );
                  })()}
                </View>

                {/* Detalhamento por Canal */}
                {(() => {
                  const formatarCanal = (c) => {
                    const s = String(c || '').toLowerCase().trim();
                    if (s === 'balcao' || s.includes('balc')) return '🏪 Balcão';
                    if (s === 'delivery' || s.includes('deliv')) return '🛵 Delivery';
                    if (s === 'encomenda' || s.includes('encom')) return '📦 Encomenda';
                    return c || '🏪 Balcão';
                  };

                  const canaisLista = lucroRealData.canais || Object.values(lucroRealData.porCanal || {});

                  return (
                    <View style={styles.channelBreakdownCard}>
                      <View style={styles.channelCardHeader}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Ionicons name="pie-chart-outline" size={16} color="#1E63EC" />
                          <Text style={styles.channelBreakdownTitle}>Detalhamento por Canal de Venda</Text>
                        </View>
                        <View style={styles.channelCountBadge}>
                          <Text style={styles.channelCountBadgeText}>
                            {canaisLista.length} {canaisLista.length === 1 ? 'canal' : 'canais'}
                          </Text>
                        </View>
                      </View>

                      {canaisLista.length === 0 ? (
                        <View style={styles.channelEmptyBox}>
                          <Ionicons name="bicycle-outline" size={28} color="#94A3B8" style={{ marginBottom: 4 }} />
                          <Text style={styles.channelEmptyText}>
                            Nenhuma venda registrada no canal {formatarCanal(selectedCanalFilter)} no período selecionado.
                          </Text>
                        </View>
                      ) : (
                        <View style={{ gap: 10 }}>
                          {canaisLista.map((dados, idx) => {
                            const canalNome = dados.canal || `Canal ${idx + 1}`;
                            const fat = dados.faturamentoElegivel ?? dados.faturamento ?? 0;
                            const cmv = dados.cmv ?? 0;
                            const taxas = dados.taxas ?? 0;
                            const res = dados.resultadoAposCmvTaxas ?? dados.resultado ?? 0;
                            const isPos = res >= 0;

                            return (
                              <View key={canalNome + idx} style={styles.channelCardItem}>
                                {/* Linha 1: Nome do Canal e Resultado Líquido */}
                                <View style={styles.channelItemHeader}>
                                  <Text style={styles.channelNameText}>
                                    {formatarCanal(canalNome)}
                                  </Text>
                                  <View style={[styles.channelResPill, isPos ? styles.channelResPillPos : styles.channelResPillNeg]}>
                                    <Text style={[styles.channelResText, isPos ? styles.textPositive : styles.textNegative]}>
                                      {isPos ? '+' : ''}{formatCurrency(res)}
                                    </Text>
                                  </View>
                                </View>

                                {/* Linha 2: Grid Organizado das 3 Métricas */}
                                <View style={styles.channelMetricsGrid}>
                                  <View style={styles.channelMetricCol}>
                                    <Text style={styles.channelMetricLabel}>Fat. Elegível</Text>
                                    <Text style={styles.channelMetricVal}>{formatCurrency(fat)}</Text>
                                  </View>
                                  <View style={styles.channelMetricCol}>
                                    <Text style={styles.channelMetricLabel}>(-) CMV</Text>
                                    <Text style={[styles.channelMetricVal, { color: '#DD6B20' }]}>- {formatCurrency(cmv)}</Text>
                                  </View>
                                  <View style={styles.channelMetricCol}>
                                    <Text style={styles.channelMetricLabel}>(-) Taxas</Text>
                                    <Text style={[styles.channelMetricVal, { color: '#E53E3E' }]}>- {formatCurrency(taxas)}</Text>
                                  </View>
                                </View>
                              </View>
                            );
                          })}
                        </View>
                      )}
                    </View>
                  );
                })()}

                <View style={styles.accountingDisclaimerBox}>
                  <Ionicons name="information-circle-outline" size={18} color="#4A5568" style={{ marginRight: 6 }} />
                  <Text style={styles.accountingDisclaimerText}>
                    {lucroRealData.avisoContabil || 'Métrica apurada conforme regras de conformidade contábil.'}
                  </Text>
                </View>
              </View>
            )}
          </View>
        )}

        {/* ======================================================== */}
        {/* ABA 2: PERDAS E AVARIAS                                  */}
        {/* ======================================================== */}
        {activeTab === 'perdas' && (
          <View>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>⚠️ Relatório de Perdas e Avarias</Text>
              <Text style={styles.sectionSubtitle}>
                Baixas por avaria, quebra, extravio, furto ou validade apuradas ao Preço Médio Ponderado (PMP).
              </Text>
            </View>

            {/* Filtros em Pílulas */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterPillScrollView}>
              {['todos', 'quebra', 'avaria', 'extravio', 'furto', 'vencimento'].map((tipo) => (
                <TouchableOpacity
                  key={tipo}
                  style={[styles.filterPill, selectedTipoPerdaFilter === tipo && styles.filterPillActive]}
                  onPress={() => setSelectedTipoPerdaFilter(tipo)}
                >
                  <Text style={[styles.filterPillText, selectedTipoPerdaFilter === tipo && styles.filterPillTextActive]}>
                    {tipo === 'todos' ? 'Todos os Tipos' : tipo.charAt(0).toUpperCase() + tipo.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {perdasReportData && (
              <View style={styles.perdasContainer}>
                {/* 2 Cards Resumo */}
                <View style={styles.gridRow}>
                  <View style={[styles.card, { backgroundColor: '#FFF5F5', borderColor: '#FEB2B2' }]}>
                    <View style={styles.cardHeaderSmall}>
                      <View style={[styles.metricIconBox, { backgroundColor: '#FED7D7' }]}>
                        <Ionicons name="trending-down" size={18} color="#C53030" />
                      </View>
                    </View>
                    <Text style={[styles.cardLabel, { color: '#E53E3E' }]}>IMPACTO FINANCEIRO</Text>
                    <Text style={[styles.cardValue, { color: '#9B1C1C' }]} numberOfLines={1} adjustsFontSizeToFit>
                      {formatCurrency(perdasReportData.impactoFinanceiroTotal ?? perdasReportData.totalPerdasFinanceiras ?? 0)}
                    </Text>
                    <Text style={styles.cardSubtext}>
                      {perdasReportData.totalPerdasRegistradas ?? perdasReportData.totalRegistros ?? 0} ocorrências
                    </Text>
                  </View>

                  <View style={styles.card}>
                    <View style={styles.cardHeaderSmall}>
                      <View style={[styles.metricIconBox, { backgroundColor: '#EDF2F7' }]}>
                        <Ionicons name="cube-outline" size={18} color="#4A5568" />
                      </View>
                    </View>
                    <Text style={styles.cardLabel}>ITENS BAIXADOS</Text>
                    <Text style={styles.cardValue} numberOfLines={1} adjustsFontSizeToFit>
                      {Number(perdasReportData.quantidadeItensPerdidos ?? perdasReportData.totalItensPerdidos ?? 0).toFixed(2)}
                    </Text>
                    <Text style={styles.cardSubtext}>Unidades totais</Text>
                  </View>
                </View>

                {/* Totais por Categoria */}
                {(perdasReportData.totaisPorCategoria || []).length > 0 && (
                  <View style={styles.perdasListCard}>
                    <Text style={styles.perdasListTitle}>🏷️ Impacto por Categoria de Produto</Text>
                    {perdasReportData.totaisPorCategoria.map((c) => (
                      <View key={c.categoria} style={styles.perdaRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.channelNameText}>{c.categoria}</Text>
                          <Text style={styles.perdaDetailText}>{c.quantidade} un. ({c.ocorrencias} ocorrências)</Text>
                        </View>
                        <Text style={styles.perdaImpactoText}>{formatCurrency(c.impactoTotal)}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* Lista de Registros com Card Elegante */}
                {(perdasReportData.perdas || perdasReportData.detalhes || []).length === 0 ? (
                  <View style={styles.emptyCardContainer}>
                    <Ionicons name="checkmark-done-circle-outline" size={42} color="#48BB78" />
                    <Text style={styles.emptyCardTitle}>Nenhuma perda registrada</Text>
                    <Text style={styles.emptyCardSubtitle}>Não há ocorrências de quebra ou avaria para o filtro selecionado.</Text>
                  </View>
                ) : (
                  <View style={styles.perdasListCard}>
                    <Text style={styles.perdasListTitle}>📋 Ocorrências Detalhadas com Custo Unitário</Text>
                    {(perdasReportData.perdas || perdasReportData.detalhes || []).map((perda, idx) => (
                      <View key={(perda.id || idx).toString()} style={styles.perdaItemBox}>
                        <View style={styles.perdaItemHeader}>
                          <View style={{ flex: 1, paddingRight: 8 }}>
                            <Text style={styles.perdaProdutoName}>
                              {perda.produto_nome || `Produto #${perda.produto_id}`}
                            </Text>
                            {perda.codigo_barras && (
                              <Text style={styles.perdaBarcodeText}>Cód: {perda.codigo_barras}</Text>
                            )}
                          </View>
                          <View style={styles.perdaTagBox}>
                            <Text style={styles.perdaTagText}>
                              {(perda.tipo_perda || perda.motivo_tipo || 'AVARIA').toUpperCase()}
                            </Text>
                          </View>
                        </View>

                        <View style={styles.perdaItemBody}>
                          <View style={styles.perdaItemMetric}>
                            <Text style={styles.perdaMetricLabel}>Quantidade:</Text>
                            <Text style={styles.perdaMetricValue}>{perda.quantidade} un.</Text>
                          </View>
                          <View style={styles.perdaItemMetric}>
                            <Text style={styles.perdaMetricLabel}>Custo Unitário:</Text>
                            <Text style={styles.perdaMetricValue}>{formatCurrency(perda.custo_unitario)}</Text>
                          </View>
                          <View style={styles.perdaItemMetric}>
                            <Text style={styles.perdaMetricLabel}>Prejuízo Total:</Text>
                            <Text style={[styles.perdaMetricValue, { color: '#E53E3E', fontWeight: 'bold' }]}>
                              - {formatCurrency(perda.impacto_financeiro)}
                            </Text>
                          </View>
                        </View>

                        <View style={styles.perdaItemFooter}>
                          <Text style={styles.perdaJustificativaText}>
                            💬 <Text style={{ fontStyle: 'italic' }}>"{perda.justificativa || 'Sem justificativa informada'}"</Text>
                          </Text>
                          <View style={styles.perdaFooterMeta}>
                            <Text style={styles.perdaMetaText}>
                              👤 {perda.usuario_nome || 'Sistema'}
                            </Text>
                            <Text style={styles.perdaMetaText}>
                              📅 {new Date(perda.data_perda || perda.data_movimento || perda.created_at || Date.now()).toLocaleDateString('pt-BR')}
                            </Text>
                          </View>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )}
          </View>
        )}

        {/* ======================================================== */}
        {/* ABA 3: AUDITORIAS DE CONFORMIDADE                        */}
        {/* ======================================================== */}
        {activeTab === 'auditorias' && (
          <View>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>⚖️ Auditorias de Conformidade</Text>
              <Text style={styles.sectionSubtitle}>
                Validação contábil, conferência de centavos, taxas de vendas e reconstituição do Kardex.
              </Text>
            </View>

            {/* Painel 1: Auditoria Contábil */}
            <View style={styles.auditContainerCard}>
              <View style={styles.auditCardHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                  <View style={[styles.auditIconBadge, { backgroundColor: '#EBF8FF' }]}>
                    <Ionicons name="calculator-outline" size={20} color="#2B6CB0" />
                  </View>
                  <View style={{ marginLeft: 10, flex: 1 }}>
                    <Text style={styles.auditCardTitle}>Auditoria Contábil e Arredondamento</Text>
                    <Text style={styles.auditCardSubtitle}>Validação de Taxas, Centavos e Arredondamento</Text>
                  </View>
                </View>
              </View>

              <Text style={styles.auditCardDesc}>
                Varre pagamentos mistos, taxas fixas/percentuais e estornos, garantindo precisão estrita de 2 casas decimais e isolamento de vendas canceladas.
              </Text>

              <TouchableOpacity
                style={[styles.auditButton, { backgroundColor: '#2B6CB0' }]}
                onPress={handleExecutarAuditoriaContabil}
                disabled={auditoriaContabilLoading}
              >
                {auditoriaContabilLoading ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <>
                    <Ionicons name="play-outline" size={18} color="#FFF" style={{ marginRight: 6 }} />
                    <Text style={styles.auditButtonText}>Executar Auditoria Contábil</Text>
                  </>
                )}
              </TouchableOpacity>

              {auditoriaContabilData && (
                <View style={styles.auditResultBox}>
                  <View style={styles.auditResultTop}>
                    <Text style={styles.auditResultTitle}>Diagnóstico Financeiro:</Text>
                    <View style={auditoriaContabilData.statusGeral === 'CONFORME' ? styles.auditBadgeConforme : styles.auditBadgeDivergente}>
                      <Text style={styles.auditBadgeText}>
                        {auditoriaContabilData.statusGeral === 'CONFORME' ? '✓ 100% CONFORME' : '⚠ DIVERGÊNCIA'}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.auditGrid2Cols}>
                    <View style={styles.auditStatItem}>
                      <Text style={styles.auditStatLabel}>Vendas Auditadas</Text>
                      <Text style={styles.auditStatValue}>{auditoriaContabilData.totalVendasAuditadas}</Text>
                    </View>
                    <View style={styles.auditStatItem}>
                      <Text style={styles.auditStatLabel}>Vendas Conformes</Text>
                      <Text style={[styles.auditStatValue, { color: '#2E7D32' }]}>{auditoriaContabilData.vendasConformes}</Text>
                    </View>
                    <View style={styles.auditStatItem}>
                      <Text style={styles.auditStatLabel}>Faturamento Elegível</Text>
                      <Text style={styles.auditStatValue}>{formatCurrency(auditoriaContabilData.faturamentoTotalAuditado)}</Text>
                    </View>
                    <View style={styles.auditStatItem}>
                      <Text style={styles.auditStatLabel}>Taxas Auditadas</Text>
                      <Text style={styles.auditStatValue}>{formatCurrency(auditoriaContabilData.totalTaxasAuditadas)}</Text>
                    </View>
                  </View>

                  <View style={styles.auditStatRowSingle}>
                    <Text style={styles.auditStatLabel}>Faturamento Cancelado Isolado:</Text>
                    <Text style={styles.auditStatValue}>{formatCurrency(auditoriaContabilData.faturamentoCanceladoAuditado)}</Text>
                  </View>

                  {auditoriaContabilData.divergencias?.length > 0 ? (
                    <View style={styles.divergenciasSection}>
                      <View style={styles.divergenciasSectionHeader}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Ionicons name="alert-circle" size={17} color="#C53030" />
                          <Text style={styles.divergenciasSectionTitle}>
                            Divergências Identificadas ({auditoriaContabilData.divergencias.length})
                          </Text>
                        </View>
                        <View style={styles.divergenciaAlertBadge}>
                          <Text style={styles.divergenciaAlertBadgeText}>Ação Necessária</Text>
                        </View>
                      </View>

                      {auditoriaContabilData.divergencias.map((div, i) => {
                        const meta = getDivergenciaMeta(div.tipo);
                        return (
                          <View key={i} style={[styles.divergenciaCard, { borderLeftColor: meta.borderColor }]}>
                            {/* Linha 1: Identificação da Venda + Canal + Status + Badge de Tipo */}
                            <View style={styles.divergenciaCardHeader}>
                              <View style={styles.divergenciaHeaderLeftGroup}>
                                <View style={styles.divergenciaSaleBadge}>
                                  <Ionicons name="receipt-outline" size={13} color="#1A202C" />
                                  <Text style={styles.divergenciaSaleBadgeText}>Venda #{div.vendaId}</Text>
                                </View>
                                <View style={styles.divergenciaCanalBadge}>
                                  <Text style={styles.divergenciaCanalBadgeText}>
                                    {div.canalVenda === 'delivery' ? '🛵 Delivery' : div.canalVenda === 'encomenda' ? '📦 Encomenda' : '🏪 Balcão'}
                                  </Text>
                                </View>
                                <View style={[styles.divergenciaStatusBadge, div.statusVenda === 'cancelada' ? styles.statusBadgeCancelada : styles.statusBadgeConcluida]}>
                                  <Text style={[styles.divergenciaStatusBadgeText, div.statusVenda === 'cancelada' ? styles.statusTextCancelada : styles.statusTextConcluida]}>
                                    {(div.statusVenda || 'concluida').toUpperCase()}
                                  </Text>
                                </View>
                              </View>

                              <View style={[styles.divergenciaTypeBadge, { backgroundColor: meta.badgeBg }]}>
                                <Ionicons name={meta.icon} size={11} color={meta.badgeText} style={{ marginRight: 3 }} />
                                <Text style={[styles.divergenciaTypeBadgeText, { color: meta.badgeText }]}>
                                  {meta.label}
                                </Text>
                              </View>
                            </View>

                            {/* Linha 2: Informações de Contexto Comercial (Cliente, Total, Data, Operador) */}
                            <View style={styles.divergenciaCommercialMeta}>
                              <View style={styles.divergenciaMetaRow}>
                                <View style={styles.divergenciaMetaItem}>
                                  <Ionicons name="person-outline" size={12} color="#4A5568" />
                                  <Text style={styles.divergenciaMetaText} numberOfLines={1}>
                                    {div.clienteNome || 'Cliente Avulso'}
                                  </Text>
                                </View>
                                <View style={styles.divergenciaMetaItem}>
                                  <Ionicons name="cash-outline" size={12} color="#276749" />
                                  <Text style={[styles.divergenciaMetaText, { fontWeight: 'bold', color: '#276749' }]}>
                                    {formatCurrency(div.valorTotal)}
                                  </Text>
                                </View>
                              </View>

                              <View style={styles.divergenciaMetaRow}>
                                <View style={styles.divergenciaMetaItem}>
                                  <Ionicons name="calendar-outline" size={12} color="#718096" />
                                  <Text style={styles.divergenciaMetaText}>
                                    {div.dataVenda ? new Date(div.dataVenda).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'Data n/d'}
                                  </Text>
                                </View>
                                <View style={styles.divergenciaMetaItem}>
                                  <Ionicons name="person-circle-outline" size={12} color="#718096" />
                                  <Text style={styles.divergenciaMetaText} numberOfLines={1}>
                                    Op: {div.usuarioNome || 'Caixa'}
                                  </Text>
                                </View>
                              </View>
                            </View>

                            {/* Linha 3: Diagnóstico da Inconsistência */}
                            <View style={styles.divergenciaMsgBox}>
                              <Text style={styles.divergenciaMsgText}>{div.mensagem}</Text>
                            </View>

                            {/* Linha 4: Dica e Recomendação */}
                            <View style={styles.divergenciaHintRow}>
                              <Ionicons name="information-circle-outline" size={13} color="#718096" />
                              <Text style={styles.divergenciaHintText}>{meta.hint}</Text>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  ) : (
                    <View style={styles.conformeBox}>
                      <Ionicons name="checkmark-circle" size={18} color="#276749" style={{ marginRight: 6 }} />
                      <Text style={styles.conformeBoxText}>
                        Todas as vendas, pagamentos mistos, taxas e estornos conferem perfeitamente.
                      </Text>
                    </View>
                  )}
                </View>
              )}
            </View>

            {/* Painel 2: Auditoria de Kardex */}
            <View style={styles.auditContainerCard}>
              <View style={styles.auditCardHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                  <View style={[styles.auditIconBadge, { backgroundColor: '#E6FFFA' }]}>
                    <Ionicons name="git-compare-outline" size={20} color="#319795" />
                  </View>
                  <View style={{ marginLeft: 10, flex: 1 }}>
                    <Text style={styles.auditCardTitle}>Auditoria de Kardex e Reconstrução</Text>
                    <Text style={styles.auditCardSubtitle}>Rastreabilidade de Estoque e Saldo Físico vs Kardex</Text>
                  </View>
                </View>
              </View>

              <Text style={styles.auditCardDesc}>
                Reconstrói matematicamente o saldo do produto desde a primeira movimentação e compara com o saldo físico cadastrado sem alterar dados.
              </Text>

              <TouchableOpacity
                style={[styles.auditButton, { backgroundColor: '#319795' }]}
                onPress={handleExecutarAuditoriaKardex}
                disabled={auditoriaKardexLoading}
              >
                {auditoriaKardexLoading ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <>
                    <Ionicons name="play-outline" size={18} color="#FFF" style={{ marginRight: 6 }} />
                    <Text style={styles.auditButtonText}>Executar Auditoria do Kardex</Text>
                  </>
                )}
              </TouchableOpacity>

              {auditoriaKardexData && (
                <View style={styles.auditResultBox}>
                  <View style={styles.auditResultTop}>
                    <Text style={styles.auditResultTitle}>Diagnóstico do Estoque:</Text>
                    <View style={auditoriaKardexData.statusGeral === 'CONFORME' ? styles.auditBadgeConforme : styles.auditBadgeDivergente}>
                      <Text style={styles.auditBadgeText}>
                        {auditoriaKardexData.statusGeral === 'CONFORME' ? '✓ ESTOQUE ÍNTEGRO' : '⚠ DIVERGÊNCIA'}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.auditGrid2Cols}>
                    <View style={styles.auditStatItem}>
                      <Text style={styles.auditStatLabel}>Produtos Auditados</Text>
                      <Text style={styles.auditStatValue}>{auditoriaKardexData.totalProdutosAuditados}</Text>
                    </View>
                    <View style={styles.auditStatItem}>
                      <Text style={styles.auditStatLabel}>Estoque Conforme</Text>
                      <Text style={[styles.auditStatValue, { color: '#2E7D32' }]}>{auditoriaKardexData.produtosConformes}</Text>
                    </View>
                  </View>

                  {auditoriaKardexData.produtosComDivergencia > 0 ? (
                    <View style={styles.divergenciasSection}>
                      <View style={styles.divergenciasSectionHeader}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Ionicons name="alert-circle" size={17} color="#C53030" />
                          <Text style={styles.divergenciasSectionTitle}>
                            Discrepâncias de Saldo ({auditoriaKardexData.produtosComDivergencia})
                          </Text>
                        </View>
                        <View style={styles.divergenciaAlertBadge}>
                          <Text style={styles.divergenciaAlertBadgeText}>Ajuste Físico</Text>
                        </View>
                      </View>

                      {auditoriaKardexData.divergencias?.map((div, i) => (
                        <View key={i} style={[styles.divergenciaCard, { borderLeftColor: '#E53E3E' }]}>
                          <View style={styles.divergenciaCardHeader}>
                            <Text style={styles.divergenciaProductName}>📦 {div.nome}</Text>
                            <View style={[styles.divergenciaTypeBadge, { backgroundColor: '#FED7D7' }]}>
                              <Text style={[styles.divergenciaTypeBadgeText, { color: '#9B1C1C' }]}>
                                Dif: {div.divergencia > 0 ? `+${div.divergencia}` : div.divergencia} un.
                              </Text>
                            </View>
                          </View>

                          <View style={styles.kardexCompareRow}>
                            <View style={styles.kardexCompareItem}>
                              <Text style={styles.kardexCompareLabel}>Saldo Físico Atual</Text>
                              <Text style={styles.kardexCompareValCurrent}>{div.estoqueAtual} un.</Text>
                            </View>
                            <Ionicons name="arrow-forward" size={14} color="#A0AEC0" />
                            <View style={styles.kardexCompareItem}>
                              <Text style={styles.kardexCompareLabel}>Reconstruído Kardex</Text>
                              <Text style={styles.kardexCompareValReconstructed}>{div.saldoReconstruido} un.</Text>
                            </View>
                          </View>

                          <View style={styles.divergenciaHintRow}>
                            <Ionicons name="information-circle-outline" size={13} color="#718096" />
                            <Text style={styles.divergenciaHintText}>
                              O saldo no cadastro diverge da soma histórica de entradas, saídas e perdas.
                            </Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <View style={styles.conformeBox}>
                      <Ionicons name="checkmark-circle" size={18} color="#276749" style={{ marginRight: 6 }} />
                      <Text style={styles.conformeBoxText}>
                        Nenhuma discrepância encontrada entre o estoque físico e o Kardex histórico.
                      </Text>
                    </View>
                  )}
                </View>
              )}
            </View>
          </View>
        )}

        {/* ======================================================== */}
        {/* ABA 4: EQUIPE & ACESSOS                                  */}
        {/* ======================================================== */}
        {activeTab === 'equipe' && (
          <View>
            <View style={styles.sectionHeaderWithAction}>
              <View>
                <Text style={styles.sectionTitle}>👥 Gestão de Equipe</Text>
                <Text style={styles.sectionSubtitle}>Controle de funcionários e níveis de permissão.</Text>
              </View>
              <TouchableOpacity
                style={styles.addMemberBtn}
                onPress={() => setTeamModalVisible(true)}
              >
                <Ionicons name="add" size={18} color="#FFF" style={{ marginRight: 4 }} />
                <Text style={styles.addMemberBtnText}>Novo</Text>
              </TouchableOpacity>
            </View>

            {usersList.length === 0 ? (
              <View style={styles.emptyCardContainer}>
                <Ionicons name="people-outline" size={42} color="#CBD5E0" />
                <Text style={styles.emptyCardTitle}>Nenhum funcionário cadastrado</Text>
                <Text style={styles.emptyCardSubtitle}>Cadastre gerentes ou balconistas para acessarem este comércio.</Text>
              </View>
            ) : (
              <View style={styles.teamListCard}>
                {usersList.map((member) => (
                  <View key={member.id.toString()} style={styles.memberRow}>
                    <View style={styles.memberAvatar}>
                      <Text style={styles.memberAvatarText}>
                        {(member.nome || 'U').charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1, paddingRight: 8 }}>
                      <Text style={styles.memberName}>{member.nome}</Text>
                      <Text style={styles.memberEmail}>{member.email}</Text>
                      <View style={[styles.roleTag, member.cargo === 'gerente' ? styles.roleGerente : styles.roleBalconista]}>
                        <Text style={[styles.roleTagText, member.cargo === 'gerente' ? styles.roleGerenteText : styles.roleBalconistaText]}>
                          {member.cargo === 'gerente' ? 'Gerente' : 'Balconista'}
                        </Text>
                      </View>
                    </View>
                    {member.email !== 'admin' && member.id !== user?.id && (
                      <TouchableOpacity
                        style={styles.deleteMemberBtn}
                        onPress={() => handleDeleteTeamMember(member.id, member.nome)}
                        accessibilityLabel="Excluir funcionário"
                      >
                        <Ionicons name="trash-outline" size={20} color="#E53E3E" />
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* Modal Ajustar Split (Configurações) */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={settingsModalVisible}
        onRequestClose={() => setSettingsModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>⚙️ Ajustar Split Global</Text>
              <TouchableOpacity onPress={() => setSettingsModalVisible(false)} style={styles.closeModalBtn}>
                <Ionicons name="close" size={20} color="#FFF" />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.modalForm}>
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Custo de Reposição (CMV) *</Text>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.formInput}
                    value={cmvPercent}
                    onChangeText={setCmvPercent}
                    keyboardType="numeric"
                    placeholder="60"
                  />
                  <Text style={styles.inputSuffix}>%</Text>
                </View>
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Despesas Operacionais (OpEx) *</Text>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.formInput}
                    value={opexPercent}
                    onChangeText={setOpexPercent}
                    keyboardType="numeric"
                    placeholder="20"
                  />
                  <Text style={styles.inputSuffix}>%</Text>
                </View>
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Lucro Líquido *</Text>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.formInput}
                    value={lucroPercent}
                    onChangeText={setLucroPercent}
                    keyboardType="numeric"
                    placeholder="20"
                  />
                  <Text style={styles.inputSuffix}>%</Text>
                </View>
              </View>

              <View style={styles.statusRow}>
                <Text style={styles.statusLabel}>Total das Carteiras:</Text>
                <Text style={[
                  styles.statusValue,
                  isSumValid ? styles.statusValid : styles.statusInvalid
                ]}>
                  {currentSum}% / 100%
                </Text>
              </View>

              {!isSumValid && (
                <Text style={styles.errorText}>
                  A soma dos valores deve fechar exatamente em 100%.
                </Text>
              )}

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.cancelModalBtn}
                  onPress={() => setSettingsModalVisible(false)}
                >
                  <Text style={styles.cancelModalBtnText}>Cancelar</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.saveModalBtn, !isSumValid && { opacity: 0.5 }]}
                  onPress={handleSaveSettings}
                  disabled={!isSumValid}
                >
                  <Text style={styles.saveModalBtnText}>💾 Salvar</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Modal Cadastrar Funcionário */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={teamModalVisible}
        onRequestClose={() => setTeamModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>👤 Cadastrar Funcionário</Text>
              <TouchableOpacity onPress={() => setTeamModalVisible(false)} style={styles.closeModalBtn}>
                <Ionicons name="close" size={20} color="#FFF" />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.modalForm}>
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Nome Completo *</Text>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.formInput}
                    value={newNome}
                    onChangeText={setNewNome}
                    placeholder="Ex: Pedro de Souza"
                    autoCorrect={false}
                  />
                </View>
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>E-mail / Usuário de Acesso *</Text>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.formInput}
                    value={newEmail}
                    onChangeText={setNewEmail}
                    placeholder="Ex: pedro@comercio.com"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Senha de Acesso *</Text>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.formInput}
                    value={newSenha}
                    onChangeText={setNewSenha}
                    placeholder="Digite a senha temporária"
                    secureTextEntry={!showNewPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <TouchableOpacity
                    style={{ padding: 6 }}
                    onPress={() => setShowNewPassword(!showNewPassword)}
                  >
                    <Ionicons
                      name={showNewPassword ? "eye-off-outline" : "eye-outline"}
                      size={18}
                      color="#A0AEC0"
                    />
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Cargo / Nível de Acesso *</Text>
                <View style={styles.roleContainer}>
                  <TouchableOpacity
                    style={[styles.roleOption, newCargo === 'balconista' && styles.roleOptionActive]}
                    onPress={() => setNewCargo('balconista')}
                  >
                    <Text style={[styles.roleOptionText, newCargo === 'balconista' && styles.roleOptionTextActive]}>
                      Balconista
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.roleOption, newCargo === 'gerente' && styles.roleOptionActive]}
                    onPress={() => setNewCargo('gerente')}
                  >
                    <Text style={[styles.roleOptionText, newCargo === 'gerente' && styles.roleOptionTextActive]}>
                      Gerente
                    </Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.roleTip}>
                  {newCargo === 'balconista'
                    ? '💡 Balconistas podem apenas vender e visualizar estoque. Não acessam relatórios financeiros.'
                    : '💡 Gerentes têm acesso completo às configurações, relatórios de CMV/lucros e equipe.'}
                </Text>
              </View>

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.cancelModalBtn}
                  onPress={() => setTeamModalVisible(false)}
                >
                  <Text style={styles.cancelModalBtnText}>Cancelar</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.saveModalBtn}
                  onPress={handleAddTeamMember}
                >
                  <Text style={styles.saveModalBtnText}>💾 Cadastrar</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Modal Confirmar Exclusão de Membro */}
      <ConfirmationModal
        visible={deleteModalVisible}
        title="Remover Acesso"
        message={memberToDelete ? `Deseja realmente excluir o funcionário "${memberToDelete.nome}"?` : ''}
        confirmText="Excluir"
        cancelText="Cancelar"
        type="danger"
        onConfirm={async () => {
          if (memberToDelete) {
            try {
              await deleteUser(memberToDelete.id);
              setDeleteModalVisible(false);
              setMemberToDelete(null);
              await loadTeamList();
            } catch (error) {
              setDeleteModalVisible(false);
              setMemberToDelete(null);
              Alert.alert('Erro', error.message || 'Ocorreu um erro ao excluir.');
            }
          }
        }}
        onCancel={() => {
          setDeleteModalVisible(false);
          setMemberToDelete(null);
        }}
      />

      <PaymentTaxConfigModal
        visible={taxConfigModalVisible}
        onClose={() => setTaxConfigModalVisible(false)}
        onSaved={loadReportDetails}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#1E63EC',
  },
  header: {
    backgroundColor: '#1E63EC',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    marginRight: 6,
  },
  headerTitleCol: {
    justifyContent: 'center',
  },
  headerLogo: {
    width: 32,
    height: 32,
    borderRadius: 8,
    marginRight: 6,
    backgroundColor: '#FFFFFF',
    padding: 2,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFF',
    letterSpacing: 0.2,
  },
  headerSubtitle: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.8)',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    flexWrap: 'nowrap',
    gap: 6,
  },
  headerIconBtn: {
    backgroundColor: '#FFFFFF',
    height: 34,
    width: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },
  logoutBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.95)',
    height: 34,
    paddingHorizontal: 9,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },
  logoutText: {
    color: '#FFF',
    fontSize: 11.5,
    fontWeight: 'bold',
  },
  // Barra de Abas (Segmented Control)
  tabBarWrapper: {
    backgroundColor: '#1E63EC',
    paddingBottom: 10,
  },
  tabBarScroll: {
    paddingHorizontal: 14,
    gap: 8,
    flexDirection: 'row',
  },
  tabItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(10, 35, 90, 0.45)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    paddingHorizontal: 15,
    paddingVertical: 9,
    borderRadius: 22,
    gap: 8,
  },
  tabItemActive: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 4,
  },
  tabItemText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  tabItemTextActive: {
    color: '#1E63EC',
    fontWeight: 'bold',
  },
  scrollContainer: {
    backgroundColor: '#F7FAFC',
    padding: 14,
    paddingBottom: 40,
    flexGrow: 1,
  },
  loadingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EBF8FF',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  loadingBannerText: {
    fontSize: 12,
    color: '#2B6CB0',
    fontWeight: '600',
  },
  // Filtro de Período
  periodFilterContainer: {
    marginBottom: 14,
  },
  periodScroll: {
    flexDirection: 'row',
    gap: 8,
  },
  periodBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  periodBtnActive: {
    backgroundColor: '#1E63EC',
    borderColor: '#1E63EC',
  },
  periodBtnText: {
    color: '#4A5568',
    fontSize: 12,
    fontWeight: '600',
  },
  periodBtnTextActive: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  // Grid de Cards
  gridContainer: {
    gap: 10,
    marginBottom: 18,
  },
  gridRow: {
    flexDirection: 'row',
    gap: 10,
  },
  card: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
    minHeight: 110,
    justifyContent: 'space-between',
  },
  blueCard: {
    backgroundColor: '#1E63EC',
    borderColor: '#1E63EC',
  },
  cardHeaderSmall: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  cardEmoji: {
    fontSize: 18,
  },
  metricIconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricIconBoxWhite: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 2,
    elevation: 2,
  },
  cardLabel: {
    fontSize: 9.5,
    fontWeight: 'bold',
    color: '#A0AEC0',
    letterSpacing: 0.5,
  },
  cardValue: {
    fontSize: 17,
    fontWeight: 'bold',
    color: '#2D3748',
    marginVertical: 2,
  },
  blueCardSubtitle: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 10,
  },
  blueCardBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  blueCardBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: 'bold',
  },
  greenBadge: {
    backgroundColor: '#DEF7EC',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  greenBadgeText: {
    color: '#03543F',
    fontSize: 9.5,
    fontWeight: 'bold',
  },
  redBadge: {
    backgroundColor: '#FDE8E8',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  redBadgeText: {
    color: '#9B1C1C',
    fontSize: 9.5,
    fontWeight: 'bold',
  },
  neutralBadge: {
    backgroundColor: '#EDF2F7',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  neutralBadgeText: {
    color: '#4A5568',
    fontSize: 9.5,
    fontWeight: 'bold',
  },
  cardSubtext: {
    color: '#A0AEC0',
    fontSize: 10.5,
  },
  // Seções Gerais
  sectionHeader: {
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#2D3748',
  },
  sectionSubtitle: {
    fontSize: 12,
    color: '#718096',
    marginTop: 2,
    lineHeight: 16,
  },
  sectionHeaderWithAction: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    gap: 8,
  },
  sectionHeaderLeft: {
    flex: 1,
    flexShrink: 1,
  },
  actionChipBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EBF8FF',
    borderWidth: 1,
    borderColor: '#BEE3F8',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    gap: 4,
    flexShrink: 0,
  },
  actionChipBtnText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#1E63EC',
  },
  // Gráfico
  chartCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
    marginBottom: 18,
  },
  legendRow: {
    flexDirection: 'row',
    gap: 14,
    marginBottom: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 5,
  },
  legendText: {
    fontSize: 11,
    color: '#718096',
    fontWeight: '600',
  },
  emptyChart: {
    height: 120,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  emptyChartText: {
    color: '#A0AEC0',
    fontSize: 12,
  },
  chartArea: {
    height: 130,
    position: 'relative',
    justifyContent: 'flex-end',
  },
  gridLinesContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 22,
    justifyContent: 'space-between',
    zIndex: 1,
  },
  gridLine: {
    height: 1,
    backgroundColor: '#EDF2F7',
  },
  barsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-end',
    height: '100%',
    zIndex: 2,
    paddingBottom: 2,
  },
  chartCol: {
    alignItems: 'center',
    flex: 1,
  },
  barsPair: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
    height: 94,
    marginBottom: 4,
  },
  chartBar: {
    width: 10,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
  },
  chartLabel: {
    fontSize: 9,
    color: '#A0AEC0',
    fontWeight: 'bold',
  },
  // Canais
  channelScrollContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingRight: 16,
    marginBottom: 12,
  },
  channelChip: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    flexShrink: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  channelChipActive: {
    backgroundColor: '#1E63EC',
    borderColor: '#1E63EC',
  },
  channelChipText: {
    fontSize: 12,
    color: '#4A5568',
    fontWeight: '600',
  },
  channelChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  channelEmptyBox: {
    paddingVertical: 20,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  channelEmptyText: {
    fontSize: 12.5,
    color: '#718096',
    textAlign: 'center',
    fontWeight: '500',
    lineHeight: 18,
  },
  lucroRealContainer: {
    marginBottom: 16,
  },
  lucroRealSummaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
    marginBottom: 12,
  },
  lrCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2F7',
  },
  lrCardTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#2D3748',
  },
  lrStatusBadge: {
    backgroundColor: '#DEF7EC',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  lrStatusBadgeText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#03543F',
  },
  lrItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  lrMiniIcon: {
    width: 24,
    height: 24,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  lrItemLabel: {
    fontSize: 12,
    color: '#4A5568',
    fontWeight: '500',
  },
  lrHighlightBox: {
    borderRadius: 10,
    padding: 12,
    marginTop: 10,
    borderWidth: 1,
  },
  lrHighlightBoxPositive: {
    backgroundColor: '#F0FFF4',
    borderColor: '#C6F6D5',
  },
  lrHighlightBoxNegative: {
    backgroundColor: '#FFF5F5',
    borderColor: '#FED7D7',
  },
  lrHighlightTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  lrHighlightLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#2D3748',
  },
  lrMargemBadge: {
    borderRadius: 8,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  lrMargemBadgePositive: {
    backgroundColor: '#EBF8FF',
  },
  lrMargemBadgeNegative: {
    backgroundColor: '#FED7D7',
  },
  lrMargemBadgeText: {
    fontSize: 10.5,
    fontWeight: 'bold',
  },
  lrRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 5,
  },
  lrDivider: {
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    marginTop: 6,
    paddingTop: 8,
  },
  lrLabel: {
    fontSize: 12.5,
    color: '#4A5568',
  },
  lrLabelStrong: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#1A202C',
  },
  lrValGreen: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#276749',
  },
  lrValOrange: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#DD6B20',
  },
  lrValRed: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#E53E3E',
  },
  lrValBig: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  textPositive: {
    color: '#22543D',
  },
  textNegative: {
    color: '#C53030',
  },
  channelBreakdownCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
    marginBottom: 12,
  },
  channelCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2F7',
  },
  channelBreakdownTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#2D3748',
  },
  channelCountBadge: {
    backgroundColor: '#EDF2F7',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  channelCountBadgeText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#4A5568',
  },
  channelCardItem: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#EDF2F7',
    gap: 8,
  },
  channelItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  channelNameText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#2D3748',
  },
  channelResPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  channelResPillPos: {
    backgroundColor: '#C6F6D5',
  },
  channelResPillNeg: {
    backgroundColor: '#FED7D7',
  },
  channelResText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  channelMetricsGrid: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: '#EDF2F7',
    justifyContent: 'space-around',
  },
  channelMetricCol: {
    alignItems: 'center',
    flex: 1,
  },
  channelMetricLabel: {
    fontSize: 9.5,
    color: '#718096',
    fontWeight: '600',
    marginBottom: 2,
  },
  channelMetricVal: {
    fontSize: 11.5,
    fontWeight: 'bold',
    color: '#2D3748',
  },
  accountingDisclaimerBox: {
    flexDirection: 'row',
    backgroundColor: '#EDF2F7',
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
  },
  accountingDisclaimerText: {
    flex: 1,
    fontSize: 10.5,
    color: '#4A5568',
    lineHeight: 14,
  },
  // Perdas e Avarias
  filterPillScrollView: {
    gap: 8,
    marginBottom: 12,
  },
  filterPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#EDF2F7',
  },
  filterPillActive: {
    backgroundColor: '#E53E3E',
  },
  filterPillText: {
    fontSize: 11.5,
    color: '#4A5568',
    fontWeight: '600',
  },
  filterPillTextActive: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  perdasContainer: {
    gap: 10,
    marginBottom: 18,
  },
  perdasListCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  perdasListTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#2D3748',
    marginBottom: 10,
  },
  perdaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: '#F7FAFC',
  },
  perdaImpactoText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#E53E3E',
  },
  perdaItemBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 10,
  },
  perdaItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  perdaProdutoName: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#1A202C',
  },
  perdaBarcodeText: {
    fontSize: 10.5,
    color: '#718096',
    marginTop: 1,
  },
  perdaTagBox: {
    backgroundColor: '#FED7D7',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  perdaTagText: {
    fontSize: 9.5,
    fontWeight: 'bold',
    color: '#9B1C1C',
  },
  perdaItemBody: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
    padding: 8,
    borderWidth: 1,
    borderColor: '#EDF2F7',
    marginBottom: 8,
  },
  perdaItemMetric: {
    alignItems: 'center',
  },
  perdaMetricLabel: {
    fontSize: 9.5,
    color: '#718096',
  },
  perdaMetricValue: {
    fontSize: 11.5,
    color: '#2D3748',
    fontWeight: '600',
    marginTop: 2,
  },
  perdaItemFooter: {
    gap: 4,
  },
  perdaJustificativaText: {
    fontSize: 11,
    color: '#4A5568',
  },
  perdaFooterMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#EDF2F7',
    paddingTop: 4,
  },
  perdaMetaText: {
    fontSize: 10,
    color: '#A0AEC0',
  },
  emptyCardContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 6,
  },
  emptyCardTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#2D3748',
  },
  emptyCardSubtitle: {
    fontSize: 11.5,
    color: '#718096',
    textAlign: 'center',
  },
  // Auditorias de Conformidade
  auditContainerCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 14,
  },
  auditCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  auditIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  auditCardTitle: {
    fontSize: 13.5,
    fontWeight: 'bold',
    color: '#2D3748',
  },
  auditCardSubtitle: {
    fontSize: 10.5,
    color: '#718096',
  },
  auditCardDesc: {
    fontSize: 11.5,
    color: '#4A5568',
    lineHeight: 16,
    marginBottom: 12,
  },
  auditButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    marginBottom: 10,
  },
  auditButtonText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 13,
  },
  auditResultBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginTop: 6,
  },
  auditResultTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  auditResultTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#2D3748',
  },
  auditBadgeConforme: {
    backgroundColor: '#C6F6D5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  auditBadgeDivergente: {
    backgroundColor: '#FED7D7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  auditBadgeText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#22543D',
  },
  auditGrid2Cols: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  auditStatItem: {
    flexBasis: '48%',
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
    padding: 8,
    borderWidth: 1,
    borderColor: '#EDF2F7',
  },
  auditStatLabel: {
    fontSize: 10,
    color: '#718096',
  },
  auditStatValue: {
    fontSize: 12.5,
    fontWeight: 'bold',
    color: '#2D3748',
    marginTop: 2,
  },
  auditStatRowSingle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
    padding: 8,
    borderWidth: 1,
    borderColor: '#EDF2F7',
    marginBottom: 8,
  },
  // Seção Moderna de Divergências
  divergenciasSection: {
    marginTop: 10,
    gap: 8,
  },
  divergenciasSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#FED7D7',
  },
  divergenciasSectionTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#9B1C1C',
  },
  divergenciaAlertBadge: {
    backgroundColor: '#FED7D7',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  divergenciaAlertBadgeText: {
    fontSize: 9.5,
    fontWeight: 'bold',
    color: '#C53030',
  },
  divergenciaCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderLeftWidth: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
    gap: 6,
  },
  divergenciaCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  divergenciaSaleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EDF2F7',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    gap: 4,
  },
  divergenciaSaleBadgeText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#2D3748',
  },
  divergenciaHeaderLeftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    flex: 1,
  },
  divergenciaCanalBadge: {
    backgroundColor: '#EDF2F7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  divergenciaCanalBadgeText: {
    fontSize: 10,
    color: '#4A5568',
    fontWeight: '600',
  },
  divergenciaStatusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusBadgeCancelada: {
    backgroundColor: '#FED7D7',
  },
  statusTextCancelada: {
    color: '#9B1C1C',
    fontSize: 9,
    fontWeight: 'bold',
  },
  statusBadgeConcluida: {
    backgroundColor: '#C6F6D5',
  },
  statusTextConcluida: {
    color: '#22543D',
    fontSize: 9,
    fontWeight: 'bold',
  },
  divergenciaCommercialMeta: {
    backgroundColor: '#F8FAFC',
    borderRadius: 6,
    padding: 8,
    gap: 5,
    borderWidth: 1,
    borderColor: '#EDF2F7',
  },
  divergenciaMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  divergenciaMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flex: 1,
  },
  divergenciaMetaText: {
    fontSize: 11,
    color: '#4A5568',
  },
  divergenciaTypeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  divergenciaTypeBadgeText: {
    fontSize: 10,
    fontWeight: 'bold',
  },
  divergenciaProductName: {
    fontSize: 12.5,
    fontWeight: 'bold',
    color: '#2D3748',
    flex: 1,
  },
  divergenciaMsgBox: {
    backgroundColor: '#FFF5F5',
    padding: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#FED7D7',
  },
  divergenciaMsgText: {
    fontSize: 11,
    color: '#742A2A',
    lineHeight: 15,
  },
  divergenciaHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  divergenciaHintText: {
    flex: 1,
    fontSize: 10,
    color: '#718096',
    fontStyle: 'italic',
  },
  kardexCompareRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F7FAFC',
    padding: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#EDF2F7',
  },
  kardexCompareItem: {
    alignItems: 'center',
    flex: 1,
  },
  kardexCompareLabel: {
    fontSize: 9.5,
    color: '#718096',
  },
  kardexCompareValCurrent: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#2D3748',
    marginTop: 2,
  },
  kardexCompareValReconstructed: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#2B6CB0',
    marginTop: 2,
  },
  conformeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0FFF4',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#C6F6D5',
    marginTop: 8,
  },
  conformeBoxText: {
    flex: 1,
    fontSize: 11,
    color: '#22543D',
    lineHeight: 15,
  },
  // Equipe
  addMemberBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E63EC',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  addMemberBtnText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  teamListCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2F7',
  },
  memberAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#EBF8FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  memberAvatarText: {
    color: '#2B6CB0',
    fontWeight: 'bold',
    fontSize: 14,
  },
  memberName: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#2D3748',
  },
  memberEmail: {
    fontSize: 10.5,
    color: '#718096',
    marginTop: 1,
  },
  roleTag: {
    alignSelf: 'flex-start',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
    marginTop: 3,
  },
  roleGerente: {
    backgroundColor: '#EBF8FF',
  },
  roleGerenteText: {
    color: '#2B6CB0',
    fontSize: 9.5,
    fontWeight: 'bold',
  },
  roleBalconista: {
    backgroundColor: '#EDF2F7',
  },
  roleBalconistaText: {
    color: '#4A5568',
    fontSize: 9.5,
    fontWeight: 'bold',
  },
  deleteMemberBtn: {
    padding: 6,
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    width: '100%',
    maxWidth: 400,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 6,
  },
  modalHeader: {
    backgroundColor: '#1E63EC',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  modalTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  closeModalBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 14,
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalForm: {
    padding: 16,
  },
  formGroup: {
    marginBottom: 14,
  },
  formLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#4A5568',
    marginBottom: 6,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F7FAFC',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 10,
    height: 44,
  },
  formInput: {
    flex: 1,
    color: '#2D3748',
    fontSize: 14,
    height: '100%',
  },
  inputSuffix: {
    color: '#718096',
    fontWeight: 'bold',
    fontSize: 14,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  statusLabel: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#4A5568',
  },
  statusValue: {
    fontSize: 15,
    fontWeight: 'bold',
  },
  statusValid: {
    color: '#48BB78',
  },
  statusInvalid: {
    color: '#E53E3E',
  },
  errorText: {
    color: '#E53E3E',
    fontSize: 10.5,
    textAlign: 'right',
    marginTop: 4,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 16,
  },
  cancelModalBtn: {
    flex: 1,
    backgroundColor: '#EDF2F7',
    borderRadius: 8,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelModalBtnText: {
    color: '#4A5568',
    fontSize: 13,
    fontWeight: 'bold',
  },
  saveModalBtn: {
    flex: 1.5,
    backgroundColor: '#1E63EC',
    borderRadius: 8,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveModalBtnText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: 'bold',
  },
  roleContainer: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  roleOption: {
    flex: 1,
    backgroundColor: '#EDF2F7',
    borderRadius: 6,
    paddingVertical: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  roleOptionActive: {
    backgroundColor: '#EBF8FF',
    borderColor: '#3182CE',
  },
  roleOptionText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#718096',
  },
  roleOptionTextActive: {
    color: '#2B6CB0',
  },
  roleTip: {
    fontSize: 10.5,
    color: '#718096',
    marginTop: 6,
    lineHeight: 14,
  },
});
