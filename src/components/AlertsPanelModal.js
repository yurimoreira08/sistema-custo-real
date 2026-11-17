import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Modal,
  TouchableOpacity,
  ScrollView,
  Linking,
  ActivityIndicator
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { gerarCobrancaWhatsApp } from '../services/clientService';

// ========================================================
// PAINEL DE ALERTAS & NOTIFICAÇÕES (S08)
// Lista os alertas proativos (liquidação antecipada, vencidos, estoque e fiado)
// gerados por alertService.fetchPainelAlertas e oferece a ação de cada um.
// ========================================================

const ESTILO_SEVERIDADE = {
  critica: { cor: '#C53030', fundo: '#FFF5F5', rotulo: 'CRÍTICO', icone: 'flame' },
  alta: { cor: '#DD6B20', fundo: '#FFFAF0', rotulo: 'ALTO', icone: 'warning' },
  media: { cor: '#B7791F', fundo: '#FFFFF0', rotulo: 'MÉDIO', icone: 'alert-circle' },
  info: { cor: '#2B6CB0', fundo: '#EBF8FF', rotulo: 'INFO', icone: 'information-circle' }
};

const FILTROS = [
  { chave: 'todos', rotulo: 'Todos' },
  { chave: 'validade', rotulo: 'Validade' },
  { chave: 'estoque', rotulo: 'Estoque' },
  { chave: 'fiado', rotulo: 'Fiado' }
];

const ROTULO_ACAO = {
  LIQUIDAR: 'Ver lotes e aplicar promoção',
  REGISTRAR_PERDA: 'Registrar perda',
  REPOR_ESTOQUE: 'Ver produtos',
  COBRAR_WHATSAPP: 'Cobrar via WhatsApp'
};

const formatCurrency = (val) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);

/**
 * @param {{ visible: boolean, painel: object|null, carregando?: boolean, gerenteId: number,
 *           onClose: Function, onRefresh: Function, onIrParaProdutos?: Function }} props
 */
