import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Modal,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fetchKardex } from '../services/stockService';

export default function KardexModal({
  visible,
  gerenteId,
  produto = null,
  onClose
}) {
  const [movimentacoes, setMovimentacoes] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (visible && gerenteId) {
      loadKardexData();
    }
  }, [visible, gerenteId, produto]);

  const loadKardexData = async () => {
    setLoading(true);
    try {
      const list = await fetchKardex(produto?.id || null, gerenteId, 100);
      setMovimentacoes(list);
    } catch (e) {
      console.error('Erro ao buscar histórico Kardex:', e);
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

  const formatDataHora = (dataIso) => {
    try {
      const d = new Date(dataIso);
      return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    } catch {
      return dataIso;
    }
  };

  const getTipoBadgeStyle = (tipo) => {
    if (tipo.startsWith('ENTRADA')) {
      return { bg: '#DEF7EC', text: '#03543F' };
    }
    if (tipo.startsWith('SAIDA_VENDA')) {
      return { bg: '#EBF8FF', text: '#2B6CB0' };
    }
    if (tipo.startsWith('ESTORNO') || tipo.startsWith('DEVOLUCAO') || tipo.startsWith('CANCELAMENTO')) {
      return { bg: '#F3E8FF', text: '#6B21A8' };
    }
    if (tipo.startsWith('PERDA') || tipo.startsWith('AVARIA')) {
      return { bg: '#FDE8E8', text: '#9B1C1C' };
    }
    return { bg: '#EDF2F7', text: '#4A5568' };
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          {/* Header padrão LucroCerto */}
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="list" size={20} color="#FFF" />
                <Text style={styles.headerTitle}>Ficha Kardex de Movimentações</Text>
              </View>
              {produto && (
                <Text style={styles.headerSubtitle} numberOfLines={1}>
                  {produto.nome} (Saldo atual: {produto.estoque} un)
                </Text>
              )}
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color="#FFF" />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color="#1E63EC" size="large" />
              <Text style={styles.loadingText}>Carregando histórico do Kardex...</Text>
            </View>
          ) : (
            <ScrollView style={styles.listContainer} contentContainerStyle={styles.listContent}>
              {movimentacoes.length === 0 ? (
                <View style={styles.emptyBox}>
                  <Text style={styles.emptyText}>Nenhuma movimentação registrada no Kardex.</Text>
                </View>
              ) : (
                movimentacoes.map((mov) => {
                  const badge = getTipoBadgeStyle(mov.tipo_movimentacao);
                  const isPositivo = mov.quantidade > 0;
                  return (
                    <View key={mov.id} style={styles.movCard}>
                      <View style={styles.movTopRow}>
                        <View style={[styles.badge, { backgroundColor: badge.bg }]}>
                          <Text style={[styles.badgeText, { color: badge.text }]}>{mov.tipo_movimentacao}</Text>
                        </View>
                        <Text style={styles.movData}>{formatDataHora(mov.data_movimentacao)}</Text>
                      </View>

                      <Text style={styles.movProdNome}>{mov.produto_nome}</Text>

                      <View style={styles.movDetailsRow}>
                        <Text style={styles.movDetailText}>
                          Qtd:{' '}
                          <Text style={[styles.movDetailBold, isPositivo ? { color: '#276749' } : { color: '#C53030' }]}>
                            {isPositivo ? `+${mov.quantidade}` : mov.quantidade} un
                          </Text>
                        </Text>
                        <Text style={styles.movDetailText}>
                          Saldo:{' '}
                          <Text style={styles.movDetailBold}>
                            {mov.saldo_anterior} ➔ {mov.saldo_resultante} un
                          </Text>
                        </Text>
                        <Text style={styles.movDetailText}>
                          Custo unit: <Text style={styles.movDetailBold}>{formatCurrency(mov.custo_unitario)}</Text>
                        </Text>
                      </View>

                      {mov.justificativa ? (
                        <Text style={styles.movJustificativa}>
                          📝 {mov.justificativa}
                        </Text>
                      ) : null}
                    </View>
                  );
                })
              )}
            </ScrollView>
          )}

          <View style={styles.footer}>
            <TouchableOpacity style={styles.closeBtnFooter} onPress={onClose}>
              <Text style={styles.closeBtnFooterText}>Fechar</Text>
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
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16
  },
  card: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '92%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 6
  },
  header: {
    backgroundColor: '#1E63EC',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF'
  },
  headerSubtitle: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.8)',
    marginTop: 2
  },
  closeBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 14,
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center'
  },
  loadingBox: {
    padding: 30,
    alignItems: 'center',
    gap: 10
  },
  loadingText: {
    color: '#718096',
    fontSize: 13
  },
  listContainer: {
    maxHeight: 520
  },
  listContent: {
    padding: 16
  },
  emptyBox: {
    padding: 24,
    alignItems: 'center'
  },
  emptyText: {
    color: '#A0AEC0',
    fontSize: 13
  },
  movCard: {
    backgroundColor: '#F7FAFC',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0'
  },
  movTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6
  },
  badgeText: {
    fontSize: 10,
    fontWeight: 'bold'
  },
  movData: {
    color: '#A0AEC0',
    fontSize: 11
  },
  movProdNome: {
    color: '#2D3748',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 6
  },
  movDetailsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4
  },
  movDetailText: {
    color: '#718096',
    fontSize: 12
  },
  movDetailBold: {
    color: '#2D3748',
    fontWeight: 'bold'
  },
  movJustificativa: {
    color: '#718096',
    fontSize: 11,
    marginTop: 4,
    fontStyle: 'italic'
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    padding: 16,
    backgroundColor: '#FFFFFF'
  },
  closeBtnFooter: {
    height: 48,
    borderRadius: 8,
    backgroundColor: '#EDF2F7',
    justifyContent: 'center',
    alignItems: 'center'
  },
  closeBtnFooterText: {
    color: '#4A5568',
    fontWeight: 'bold',
    fontSize: 14
  }
});
