import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Modal,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Platform,
  Alert
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fetchTriagemValidadeLotes } from '../services/stockService';

export default function StockExpiryRiskModal({
  visible,
  gerenteId,
  onClose
}) {
  const [loading, setLoading] = useState(true);
  const [dataTriagem, setDataTriagem] = useState(null);
  const [faixaAtiva, setFaixaAtiva] = useState('critico'); // 'vencidos', 'critico', 'medio', 'alerta', 'seguro'
  const [erroMsg, setErroMsg] = useState('');

  useEffect(() => {
    if (visible && gerenteId) {
      carregarTriagem();
    }
  }, [visible, gerenteId]);

  const carregarTriagem = async () => {
    setLoading(true);
    setErroMsg('');
    try {
      const res = await fetchTriagemValidadeLotes(gerenteId);
      setDataTriagem(res);
      // Seleciona automaticamente a faixa com maior criticidade que tiver lotes
      if (res.faixas.vencidos.quantidadeLotes > 0) {
        setFaixaAtiva('vencidos');
      } else if (res.faixas.critico.quantidadeLotes > 0) {
        setFaixaAtiva('critico');
      } else if (res.faixas.medio.quantidadeLotes > 0) {
        setFaixaAtiva('medio');
      } else if (res.faixas.alerta.quantidadeLotes > 0) {
        setFaixaAtiva('alerta');
      } else {
        setFaixaAtiva('seguro');
      }
    } catch (e) {
      console.error('Erro ao carregar triagem de validade:', e);
      setErroMsg('Erro ao calcular triagem de validade dos lotes.');
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (val) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(val || 0);
  };

  const formatarData = (dataStr) => {
    if (!dataStr) return 'Não informada';
    const clean = dataStr.substring(0, 10);
    const partes = clean.split('-');
    if (partes.length === 3) {
      return `${partes[2]}/${partes[1]}/${partes[0]}`;
    }
    return clean;
  };

  const currentFaixa = dataTriagem?.faixas ? dataTriagem.faixas[faixaAtiva] : null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={styles.headerIconBg}>
                <Ionicons name="time" size={22} color="#DD6B20" />
              </View>
              <View style={{ marginLeft: 8 }}>
                <Text style={styles.headerTitle}>Triagem de Validade Crítica</Text>
                <Text style={styles.headerSubtitle}>Monitoramento de Lotes e Capital Parado sob Risco</Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color="#718096" />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.centerLoading}>
              <ActivityIndicator size="large" color="#DD6B20" />
              <Text style={styles.loadingText}>Calculando prazos de validade e capital sob risco...</Text>
            </View>
          ) : erroMsg ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={18} color="#E53E3E" />
              <Text style={styles.errorText}>{erroMsg}</Text>
            </View>
          ) : dataTriagem ? (
            <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
              {/* Banner Consolidado de Capital Parado sob Risco */}
              <View style={styles.capitalRiscoBanner}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.capitalRiscoLabel}>CAPITAL PARADO SOB RISCO DE VENCIMENTO</Text>
                  <Text style={styles.capitalRiscoValor}>
                    {formatCurrency(dataTriagem.capitalTotalEmRisco)}
                  </Text>
                  <Text style={styles.capitalRiscoSub}>
                    Total em estoque sob risco: {dataTriagem.totalItensEmRisco} un. em {dataTriagem.totalLotesEmRisco} lote(s)
                  </Text>
                </View>
                <View style={styles.shieldIconBox}>
                  <Ionicons name="alert-circle" size={32} color="#DD6B20" />
                </View>
              </View>

              {/* Seletor de Faixas de Risco (Tabs) */}
              <Text style={styles.sectionLabel}>Faixas de Risco por Prazo de Validade:</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabsScroll}>
                {/* 1. Vencidos */}
                <TouchableOpacity
                  style={[
                    styles.tabFaixa,
                    faixaAtiva === 'vencidos' && styles.tabFaixaActiveVencido
                  ]}
                  onPress={() => setFaixaAtiva('vencidos')}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Ionicons name="close-circle" size={14} color={faixaAtiva === 'vencidos' ? '#FFF' : '#E53E3E'} />
                    <Text style={[styles.tabFaixaText, faixaAtiva === 'vencidos' && styles.tabFaixaTextActive]}>
                      Vencidos ({dataTriagem.faixas.vencidos.quantidadeLotes})
                    </Text>
                  </View>
                  <Text style={[styles.tabFaixaValor, faixaAtiva === 'vencidos' && styles.tabFaixaValorActive]}>
                    {formatCurrency(dataTriagem.faixas.vencidos.capitalParado)}
                  </Text>
                </TouchableOpacity>

                {/* 2. Risco Crítico (até 7 dias) */}
                <TouchableOpacity
                  style={[
                    styles.tabFaixa,
                    faixaAtiva === 'critico' && styles.tabFaixaActiveCritico
                  ]}
                  onPress={() => setFaixaAtiva('critico')}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Ionicons name="warning" size={14} color={faixaAtiva === 'critico' ? '#FFF' : '#DD6B20'} />
                    <Text style={[styles.tabFaixaText, faixaAtiva === 'critico' && styles.tabFaixaTextActive]}>
                      Até 7 dias ({dataTriagem.faixas.critico.quantidadeLotes})
                    </Text>
                  </View>
                  <Text style={[styles.tabFaixaValor, faixaAtiva === 'critico' && styles.tabFaixaValorActive]}>
                    {formatCurrency(dataTriagem.faixas.critico.capitalParado)}
                  </Text>
                </TouchableOpacity>

                {/* 3. Risco Médio (8 a 15 dias) */}
                <TouchableOpacity
                  style={[
                    styles.tabFaixa,
                    faixaAtiva === 'medio' && styles.tabFaixaActiveMedio
                  ]}
                  onPress={() => setFaixaAtiva('medio')}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Ionicons name="time-outline" size={14} color={faixaAtiva === 'medio' ? '#FFF' : '#D69E2E'} />
                    <Text style={[styles.tabFaixaText, faixaAtiva === 'medio' && styles.tabFaixaTextActive]}>
                      8 a 15 dias ({dataTriagem.faixas.medio.quantidadeLotes})
                    </Text>
                  </View>
                  <Text style={[styles.tabFaixaValor, faixaAtiva === 'medio' && styles.tabFaixaValorActive]}>
                    {formatCurrency(dataTriagem.faixas.medio.capitalParado)}
                  </Text>
                </TouchableOpacity>

                {/* 4. Alerta (16 a 30 dias) */}
                <TouchableOpacity
                  style={[
                    styles.tabFaixa,
                    faixaAtiva === 'alerta' && styles.tabFaixaActiveAlerta
                  ]}
                  onPress={() => setFaixaAtiva('alerta')}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Ionicons name="notifications-outline" size={14} color={faixaAtiva === 'alerta' ? '#FFF' : '#3182CE'} />
                    <Text style={[styles.tabFaixaText, faixaAtiva === 'alerta' && styles.tabFaixaTextActive]}>
                      16 a 30 dias ({dataTriagem.faixas.alerta.quantidadeLotes})
                    </Text>
                  </View>
                  <Text style={[styles.tabFaixaValor, faixaAtiva === 'alerta' && styles.tabFaixaValorActive]}>
                    {formatCurrency(dataTriagem.faixas.alerta.capitalParado)}
                  </Text>
                </TouchableOpacity>

                {/* 5. Seguro (> 30 dias) */}
                <TouchableOpacity
                  style={[
                    styles.tabFaixa,
                    faixaAtiva === 'seguro' && styles.tabFaixaActiveSeguro
                  ]}
                  onPress={() => setFaixaAtiva('seguro')}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Ionicons name="checkmark-circle-outline" size={14} color={faixaAtiva === 'seguro' ? '#FFF' : '#38A169'} />
                    <Text style={[styles.tabFaixaText, faixaAtiva === 'seguro' && styles.tabFaixaTextActive]}>
                      Normal ({dataTriagem.faixas.seguro.quantidadeLotes})
                    </Text>
                  </View>
                  <Text style={[styles.tabFaixaValor, faixaAtiva === 'seguro' && styles.tabFaixaValorActive]}>
                    {formatCurrency(dataTriagem.faixas.seguro.capitalParado)}
                  </Text>
                </TouchableOpacity>
              </ScrollView>

              {/* Detalhes da Faixa Selecionada */}
              {currentFaixa && (
                <View style={styles.faixaDetalheHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.faixaDetalheTitulo, { color: currentFaixa.cor }]}>
                      {currentFaixa.titulo} — {currentFaixa.subtitulo}
                    </Text>
                    <Text style={styles.faixaDetalheSub}>
                      Capital Parado nesta faixa: <Text style={{ fontWeight: 'bold' }}>{formatCurrency(currentFaixa.capitalParado)}</Text> ({currentFaixa.totalItens} un.)
                    </Text>
                  </View>
                </View>
              )}

              {/* Listagem dos Lotes */}
              {currentFaixa && currentFaixa.lotes.length === 0 ? (
                <View style={styles.emptyBox}>
                  <Ionicons name="checkmark-done-circle" size={42} color="#68D391" />
                  <Text style={styles.emptyTitle}>Nenhum lote nesta faixa de risco</Text>
                  <Text style={styles.emptySub}>
                    Não há mercadorias cadastradas com este prazo de validade pendentes em estoque.
                  </Text>
                </View>
              ) : (
                currentFaixa?.lotes.map((lote) => {
                  const isVencido = lote.diasParaVencer < 0;
                  const diasAbs = Math.abs(lote.diasParaVencer);

                  return (
                    <View key={lote.id} style={styles.loteCard}>
                      <View style={styles.loteCardTop}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.loteProdNome}>{lote.produto_nome}</Text>
                          <Text style={styles.loteProdCat}>
                            {lote.produto_categoria || 'Mercearia'} • Lote: <Text style={{ fontWeight: 'bold' }}>{lote.numero_lote}</Text>
                          </Text>
                        </View>
                        <View style={[
                          styles.prazoBadge,
                          isVencido
                            ? styles.prazoBadgeVencido
                            : lote.diasParaVencer <= 7
                              ? styles.prazoBadgeCritico
                              : lote.diasParaVencer <= 15
                                ? styles.prazoBadgeMedio
                                : styles.prazoBadgeAlerta
                        ]}>
                          <Text style={[
                            styles.prazoBadgeText,
                            isVencido
                              ? styles.prazoTextVencido
                              : lote.diasParaVencer <= 7
                                ? styles.prazoTextCritico
                                : lote.diasParaVencer <= 15
                                  ? styles.prazoTextMedio
                                  : styles.prazoTextAlerta
                          ]}>
                            {isVencido
                              ? `VENCIDO HÁ ${diasAbs} D`
                              : lote.diasParaVencer === 0
                                ? 'VENCE HOJE!'
                                : `VENCE EM ${lote.diasParaVencer} D`}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.loteDashedLine} />

                      <View style={styles.loteInfoGrid}>
                        <View style={styles.loteInfoItem}>
                          <Text style={styles.loteInfoLabel}>Validade:</Text>
                          <Text style={[styles.loteInfoVal, isVencido && { color: '#C53030', fontWeight: 'bold' }]}>
                            {formatarData(lote.data_validade)}
                          </Text>
                        </View>

                        <View style={styles.loteInfoItem}>
                          <Text style={styles.loteInfoLabel}>Saldo no Lote:</Text>
                          <Text style={styles.loteInfoVal}>{lote.quantidadeSaldo} un.</Text>
                        </View>

                        <View style={styles.loteInfoItem}>
                          <Text style={styles.loteInfoLabel}>Custo Unit. (PMP):</Text>
                          <Text style={styles.loteInfoVal}>{formatCurrency(lote.custoUnitario)}</Text>
                        </View>

                        <View style={styles.loteInfoItem}>
                          <Text style={styles.loteInfoLabel}>Capital Parado:</Text>
                          <Text style={[styles.loteInfoVal, styles.loteCapitalDestacado]}>
                            {formatCurrency(lote.capitalParado)}
                          </Text>
                        </View>
                      </View>
                    </View>
                  );
                })
              )}
            </ScrollView>
          ) : null}

          {/* Footer */}
          <View style={styles.footer}>
            <TouchableOpacity style={styles.btnFechar} onPress={onClose}>
              <Text style={styles.btnFecharText}>Fechar Triagem</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: 14
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    maxHeight: '92%',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden'
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2F7',
    backgroundColor: '#FFFDF9'
  },
  headerIconBg: {
    backgroundColor: '#FEEBC8',
    padding: 8,
    borderRadius: 10
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1A202C'
  },
  headerSubtitle: {
    fontSize: 11,
    color: '#718096',
    marginTop: 1
  },
  closeBtn: {
    padding: 6
  },
  centerLoading: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 50
  },
  loadingText: {
    fontSize: 12,
    color: '#718096',
    marginTop: 10
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFF5F5',
    padding: 12,
    margin: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FED7D7'
  },
  errorText: {
    fontSize: 12,
    color: '#C53030'
  },
  body: {
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  capitalRiscoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFAF0',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#FEEBC8',
    marginBottom: 14
  },
  capitalRiscoLabel: {
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 0.6,
    color: '#C05621'
  },
  capitalRiscoValor: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#DD6B20',
    marginVertical: 2
  },
  capitalRiscoSub: {
    fontSize: 11,
    color: '#7B341E'
  },
  shieldIconBox: {
    padding: 8
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#4A5568',
    marginBottom: 8
  },
  tabsScroll: {
    marginBottom: 12
  },
  tabFaixa: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    minWidth: 120
  },
  tabFaixaText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#4A5568'
  },
  tabFaixaTextActive: {
    color: '#FFF',
    fontWeight: 'bold'
  },
  tabFaixaValor: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#1A202C',
    marginTop: 3
  },
  tabFaixaValorActive: {
    color: '#FFF'
  },
  tabFaixaActiveVencido: {
    backgroundColor: '#E53E3E',
    borderColor: '#E53E3E'
  },
  tabFaixaActiveCritico: {
    backgroundColor: '#DD6B20',
    borderColor: '#DD6B20'
  },
  tabFaixaActiveMedio: {
    backgroundColor: '#D69E2E',
    borderColor: '#D69E2E'
  },
  tabFaixaActiveAlerta: {
    backgroundColor: '#3182CE',
    borderColor: '#3182CE'
  },
  tabFaixaActiveSeguro: {
    backgroundColor: '#38A169',
    borderColor: '#38A169'
  },
  faixaDetalheHeader: {
    backgroundColor: '#F7FAFC',
    padding: 10,
    borderRadius: 8,
    marginBottom: 10,
    borderLeftWidth: 4,
    borderLeftColor: '#DD6B20'
  },
  faixaDetalheTitulo: {
    fontSize: 13,
    fontWeight: 'bold'
  },
  faixaDetalheSub: {
    fontSize: 11,
    color: '#718096',
    marginTop: 2
  },
  emptyBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 36,
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginVertical: 10
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#2D3748',
    marginTop: 8
  },
  emptySub: {
    fontSize: 11,
    color: '#A0AEC0',
    textAlign: 'center',
    paddingHorizontal: 20,
    marginTop: 2
  },
  loteCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#EDF2F7',
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1
  },
  loteCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start'
  },
  loteProdNome: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#1A202C'
  },
  loteProdCat: {
    fontSize: 11,
    color: '#718096',
    marginTop: 1
  },
  prazoBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1
  },
  prazoBadgeVencido: {
    backgroundColor: '#FFF5F5',
    borderColor: '#FEB2B2'
  },
  prazoBadgeCritico: {
    backgroundColor: '#FFFAF0',
    borderColor: '#FBD38D'
  },
  prazoBadgeMedio: {
    backgroundColor: '#FEFCBF',
    borderColor: '#FAF089'
  },
  prazoBadgeAlerta: {
    backgroundColor: '#EBF8FF',
    borderColor: '#BEE3F8'
  },
  prazoBadgeText: {
    fontSize: 10,
    fontWeight: 'bold'
  },
  prazoTextVencido: {
    color: '#C53030'
  },
  prazoTextCritico: {
    color: '#C05621'
  },
  prazoTextMedio: {
    color: '#975A16'
  },
  prazoTextAlerta: {
    color: '#2B6CB0'
  },
  loteDashedLine: {
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2F7',
    borderStyle: 'dashed',
    marginVertical: 8
  },
  loteInfoGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between'
  },
  loteInfoItem: {
    flex: 1
  },
  loteInfoLabel: {
    fontSize: 10,
    color: '#A0AEC0'
  },
  loteInfoVal: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2D3748',
    marginTop: 1
  },
  loteCapitalDestacado: {
    color: '#DD6B20',
    fontWeight: 'bold'
  },
  footer: {
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: '#EDF2F7',
    backgroundColor: '#F8FAFC',
    alignItems: 'center'
  },
  btnFechar: {
    paddingVertical: 8,
    paddingHorizontal: 20
  },
  btnFecharText: {
    color: '#718096',
    fontWeight: '600',
    fontSize: 13
  }
});

