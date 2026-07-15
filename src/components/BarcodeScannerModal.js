import React, { useState, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { feedbackRead } from '../utils/scanFeedback';

// Modal de leitura de código de barras usando a câmera (Expo SDK 54 - expo-camera).
// Props:
//   onScan(codigo): chamado a cada leitura válida (mantém a câmera ativa para multi-leitura).
//   onClose(): fecha o scanner.
export default function BarcodeScannerModal({ onScan, onClose }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  // Trava síncrona: garante que cada leitura dispare onScan uma única vez,
  // mesmo que a câmera emita vários frames do mesmo código antes de reagir.
  const scanLock = useRef(false);

  // Permissão ainda não carregada
  if (!permission) {
    return (
      <View style={styles.center}>
        <Text style={styles.infoText}>Solicitando permissão de câmera...</Text>
      </View>
    );
  }

  // Permissão negada
  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Ionicons name="camera-outline" size={48} color="#A0AEC0" style={{ marginBottom: 12 }} />
        <Text style={styles.infoText}>Precisamos de permissão para acessar a câmera.</Text>
        <TouchableOpacity style={styles.permissionBtn} onPress={requestPermission}>
          <Text style={styles.permissionBtnText}>Conceder Permissão</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.closeLink} onPress={onClose}>
          <Text style={styles.closeLinkText}>Fechar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const handleBarCodeScanned = ({ data }) => {
    // Trava síncrona contra frames duplicados do mesmo código
    if (scanLock.current) return;
    scanLock.current = true;
    setScanned(true);
    feedbackRead();

    const cleanCode = (data || '').trim();
    if (cleanCode) {
      onScan(cleanCode);
    }

    // Reabilita a leitura caso a câmera continue aberta (ex.: código não encontrado)
    setTimeout(() => {
      scanLock.current = false;
      setScanned(false);
    }, 1500);
  };

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        barcodeScannerSettings={{
          barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'qr'],
        }}
        onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
      />

      {/* Overlay com moldura de mira e controles */}
      <View style={styles.overlay}>
        <View style={styles.overlayTop}>
          <Text style={styles.scanText}>Aponte para o código de barras</Text>
        </View>

        <View style={styles.frame} />

        <View style={styles.overlayBottom}>
          <Text style={styles.hintText}>
            {scanned ? '✓ Lido! Aguarde para a próxima leitura...' : 'A câmera permanece ativa para várias leituras.'}
          </Text>
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <Ionicons name="close" size={18} color="#FFF" style={{ marginRight: 6 }} />
            <Text style={styles.closeButtonText}>Fechar</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1A202C',
    padding: 24,
  },
  infoText: {
    color: '#E2E8F0',
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 22,
  },
  permissionBtn: {
    backgroundColor: '#1E63EC',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  permissionBtnText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: 'bold',
  },
  closeLink: {
    marginTop: 16,
    padding: 8,
  },
  closeLinkText: {
    color: '#A0AEC0',
    fontSize: 14,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
  },
  overlayTop: {
    paddingTop: 60,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  scanText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    overflow: 'hidden',
  },
  frame: {
    alignSelf: 'center',
    width: '78%',
    height: 180,
    borderWidth: 3,
    borderColor: '#48BB78',
    borderRadius: 16,
    backgroundColor: 'transparent',
  },
  overlayBottom: {
    paddingBottom: 48,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  hintText: {
    color: '#FFF',
    fontSize: 13,
    textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 16,
  },
  closeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E53E3E',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  closeButtonText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: 'bold',
  },
});
