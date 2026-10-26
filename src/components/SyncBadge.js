import React from 'react';
import { View, TouchableOpacity, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';

// Badge visual que indica o status da conexão e de sincronização do aplicativo com o servidor
export default function SyncBadge() {
  const { syncStatus, forceSync } = useApp();
  const { pendingCount, isOnline, isSyncing, configured } = syncStatus;

  if (!configured) return null;

  let color = '#2E7D32';
  let iconName = 'cloud-done';
  let label = '';
  if (!isOnline) {
    color = '#E53E3E';
    iconName = 'cloud-offline';
  } else if (pendingCount > 0) {
    color = '#D69E2E';
    iconName = 'cloud-upload';
    label = String(pendingCount);
  }

  return (
    <TouchableOpacity
      style={styles.badge}
      onPress={forceSync}
      disabled={isSyncing}
      activeOpacity={0.7}
      accessibilityLabel="Status de Sincronização"
    >
      {isSyncing ? (
        <ActivityIndicator size="small" color="#1E63EC" />
      ) : (
        <>
          <Ionicons name={iconName} size={16} color={color} />
          {label ? <Text style={[styles.text, { color }]}>{label}</Text> : null}
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
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 7,
    height: 34,
    minWidth: 34,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },
  text: {
    fontSize: 11,
    fontWeight: 'bold',
    marginLeft: 4,
  },
});