export default function AlertsPanelModal({ visible, painel, carregando = false, gerenteId, onClose, onRefresh, onIrParaProdutos }) {
  const [filtro, setFiltro] = useState('todos');
  const [erroMsg, setErroMsg] = useState('');

  const alertas = (painel?.alertas || []).filter((a) => filtro === 'todos' || a.categoria === filtro);
  const liq = painel?.liquidacao;

  const executarAcao = async (alerta) => {
    setErroMsg('');
    if (alerta.acao === 'COBRAR_WHATSAPP') {
      try {
        const cobranca = await gerarCobrancaWhatsApp(alerta.referencia.clienteId, gerenteId);
        if (!cobranca.link) {
          setErroMsg(`Telefone de ${cobranca.cliente.nome} ausente ou inválido. Atualize o cadastro do cliente.`);
          return;
        }
        await Linking.openURL(cobranca.link);
      } catch (e) {
        setErroMsg(e.message || 'Não foi possível abrir o WhatsApp.');
      }
      return;
    }
    // Liquidação, perda e reposição são tratadas na tela de Produtos (lotes, perdas e estoque)
    onClose();
    if (onIrParaProdutos) onIrParaProdutos(alerta);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
              <Ionicons name="notifications" size={22} color="#1E63EC" style={{ marginRight: 8 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>Alertas & Notificações</Text>
                <Text style={styles.subtitle}>Aja antes do vencimento e do prejuízo</Text>
              </View>
            </View>
            <TouchableOpacity onPress={onRefresh} style={styles.iconBtn}>
              <Ionicons name="refresh" size={20} color="#1E63EC" />
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose} style={styles.iconBtn}>
              <Ionicons name="close" size={22} color="#718096" />
            </TouchableOpacity>
          </View>

          {liq && liq.lotesParaLiquidar + liq.lotesVencidos > 0 && (
            <View style={styles.resumoLiquidacao}>
              <View style={styles.resumoItem}>
                <Text style={styles.resumoLabel}>LOTES P/ LIQUIDAR</Text>
                <Text style={styles.resumoValor}>{liq.lotesParaLiquidar}</Text>
              </View>
              <View style={styles.resumoItem}>
                <Text style={styles.resumoLabel}>CAPITAL EM RISCO</Text>
                <Text style={[styles.resumoValor, { color: '#C53030' }]}>{formatCurrency(liq.capitalEmRisco)}</Text>
              </View>
              <View style={styles.resumoItem}>
                <Text style={styles.resumoLabel}>RECUPERÁVEL</Text>
                <Text style={[styles.resumoValor, { color: '#276749' }]}>{formatCurrency(liq.receitaPotencial)}</Text>
              </View>
            </View>
          )}

          <View style={styles.filtrosRow}>
            {FILTROS.map((f) => (
              <TouchableOpacity
                key={f.chave}
                style={[styles.filtroChip, filtro === f.chave && styles.filtroChipAtivo]}
                onPress={() => setFiltro(f.chave)}
              >
                <Text style={[styles.filtroText, filtro === f.chave && styles.filtroTextAtivo]}>{f.rotulo}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {erroMsg ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color="#E53E3E" />
              <Text style={styles.errorText}>{erroMsg}</Text>
            </View>
          ) : null}

          <ScrollView style={styles.body}>
            {carregando ? (
              <ActivityIndicator size="large" color="#1E63EC" style={{ marginVertical: 30 }} />
            ) : alertas.length === 0 ? (
              <View style={styles.emptyBox}>
                <Ionicons name="checkmark-done-circle" size={40} color="#38A169" />
                <Text style={styles.emptyText}>Nenhum alerta pendente. Tudo em dia!</Text>
              </View>
            ) : (
              alertas.map((a) => {
                const est = ESTILO_SEVERIDADE[a.severidade] || ESTILO_SEVERIDADE.info;
                return (
                  <View key={a.id} style={[styles.alertaCard, { backgroundColor: est.fundo, borderLeftColor: est.cor }]}>
                    <View style={styles.alertaTopo}>
                      <Ionicons name={est.icone} size={16} color={est.cor} />
                      <Text style={[styles.alertaSeveridade, { color: est.cor }]}>{est.rotulo}</Text>
                      <Text style={styles.alertaTitulo} numberOfLines={1}>{a.titulo}</Text>
                    </View>
                    <Text style={styles.alertaMensagem}>{a.mensagem}</Text>
                    {a.acao && (
                      <TouchableOpacity style={[styles.alertaAcao, { borderColor: est.cor }]} onPress={() => executarAcao(a)}>
                        <Ionicons
                          name={a.acao === 'COBRAR_WHATSAPP' ? 'logo-whatsapp' : 'arrow-forward'}
                          size={14}
                          color={est.cor}
                          style={{ marginRight: 4 }}
                        />
                        <Text style={[styles.alertaAcaoText, { color: est.cor }]}>{ROTULO_ACAO[a.acao] || 'Abrir'}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  card: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    maxHeight: '90%',
    paddingBottom: 16
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2F7'
  },
  title: { fontSize: 16, fontWeight: 'bold', color: '#1A202C' },
  subtitle: { fontSize: 11, color: '#718096' },
  iconBtn: { padding: 6, marginLeft: 4 },
  resumoLiquidacao: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 16,
    paddingTop: 12
  },
  resumoItem: {
    flex: 1,
    backgroundColor: '#F7FAFC',
    borderRadius: 8,
    padding: 8,
    alignItems: 'center'
  },
  resumoLabel: { fontSize: 9, fontWeight: 'bold', color: '#718096' },
  resumoValor: { fontSize: 14, fontWeight: 'bold', color: '#2D3748', marginTop: 2 },
  filtrosRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 16, paddingTop: 12 },
  filtroChip: {
    borderWidth: 1,
    borderColor: '#CBD5E0',
    borderRadius: 14,
    paddingVertical: 4,
    paddingHorizontal: 12
  },
  filtroChipAtivo: { backgroundColor: '#1E63EC', borderColor: '#1E63EC' },
  filtroText: { fontSize: 12, color: '#4A5568', fontWeight: '600' },
  filtroTextAtivo: { color: '#FFF' },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF5F5',
    marginHorizontal: 16,
    marginTop: 10,
    padding: 8,
    borderRadius: 8
  },
  errorText: { fontSize: 12, color: '#C53030', marginLeft: 6, flex: 1 },
  body: { paddingHorizontal: 16, marginTop: 10 },
  emptyBox: { alignItems: 'center', paddingVertical: 36 },
  emptyText: { fontSize: 13, color: '#4A5568', marginTop: 8 },
  alertaCard: {
    borderLeftWidth: 4,
    borderRadius: 8,
    padding: 10,
    marginBottom: 8
  },
  alertaTopo: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  alertaSeveridade: { fontSize: 10, fontWeight: 'bold' },
  alertaTitulo: { fontSize: 13, fontWeight: 'bold', color: '#1A202C', flex: 1 },
  alertaMensagem: { fontSize: 12, color: '#4A5568', marginTop: 4 },
  alertaAcao: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    marginTop: 8,
    backgroundColor: '#FFF'
  },
  alertaAcaoText: { fontSize: 12, fontWeight: '600' }
});
