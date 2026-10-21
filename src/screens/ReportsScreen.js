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
  Image
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useApp } from '../context/AppContext';
import { fetchReportData, fetchUsers, registerUser, deleteUser, apurarLucroReal, fetchRelatorioPerdas } from '../database/db';
import { Ionicons } from '@expo/vector-icons';
import SyncBadge from '../components/SyncBadge';
import PaymentTaxConfigModal from '../components/PaymentTaxConfigModal';

export default function ReportsScreen() {
  const { user, logout, settings, updateSettings, refreshData } = useApp();
  const [selectedPeriod, setSelectedPeriod] = useState(7);
  const [selectedCanalFilter, setSelectedCanalFilter] = useState('todos');
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
    }, [selectedPeriod, selectedCanalFilter, user])
  );

  useEffect(() => {
    if (settings) {
      setCmvPercent(settings.percentual_cmv.toString());
      setOpexPercent(settings.percentual_opex.toString());
      setLucroPercent(settings.percentual_lucro.toString());
    }
  }, [settings, settingsModalVisible]);

  const loadTeamList = async () => {
    if (user?.gerente_id) {
      try {
        const list = await fetchUsers(user.gerente_id);
        setUsersList(list);
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
        fetchRelatorioPerdas(user.gerente_id, { dataInicio: isoInicio })
      ]);
      setReportData(data);
      setLucroRealData(lucroReal);
      setPerdasReportData(perdas);
    } catch (error) {
      console.error('Erro ao carregar dados do relatório:', error);
    } finally {
      setLoading(false);
    }
  };

  const parseNum = (str) => parseFloat(str.replace(',', '.')) || 0;
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
    if (prev === 0) return '▲ 100% vs período anterior';
    
    const diff = curr - prev;
    const pct = ((diff / prev) * 100).toFixed(1);
    if (diff >= 0) {
      return `▲ ${pct}% vs período anterior`;
    } else {
      return `▼ ${Math.abs(pct)}% vs período anterior`;
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

      {/* Header Bar */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Image source={require('../../assets/logo_lucrocerto.png')} style={styles.headerLogo} />
          <Text style={styles.headerTitle}>LucroCerto</Text>
        </View>
        <View style={styles.headerRight}>
          <SyncBadge />
          <TouchableOpacity
            style={styles.settingsHeaderBtn}
            onPress={() => setTaxConfigModalVisible(true)}
            accessibilityLabel="Configurar Taxas de Pagamento"
          >
            <Ionicons name="card-outline" size={22} color="#FFF" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.settingsHeaderBtn}
            onPress={() => setSettingsModalVisible(true)}
          >
            <Ionicons name="settings-outline" size={22} color="#FFF" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.logoutBtn} onPress={logout}>
            <Text style={styles.logoutText}>Sair</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
        {/* Título de Relatórios */}
        <View style={styles.titleContainer}>
          <Text style={styles.titleText}>📊 Relatórios</Text>
          <Text style={styles.subtitleText}>Desempenho financeiro do mercado</Text>
        </View>

        {/* Scroll Horizontal de Filtro de Período */}
        <ScrollView 
          horizontal={true} 
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.periodScroll}
        >
          <TouchableOpacity 
            style={[styles.periodBtn, selectedPeriod === 7 && styles.periodBtnActive]}
            onPress={() => setSelectedPeriod(7)}
          >
            <Text style={[styles.periodBtnText, selectedPeriod === 7 && styles.periodBtnTextActive]}>7 dias</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.periodBtn, selectedPeriod === 30 && styles.periodBtnActive]}
            onPress={() => setSelectedPeriod(30)}
          >
            <Text style={[styles.periodBtnText, selectedPeriod === 30 && styles.periodBtnTextActive]}>30 dias</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.periodBtn, selectedPeriod === 90 && styles.periodBtnActive]}
            onPress={() => setSelectedPeriod(90)}
          >
            <Text style={[styles.periodBtnText, selectedPeriod === 90 && styles.periodBtnTextActive]}>3 meses</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.periodBtn, selectedPeriod === 180 && styles.periodBtnActive]}
            onPress={() => setSelectedPeriod(180)}
          >
            <Text style={[styles.periodBtnText, selectedPeriod === 180 && styles.periodBtnTextActive]}>6 meses</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.periodBtn, selectedPeriod === 365 && styles.periodBtnActive]}
            onPress={() => setSelectedPeriod(365)}
          >
            <Text style={[styles.periodBtnText, selectedPeriod === 365 && styles.periodBtnTextActive]}>1 ano</Text>
          </TouchableOpacity>
        </ScrollView>

        {/* Grid de 4 Cards */}
        <View style={styles.gridContainer}>
          <View style={styles.gridRow}>
            {/* Card 1: Lucro Líquido (Fundo Azul Forte) */}
            <View style={[styles.card, styles.blueCard]}>
              <Text style={styles.cardEmoji}>💰</Text>
              <Text style={[styles.cardLabel, { color: 'rgba(255,255,255,0.7)' }]}>LUCRO LÍQUIDO</Text>
              <Text style={[styles.cardValue, { color: '#FFF' }]}>
                {formatCurrency(reportData.lucroTotal)}
              </Text>
              <Text style={styles.blueCardSubtitle}>Margem de {margemPercent}%</Text>
              <View style={styles.blueCardBadge}>
                <Text style={styles.blueCardBadgeText}>▲ {margemPercent}% margem</Text>
              </View>
            </View>

            {/* Card 2: Receita Total */}
            <View style={styles.card}>
              <Text style={styles.cardEmoji}>📈</Text>
              <Text style={styles.cardLabel}>RECEITA TOTAL</Text>
              <Text style={styles.cardValue}>{formatCurrency(reportData.receitaTotal)}</Text>
              <View style={styles.greenBadge}>
                <Text style={styles.greenBadgeText}>{getReceitaTrend()}</Text>
              </View>
            </View>
          </View>

          <View style={styles.gridRow}>
            {/* Card 3: Custo Total */}
            <View style={styles.card}>
              <Text style={styles.cardEmoji}>📦</Text>
              <Text style={styles.cardLabel}>CUSTO TOTAL</Text>
              <Text style={styles.cardValue}>{formatCurrency(reportData.custoTotal)}</Text>
              <View style={styles.redBadge}>
                <Text style={styles.redBadgeText}>▼ {custoPercent}% da receita</Text>
              </View>
            </View>

            {/* Card 4: Valor em Estoque */}
            <View style={styles.card}>
              <Text style={styles.cardEmoji}>🏪</Text>
              <Text style={styles.cardLabel}>VALOR EM ESTOQUE</Text>
              <Text style={styles.cardValue}>{formatCurrency(reportData.valorEstoque)}</Text>
              <Text style={styles.cardSubtext}>Saldo atual</Text>
            </View>
          </View>
        </View>

        {/* Seção Gráfico */}
        <Text style={styles.sectionTitle}>📈 Receita vs Custo</Text>

        <View style={styles.chartCard}>
          {/* Legenda do Gráfico */}
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

          {/* Gráfico de Barras Customizado Nativo */}
          {chartPoints.length === 0 ? (
            <View style={styles.emptyChart}>
              <Text style={styles.emptyChartText}>Sem dados no período.</Text>
            </View>
          ) : (
            <View style={styles.chartArea}>
              {/* Linhas de Grade de Fundo */}
              <View style={styles.gridLinesContainer}>
                <View style={styles.gridLine} />
                <View style={styles.gridLine} />
                <View style={styles.gridLine} />
                <View style={styles.gridLine} />
              </View>

              {/* Colunas do Gráfico */}
              <View style={styles.barsContainer}>
                {chartPoints.map((item, index) => {
                  // Capped heights proportional to maxVal (max height is 90)
                  const heightReceita = Math.max((item.receita / maxVal) * 90, 2);
                  const heightCusto = Math.max((item.custo / maxVal) * 90, 2);

                  return (
                    <View key={index.toString()} style={styles.chartCol}>
                      <View style={styles.barsPair}>
                        {/* Barra Receita (Azul) */}
                        <View style={[styles.chartBar, { 
                          height: heightReceita, 
                          backgroundColor: '#1E63EC' 
                        }]} />
                        {/* Barra Custo (Laranja) */}
                        <View style={[styles.chartBar, { 
                          height: heightCusto, 
                          backgroundColor: '#ED8936' 
                        }]} />
                      </View>
                      <Text style={styles.chartLabel}>{item.label}</Text>
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {/* Seção Gerenciamento de Equipe */}
          <View style={styles.teamSectionContainer}>
            <View style={styles.teamSectionHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ fontSize: 18, marginRight: 6 }}>👥</Text>
                <Text style={styles.teamSectionTitle}>Gerenciamento de Equipe</Text>
              </View>
              <TouchableOpacity 
                style={styles.addMemberHeaderBtn} 
                onPress={() => setTeamModalVisible(true)}
              >
                <Text style={styles.addMemberHeaderBtnText}>+ Novo</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.teamSectionSubtitle}>
              Cadastre gerentes ou balconistas para acessarem este comércio.
            </Text>

            {usersList.length === 0 ? (
              <View style={styles.emptyTeamCard}>
                <Text style={styles.emptyTeamText}>Nenhum funcionário cadastrado.</Text>
              </View>
            ) : (
              <View style={styles.teamListContainer}>
                {usersList.map((member) => (
                  <View key={member.id.toString()} style={styles.memberRow}>
                    <View style={styles.memberInfo}>
                      <View style={styles.memberAvatar}>
                        <Text style={styles.memberAvatarText}>
                          {member.nome.charAt(0).toUpperCase()}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.memberName}>{member.nome}</Text>
                        <Text style={styles.memberEmail}>
                          {member.email} — <Text style={styles.memberRoleTag}>{member.cargo === 'gerente' ? 'Gerente' : 'Balconista'}</Text>
                        </Text>
                      </View>
                    </View>
                    {member.email !== 'admin' && member.id !== user.id && (
                      <TouchableOpacity 
                        style={styles.deleteMemberBtn} 
                        onPress={() => handleDeleteTeamMember(member.id, member.nome)}
                      >
                        <Ionicons name="trash-outline" size={18} color="#E53E3E" />
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>

        {/* ======================================================== */}
        {/* SEÇÃO S04: MOTOR DE LUCRO REAL & CMV (Yuri Mauriz)        */}
        {/* ======================================================== */}
        <View style={styles.sectionHeaderWithAction}>
          <Text style={styles.sectionTitle}>💰 Apuração de Lucro Real & CMV</Text>
          <TouchableOpacity
            style={styles.actionChipBtn}
            onPress={() => setTaxConfigModalVisible(true)}
          >
            <Ionicons name="options-outline" size={14} color="#1E63EC" />
            <Text style={styles.actionChipBtnText}>Taxas de Meios</Text>
          </TouchableOpacity>
        </View>

        {/* Filtro de Canais de Venda */}
        <View style={styles.channelFilterContainer}>
          {[
            { id: 'todos', label: 'Todos os Canais' },
            { id: 'balcao', label: 'Balcão' },
            { id: 'delivery', label: 'Delivery' },
            { id: 'encomenda', label: 'Encomenda' },
          ].map((canal) => (
            <TouchableOpacity
              key={canal.id}
              style={[
                styles.channelChip,
                selectedCanalFilter === canal.id && styles.channelChipActive,
              ]}
              onPress={() => setSelectedCanalFilter(canal.id)}
            >
              <Text
                style={[
                  styles.channelChipText,
                  selectedCanalFilter === canal.id && styles.channelChipTextActive,
                ]}
              >
                {canal.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {lucroRealData && (
          <View style={styles.lucroRealContainer}>
            {/* Grid de 3 colunas ou blocos */}
            <View style={styles.lucroRealSummaryCard}>
              <View style={styles.lrRow}>
                <Text style={styles.lrLabel}>Faturamento Elegível:</Text>
                <Text style={styles.lrValGreen}>{formatCurrency(lucroRealData.faturamentoElegivel)}</Text>
              </View>
              <View style={styles.lrRow}>
                <Text style={styles.lrLabel}>(-) Custo Mercadorias (CMV):</Text>
                <Text style={styles.lrValOrange}>- {formatCurrency(lucroRealData.cmvEfetivo ?? lucroRealData.cmvTotal ?? 0)}</Text>
              </View>
              <View style={styles.lrRow}>
                <Text style={styles.lrLabel}>(-) Taxas Operacionais (Meios):</Text>
                <Text style={styles.lrValRed}>- {formatCurrency(lucroRealData.taxasOperacionais ?? 0)}</Text>
              </View>
              <View style={[styles.lrRow, styles.lrDivider]}>
                <Text style={styles.lrLabelStrong}>Resultado após CMV e Taxas:</Text>
                <Text style={[
                  styles.lrValBig,
                  (lucroRealData.resultadoAposCmvTaxas ?? lucroRealData.resultadoAposCmvETaxas ?? 0) >= 0 ? styles.textPositive : styles.textNegative
                ]}>
                  {formatCurrency(lucroRealData.resultadoAposCmvTaxas ?? lucroRealData.resultadoAposCmvETaxas ?? 0)}
                </Text>
              </View>
              <View style={styles.lrMargemBadge}>
                <Text style={styles.lrMargemBadgeText}>
                  Margem Operacional Direta: {lucroRealData.margemPercentual ?? lucroRealData.margemContribuicaoPercent ?? 0}%
                </Text>
              </View>
            </View>

            {/* Apuração por Canal de Venda */}
            {((lucroRealData.canais && lucroRealData.canais.length > 0) || (lucroRealData.porCanal && Object.keys(lucroRealData.porCanal).length > 0)) && (
              <View style={styles.channelBreakdownCard}>
                <Text style={styles.channelBreakdownTitle}>Detalhamento por Canal de Venda</Text>
                {(lucroRealData.canais || Object.values(lucroRealData.porCanal || {})).map((dados, idx) => {
                  const canalNome = dados.canal || `Canal ${idx + 1}`;
                  const fat = dados.faturamentoElegivel ?? dados.faturamento ?? 0;
                  const cmv = dados.cmv ?? 0;
                  const taxas = dados.taxas ?? 0;
                  const res = dados.resultadoAposCmvTaxas ?? dados.resultado ?? 0;

                  return (
                    <View key={canalNome} style={styles.channelBreakdownRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.channelNameText}>
                          {canalNome === 'balcao' ? '🏪 Balcão' : canalNome === 'delivery' ? '🛵 Delivery' : canalNome === 'encomenda' ? '📦 Encomenda' : canalNome}
                        </Text>
                        <Text style={styles.channelSubText}>
                          Fat: {formatCurrency(fat)} | CMV: {formatCurrency(cmv)} | Taxas: {formatCurrency(taxas)}
                        </Text>
                      </View>
                      <Text style={[styles.channelResultText, res >= 0 ? styles.textPositive : styles.textNegative]}>
                        {formatCurrency(res)}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}

            {/* Aviso Contábil Oficial (S04 Requisito) */}
            <View style={styles.accountingDisclaimerBox}>
              <Ionicons name="information-circle-outline" size={18} color="#4A5568" style={{ marginRight: 6 }} />
              <Text style={styles.accountingDisclaimerText}>
                {lucroRealData.avisoContabil || 'Métrica apurada conforme edital S04.'}
              </Text>
            </View>
          </View>
        )}

        {/* ======================================================== */}
        {/* SEÇÃO S04: GESTÃO DE PERDAS E AVARIAS (Zé Neto)           */}
        {/* ======================================================== */}
        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>⚠️ Relatório de Perdas e Avarias</Text>
        <Text style={styles.sectionSubtitle}>
          Baixas operacionais por quebra, extravio, furto ou vencimento rastreadas no Kardex.
        </Text>

        {perdasReportData && (
          <View style={styles.perdasContainer}>
            <View style={styles.gridRow}>
              <View style={[styles.card, { backgroundColor: '#FFF5F5', borderColor: '#FEB2B2' }]}>
                <Text style={styles.cardEmoji}>📉</Text>
                <Text style={[styles.cardLabel, { color: '#E53E3E' }]}>IMPACTO FINANCEIRO</Text>
                <Text style={[styles.cardValue, { color: '#9B1C1C' }]}>
                  {formatCurrency(perdasReportData.impactoFinanceiroTotal ?? perdasReportData.totalPerdasFinanceiras ?? 0)}
                </Text>
                <Text style={styles.cardSubtext}>
                  {perdasReportData.totalPerdasRegistradas ?? perdasReportData.totalRegistros ?? 0} registros
                </Text>
              </View>

              <View style={styles.card}>
                <Text style={styles.cardEmoji}>📦</Text>
                <Text style={styles.cardLabel}>ITENS BAIXADOS</Text>
                <Text style={styles.cardValue}>
                  {Number(perdasReportData.quantidadeItensPerdidos ?? perdasReportData.totalItensPerdidos ?? 0).toFixed(2)}
                </Text>
                <Text style={styles.cardSubtext}>Unidades totais</Text>
              </View>
            </View>

            {/* Lista dos últimos registros de perdas */}
            {(perdasReportData.perdas || perdasReportData.detalhes || []).length > 0 && (
              <View style={styles.perdasListCard}>
                <Text style={styles.perdasListTitle}>Histórico Recente de Baixas</Text>
                {(perdasReportData.perdas || perdasReportData.detalhes || []).slice(0, 5).map((perda) => (
                  <View key={(perda.id || Math.random()).toString()} style={styles.perdaRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.perdaProdutoName}>{perda.produto_nome || `Produto #${perda.produto_id}`}</Text>
                      <Text style={styles.perdaDetailText}>
                        Motivo: <Text style={{ fontWeight: 'bold' }}>{perda.motivo_tipo || perda.tipo_perda}</Text> | Qtd: {perda.quantidade} | Justificativa: {perda.justificativa || 'Sem justificativa'}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={styles.perdaImpactoText}>- {formatCurrency(perda.impacto_financeiro)}</Text>
                      <Text style={styles.perdaDataText}>
                        {new Date(perda.data_perda || perda.data_movimento || perda.created_at || Date.now()).toLocaleDateString('pt-BR')}
                      </Text>
                    </View>
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

              {/* Removido OSCBR */}

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
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerLogo: {
    width: 36,
    height: 36,
    borderRadius: 8,
    marginRight: 10,
    backgroundColor: '#FFFFFF',
    padding: 3,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#FFF',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  settingsHeaderBtn: {
    padding: 4,
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
    backgroundColor: '#F0F4F8',
    padding: 16,
    paddingBottom: 40,
    flexGrow: 1,
  },
  titleContainer: {
    marginBottom: 16,
  },
  titleText: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#2D3748',
  },
  subtitleText: {
    fontSize: 13,
    color: '#718096',
    marginTop: 2,
  },
  periodScroll: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
  },
  periodBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  periodBtnActive: {
    backgroundColor: '#1E63EC',
    borderColor: '#1E63EC',
  },
  periodBtnText: {
    color: '#4A5568',
    fontSize: 13,
    fontWeight: 'bold',
  },
  periodBtnTextActive: {
    color: '#FFFFFF',
  },
  gridContainer: {
    gap: 12,
    marginBottom: 24,
  },
  gridRow: {
    flexDirection: 'row',
    gap: 12,
  },
  card: {
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
    minHeight: 130,
  },
  blueCard: {
    backgroundColor: '#1E63EC', // Azul forte idêntico à imagem
    borderColor: '#1E63EC',
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
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2D3748',
    marginVertical: 4,
  },
  blueCardSubtitle: {
    color: 'rgba(255, 255, 255, 0.75)',
    fontSize: 11,
    marginTop: 1,
  },
  blueCardBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
    marginTop: 'auto',
  },
  blueCardBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: 'bold',
  },
  greenBadge: {
    backgroundColor: '#DEF7EC',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
    marginTop: 'auto',
  },
  greenBadgeText: {
    color: '#03543F',
    fontSize: 10,
    fontWeight: 'bold',
  },
  redBadge: {
    backgroundColor: '#FDE8E8',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
    marginTop: 'auto',
  },
  redBadgeText: {
    color: '#9B1C1C',
    fontSize: 10,
    fontWeight: 'bold',
  },
  cardSubtext: {
    color: '#A0AEC0',
    fontSize: 12,
    marginTop: 'auto',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2D3748',
    marginBottom: 12,
  },
  chartCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 3,
    marginBottom: 16,
  },
  legendRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 16,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 6,
  },
  legendText: {
    fontSize: 12,
    color: '#718096',
    fontWeight: '600',
  },
  emptyChart: {
    height: 150,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyChartText: {
    color: '#A0AEC0',
    fontSize: 14,
  },
  chartArea: {
    height: 150,
    position: 'relative',
    justifyContent: 'flex-end',
  },
  gridLinesContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 24, // Alinha acima das datas
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
    paddingBottom: 4,
  },
  chartCol: {
    alignItems: 'center',
  },
  barsPair: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    height: 100, // Altura máxima disponível para as barras
    marginBottom: 6,
  },
  chartBar: {
    width: 12,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
  chartLabel: {
    fontSize: 10,
    color: '#A0AEC0',
    fontWeight: 'bold',
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
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
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  modalTitle: {
    fontSize: 16,
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
    padding: 20,
  },
  formGroup: {
    marginBottom: 16,
  },
  formLabel: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#4A5568',
    marginBottom: 8,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F7FAFC',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 12,
    height: 48,
  },
  formInput: {
    flex: 1,
    color: '#2D3748',
    fontSize: 15,
    height: '100%',
  },
  inputSuffix: {
    color: '#718096',
    fontWeight: 'bold',
    fontSize: 15,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  statusLabel: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#4A5568',
  },
  statusValue: {
    fontSize: 16,
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
    fontSize: 11,
    textAlign: 'right',
    marginTop: 6,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 20,
  },
  cancelModalBtn: {
    flex: 1,
    backgroundColor: '#EDF2F7',
    borderRadius: 8,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelModalBtnText: {
    color: '#4A5568',
    fontSize: 14,
    fontWeight: 'bold',
  },
  saveModalBtn: {
    flex: 1.5,
    backgroundColor: '#1E63EC',
    borderRadius: 8,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveModalBtnText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  // Estilos de Equipe
  teamSectionContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 16,
    marginTop: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 3,
  },
  teamSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  teamSectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2D3748',
  },
  teamSectionSubtitle: {
    fontSize: 12,
    color: '#718096',
    marginTop: 4,
    marginBottom: 16,
  },
  addMemberHeaderBtn: {
    backgroundColor: '#1E63EC',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  addMemberHeaderBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  emptyTeamCard: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  emptyTeamText: {
    color: '#718096',
    fontSize: 13,
  },
  teamListContainer: {
    gap: 12,
  },
  memberRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2F7',
  },
  memberInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 10,
  },
  memberAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
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
    fontSize: 14,
    fontWeight: 'bold',
    color: '#2D3748',
  },
  memberEmail: {
    fontSize: 11,
    color: '#718096',
    marginTop: 2,
  },
  memberRoleTag: {
    fontWeight: 'bold',
    color: '#2B6CB0',
  },
  deleteMemberBtn: {
    padding: 6,
  },
  roleContainer: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  roleOption: {
    flex: 1,
    backgroundColor: '#EDF2F7',
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  roleOptionActive: {
    backgroundColor: '#EBF8FF',
    borderColor: '#3182CE',
  },
  roleOptionText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#718096',
  },
  roleOptionTextActive: {
    color: '#2B6CB0',
  },
  roleTip: {
    fontSize: 11,
    color: '#718096',
    marginTop: 8,
    lineHeight: 15,
  },
  sectionHeaderWithAction: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 8,
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
  },
  actionChipBtnText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#1E63EC',
  },
  channelFilterContainer: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  channelChip: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
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
  },
  lucroRealContainer: {
    marginBottom: 16,
  },
  lucroRealSummaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
    marginBottom: 12,
  },
  lrRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  lrDivider: {
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    marginTop: 8,
    paddingTop: 10,
  },
  lrLabel: {
    fontSize: 13,
    color: '#4A5568',
  },
  lrLabelStrong: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#1A202C',
  },
  lrValGreen: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#276749',
  },
  lrValOrange: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#DD6B20',
  },
  lrValRed: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#E53E3E',
  },
  lrValBig: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  textPositive: {
    color: '#2F855A',
  },
  textNegative: {
    color: '#C53030',
  },
  lrMargemBadge: {
    backgroundColor: '#EBF8FF',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginTop: 10,
    alignItems: 'center',
  },
  lrMargemBadgeText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#2B6CB0',
  },
  channelBreakdownCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 12,
  },
  channelBreakdownTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#2D3748',
    marginBottom: 10,
  },
  channelBreakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F7FAFC',
  },
  channelNameText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#2D3748',
  },
  channelSubText: {
    fontSize: 11,
    color: '#718096',
    marginTop: 2,
  },
  channelResultText: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  accountingDisclaimerBox: {
    flexDirection: 'row',
    backgroundColor: '#EDF2F7',
    borderRadius: 10,
    padding: 12,
    alignItems: 'flex-start',
  },
  accountingDisclaimerText: {
    flex: 1,
    fontSize: 11,
    color: '#4A5568',
    lineHeight: 16,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: '#718096',
    marginBottom: 12,
    marginTop: -8,
  },
  perdasContainer: {
    gap: 12,
    marginBottom: 20,
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
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F7FAFC',
  },
  perdaProdutoName: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#2D3748',
  },
  perdaDetailText: {
    fontSize: 11,
    color: '#718096',
    marginTop: 2,
  },
  perdaImpactoText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#E53E3E',
  },
  perdaDataText: {
    fontSize: 10,
    color: '#A0AEC0',
    marginTop: 2,
  },
});
