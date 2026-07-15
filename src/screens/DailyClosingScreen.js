import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet, Text, View, ScrollView, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { fetchDailyClosing } from '../database/db';
import SyncBadge from '../components/SyncBadge';

function formatCurrency(val) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);
}
function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function formatDayLabel(date) {
  const hoje = new Date();
  const ontem = new Date();
  ontem.setDate(hoje.getDate() - 1);
  if (isSameDay(date, hoje)) return 'Hoje';
  if (isSameDay(date, ontem)) return 'Ontem';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function DailyClosingScreen() {
  const [date, setDate] = useState(new Date());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchDailyClosing(date);
      setData(result);
    } catch (e) {
      setData(null);
    }
    setLoading(false);
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const isToday = isSameDay(date, new Date());
  const goPrev = () => { const d = new Date(date); d.setDate(d.getDate() - 1); setDate(d); };
  const goNext = () => { if (isToday) return; const d = new Date(date); d.setDate(d.getDate() + 1); setDate(d); };
  const goToday = () => setDate(new Date());

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="cash" size={24} color="#FFF" style={{ marginRight: 8 }} />
          <Text style={styles.headerTitle}>Fechamento de Caixa</Text>
        </View>
        <SyncBadge />
      </View>

      <View style={styles.dateNav}>
        <TouchableOpacity style={styles.dateArrow} onPress={goPrev}>
          <Ionicons name="chevron-back" size={22} color="#1E63EC" />
        </TouchableOpacity>
        <View style={styles.dateCenter}>
          <Text style={styles.dateLabel}>{formatDayLabel(date)}</Text>
          {!isToday && (
            <TouchableOpacity onPress={goToday}>
              <Text style={styles.todayLink}>Ir para hoje</Text>
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity
          style={[styles.dateArrow, isToday && { opacity: 0.3 }]}
          onPress={goNext}
          disabled={isToday}
        >
          <Ionicons name="chevron-forward" size={22} color="#1E63EC" />
        </TouchableOpacity>
      </View>

      {loading || !data ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#1E63EC" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.cardsRow}>
            <View style={[styles.bigCard, { backgroundColor: '#EBF8FF' }]}>
              <Text style={styles.bigCardLabel}>FATURAMENTO</Text>
              <Text style={[styles.bigCardValue, { color: '#2B6CB0' }]}>{formatCurrency(data.faturamento)}</Text>
            </View>
            <View style={[styles.bigCard, { backgroundColor: '#F0FFF4' }]}>
              <Text style={styles.bigCardLabel}>LUCRO</Text>
              <Text style={[styles.bigCardValue, { color: '#2F855A' }]}>{formatCurrency(data.lucro)}</Text>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Divisão do faturamento</Text>
            <View style={styles.splitRow}>
              <Text style={styles.splitLabel}>Reposição (CMV)</Text>
              <Text style={styles.splitValue}>{formatCurrency(data.cmv)}</Text>
            </View>
            <View style={styles.splitRow}>
              <Text style={styles.splitLabel}>Operações (OpEx)</Text>
              <Text style={styles.splitValue}>{formatCurrency(data.opex)}</Text>
            </View>
            <View style={styles.splitRow}>
              <Text style={styles.splitLabel}>Lucro líquido</Text>
              <Text style={[styles.splitValue, { color: '#2F855A' }]}>{formatCurrency(data.lucro)}</Text>
            </View>
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statCol}>
              <Text style={styles.statValue}>{data.numVendas}</Text>
              <Text style={styles.statLabel}>Vendas</Text>
            </View>
            <View style={styles.statCol}>
              <Text style={styles.statValue}>{formatCurrency(data.ticketMedio)}</Text>
              <Text style={styles.statLabel}>Ticket médio</Text>
            </View>
            <View style={styles.statCol}>
              <Text style={styles.statValue}>{data.itensVendidos}</Text>
              <Text style={styles.statLabel}>Itens</Text>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Top produtos do dia</Text>
            {data.topProdutos.length === 0 ? (
              <Text style={styles.emptyText}>Nenhuma venda neste dia.</Text>
            ) : (
              data.topProdutos.map((p, i) => (
                <View key={i} style={styles.topRow}>
                  <Text style={styles.topName} numberOfLines={1}>{i + 1}. {p.nome}</Text>
                  <Text style={styles.topQtd}>{p.qtd} un</Text>
                  <Text style={styles.topTotal}>{formatCurrency(p.total)}</Text>
                </View>
              ))
            )}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#1E63EC' },
  header: {
    backgroundColor: '#1E63EC',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center' },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#FFF' },
  dateNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  dateArrow: {
    width: 40, height: 40, borderRadius: 8,
    backgroundColor: '#EBF8FF', justifyContent: 'center', alignItems: 'center',
  },
  dateCenter: { alignItems: 'center' },
  dateLabel: { fontSize: 16, fontWeight: 'bold', color: '#2D3748' },
  todayLink: { fontSize: 12, color: '#1E63EC', fontWeight: '600', marginTop: 2 },
  center: { flex: 1, backgroundColor: '#F0F4F8', justifyContent: 'center', alignItems: 'center' },
  scroll: { backgroundColor: '#F0F4F8', padding: 16, paddingBottom: 32 },
  cardsRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  bigCard: {
    flex: 1, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#E2E8F0',
  },
  bigCardLabel: { fontSize: 10, fontWeight: 'bold', color: '#718096', letterSpacing: 0.5 },
  bigCardValue: { fontSize: 20, fontWeight: 'bold', marginTop: 6 },
  card: {
    backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: '#E2E8F0',
  },
  cardTitle: { fontSize: 13, fontWeight: 'bold', color: '#4A5568', marginBottom: 12 },
  splitRow: {
    flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6,
  },
  splitLabel: { fontSize: 14, color: '#718096' },
  splitValue: { fontSize: 14, fontWeight: 'bold', color: '#2D3748' },
  statsRow: {
    flexDirection: 'row', backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16,
    marginBottom: 12, borderWidth: 1, borderColor: '#E2E8F0',
  },
  statCol: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 16, fontWeight: 'bold', color: '#2D3748' },
  statLabel: { fontSize: 11, color: '#A0AEC0', marginTop: 4, fontWeight: '600' },
  topRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 8,
    borderBottomWidth: 0.5, borderBottomColor: '#EDF2F7',
  },
  topName: { flex: 1, fontSize: 13, color: '#2D3748', fontWeight: '500', marginRight: 8 },
  topQtd: { fontSize: 12, color: '#718096', width: 50, textAlign: 'right' },
  topTotal: { fontSize: 13, fontWeight: 'bold', color: '#2D3748', width: 90, textAlign: 'right' },
  emptyText: { fontSize: 14, color: '#A0AEC0', textAlign: 'center', paddingVertical: 12 },
});
