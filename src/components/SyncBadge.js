import React from 'react';
import { View, TouchableOpacity, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useApp } from '../context/AppContext';

// Badge de sincronização compacto para o header. Escondido se o Supabase não
// estiver configurado. Toque força a sincronização.
//   verde  = tudo sincronizado
//   amarelo + nº = operações pendentes
//   vermelho = offline
export default function SyncBadge() {
  const { syncStatus, forceSync } = useApp();
  const { pendingCount, isOnline, isSyncing, configured } = syncStatus;

  if (!configured) return null;

  let color = '#48BB78'; // verde
  let label = '';
  if (!isOnline) {
    color = '#F56565'; // vermelho
  } else if (pendingCount > 0) {
    color = '#ECC94B'; // amarelo
    label = String(pendingCount);
  }

  return (
    <TouchableOpacity
      style={styles.badge}
      onPress={forceSync}
      disabled={isSyncing}
      activeOpacity={0.7}
    >
      {isSyncing ? (
        <ActivityIndicator size="small" color="#FFF" />
      ) : (
        <>
          <View style={[styles.dot, { backgroundColor: color }]} />
          {label ? <Text style={styles.text}>{label}</Text> : null}
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 10,
    height: 32,
    minWidth: 32,
    borderRadius: 8,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  text: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: 'bold',
    marginLeft: 6,
  },
});
