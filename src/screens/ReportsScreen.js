import React, { useState, useEffect } from 'react';
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
  Dimensions
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useApp } from '../context/AppContext';
import { fetchReportData } from '../database/db';
import { Ionicons } from '@expo/vector-icons';
import SyncBadge from '../components/SyncBadge';

export default function ReportsScreen() {
  const { logout, settings, updateSettings, refreshData } = useApp();
  const [selectedPeriod, setSelectedPeriod] = useState(7); // 7, 30, 90, 180, 365
  const [reportData, setReportData] = useState({
    receitaTotal: 0,
    custoTotal: 0,
    lucroTotal: 0,
    valorEstoque: 0,
    prevReceita: 0,
    chartData: []
  });
  const [loading, setLoading] = useState(false);

  // Estados para o Modal de Configuração do Split
  const [settingsModalVisible, setSettingsModalVisible] = useState(false);
  const [cmvPercent, setCmvPercent] = useState('');
  const [opexPercent, setOpexPercent] = useState('');
  const [lucroPercent, setLucroPercent] = useState('');
  const [oscbrUsuario, setOscbrUsuario] = useState('');
  const [oscbrSenha, setOscbrSenha] = useState('');

  // Carregar dados toda vez que o período mudar ou quando o contexto atualizar
  useEffect(() => {
    loadReportDetails();
  }, [selectedPeriod]);

  // Sincronizar inputs de configuração com as settings atuais
  useEffect(() => {
    if (settings) {
      setCmvPercent(settings.percentual_cmv.toString());
      setOpexPercent(settings.percentual_opex.toString());
      setLucroPercent(settings.percentual_lucro.toString());
      setOscbrUsuario(settings.oscbr_usuario || '');
      setOscbrSenha(settings.oscbr_senha || '');
    }
  }, [settings, settingsModalVisible]);

  const loadReportDetails = async () => {
    setLoading(true);
    try {
      const data = await fetchReportData(selectedPeriod);
      setReportData(data);
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

  // Cálculo de Margem e Tendências
  const margemPercent = reportData.receitaTotal > 0 
    ? ((reportData.lucroTotal / reportData.receitaTotal) * 100).toFixed(1) 
    : '0.0';

  const custoPercent = reportData.receitaTotal > 0 
    ? ((reportData.custoTotal / reportData.receitaTotal) * 100).toFixed(1) 
    : '0.0';

  // Tendência da Receita comparando com o período anterior
  const getReceitaTrend = () => {
    const curr = reportData.receitaTotal;
    const prev = reportData.prevReceita;
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
      await updateSettings(cmv, opex, lucro, oscbrUsuario.trim(), oscbrSenha.trim());
      Alert.alert('Sucesso', 'Configurações atualizadas com sucesso!');
      setSettingsModalVisible(false);
      await refreshData();
      await loadReportDetails();
    } catch (error) {
      Alert.alert('Erro', 'Não foi possível salvar as configurações.');
    }
  };

  // Custom Chart Rendering Helpers
  const chartPoints = reportData.chartData || [];
  const maxVal = Math.max(...chartPoints.map(item => Math.max(item.receita, item.custo)), 100);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <StatusBar style="light" />

      {/* Header Bar */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="cart" size={24} color="#FFF" style={{ marginRight: 8 }} />
          <Text style={styles.headerTitle}>Mercado Manager</Text>
        </View>
        <View style={styles.headerRight}>
          <SyncBadge />
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
        </View>
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

              {/* Credenciais da API OSCBR (RSC Sistemas) */}
              <View style={{ marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#E2E8F0' }}>
                <Text style={{ fontSize: 13, fontWeight: 'bold', color: '#1E63EC', marginBottom: 12 }}>
                  🔑 Integração OSCBR (RSC Sistemas)
                </Text>
                
                <View style={styles.formGroup}>
                  <Text style={styles.formLabel}>Usuário OSCBR</Text>
                  <View style={styles.inputWrapper}>
                    <TextInput
                      style={styles.formInput}
                      value={oscbrUsuario}
                      onChangeText={setOscbrUsuario}
                      placeholder="Seu usuário cadastrado"
                      autoCapitalize="none"
                    />
                  </View>
                </View>

                <View style={styles.formGroup}>
                  <Text style={styles.formLabel}>Senha OSCBR</Text>
                  <View style={styles.inputWrapper}>
                    <TextInput
                      style={styles.formInput}
                      value={oscbrSenha}
                      onChangeText={setOscbrSenha}
                      placeholder="Sua senha cadastrada"
                      secureTextEntry={true}
                      autoCapitalize="none"
                    />
                  </View>
                </View>
                <Text style={{ fontSize: 11, color: '#718096', marginTop: -4, marginBottom: 12 }}>
                  Cadastre-se em gtin.rscsistemas.com.br para obter credenciais da API.
                </Text>
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
  headerTitle: {
    fontSize: 20,
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
});
