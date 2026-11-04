import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Modal,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  obterTurnoAtivo,
  abrirTurnoCaixa,
  bloquearTurnoCaixa,
  desbloquearTurnoCaixa,
  fecharTurnoCaixa,
  registrarSuprimentoSangria,
  auditarTurnoCaixa
} from '../services/cashService';

export default function CashRegisterModal({
  visible,
  gerenteId,
  usuarioId,
  usuarioNome = 'Operador',
  onClose,
  onShiftChange
}) {
  const [turno, setTurno] = useState(null);
  const [loading, setLoading] = useState(true);
  const [erroMsg, setErroMsg] = useState('');
  const [sucessoMsg, setSucessoMsg] = useState('');

  // Form states
  const [abaAtiva, setAbaAtiva] = useState('status'); // 'status', 'abertura', 'movimentacao', 'fechamento', 'auditoria'
  const [fundoTroco, setFundoTroco] = useState('100.00');
  const [obsAbertura, setObsAbertura] = useState('');

  const [tipoMov, setTipoMov] = useState('SANGRIA'); // 'SANGRIA' ou 'SUPRIMENTO'
  const [valorMov, setValorMov] = useState('');
  const [justificativaMov, setJustificativaMov] = useState('');

  const [motivoBloqueio, setMotivoBloqueio] = useState('');
  const [saldoFechamento, setSaldoFechamento] = useState('');
  const [obsFechamento, setObsFechamento] = useState('');
  const [resultadoFechamento, setResultadoFechamento] = useState(null);

  const [auditoriaData, setAuditoriaData] = useState(null);

  useEffect(() => {
    if (visible && usuarioId) {
      carregarTurno();
    }
  }, [visible, usuarioId, gerenteId]);

  const carregarTurno = async () => {
    setLoading(true);
    setErroMsg('');
    setSucessoMsg('');
    setResultadoFechamento(null);
    try {
      const t = await obterTurnoAtivo(usuarioId, gerenteId);
      setTurno(t);
      if (!t) {
        setAbaAtiva('abertura');
      } else {
        setAbaAtiva('status');
      }
    } catch (e) {
      console.error('Erro ao carregar turno:', e);
      setErroMsg('Erro ao consultar turno de caixa.');
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

  const handleAbrirCaixa = async () => {
    setErroMsg('');
    const vFundo = parseFloat(fundoTroco.replace(',', '.'));
    if (isNaN(vFundo) || vFundo < 0) {
      setErroMsg('Informe um valor de fundo de troco válido (R$ 0 ou superior).');
      return;
    }

    setLoading(true);
    try {
      const novoTurno = await abrirTurnoCaixa({
        gerenteId,
        operadorId: usuarioId,
        fundoTrocoInicial: vFundo,
        observacoes: obsAbertura.trim() || null
      });
      setTurno(novoTurno);
      setSucessoMsg(`Caixa #${novoTurno.id} aberto com sucesso com fundo de troco de ${formatCurrency(vFundo)}!`);
      setAbaAtiva('status');
      if (onShiftChange) onShiftChange(novoTurno);
    } catch (e) {
      setErroMsg(e.message || 'Erro ao abrir caixa.');
    } finally {
      setLoading(false);
    }
  };

  const handleBloquearCaixa = async () => {
    if (!motivoBloqueio.trim()) {
      setErroMsg('Informe o motivo do bloqueio do caixa.');
      return;
    }
    setLoading(true);
    setErroMsg('');
    try {
      const atualizado = await bloquearTurnoCaixa({
        turnoId: turno.id,
        operadorId: usuarioId,
        motivo: motivoBloqueio.trim(),
        gerenteId
      });
      setTurno(atualizado);
      setMotivoBloqueio('');
      setSucessoMsg('Caixa bloqueado com sucesso! Checkout de vendas temporariamente suspenso.');
      if (onShiftChange) onShiftChange(atualizado);
    } catch (e) {
      setErroMsg(e.message || 'Erro ao bloquear caixa.');
    } finally {
      setLoading(false);
    }
  };

  const handleDesbloquearCaixa = async () => {
    setLoading(true);
    setErroMsg('');
    try {
      const atualizado = await desbloquearTurnoCaixa({
        turnoId: turno.id,
        operadorId: usuarioId,
        justificativa: 'Desbloqueio autorizado pelo operador/gerente',
        gerenteId
      });
      setTurno(atualizado);
      setSucessoMsg('Caixa desbloqueado com sucesso! Checkout de vendas liberado.');
      if (onShiftChange) onShiftChange(atualizado);
    } catch (e) {
      setErroMsg(e.message || 'Erro ao desbloquear caixa.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegistrarMovimentacao = async () => {
    setErroMsg('');
    const val = parseFloat(valorMov.replace(',', '.'));
    if (isNaN(val) || val <= 0) {
      setErroMsg('Informe um valor válido maior que zero.');
      return;
    }
    if (!justificativaMov.trim()) {
      setErroMsg('Informe a justificativa da movimentação.');
      return;
    }

    setLoading(true);
    try {
      const atualizado = await registrarSuprimentoSangria({
        turnoId: turno.id,
        operadorId: usuarioId,
        tipo: tipoMov,
        valor: val,
        justificativa: justificativaMov.trim(),
        gerenteId
      });
      setTurno(atualizado);
      setValorMov('');
      setJustificativaMov('');
      setSucessoMsg(`${tipoMov} de ${formatCurrency(val)} registrada com sucesso no caixa!`);
      setAbaAtiva('status');
      if (onShiftChange) onShiftChange(atualizado);
    } catch (e) {
      setErroMsg(e.message || 'Erro ao registrar movimentação.');
    } finally {
      setLoading(false);
    }
  };

  const handleFecharCaixa = async () => {
    setErroMsg('');
    const saldoInf = parseFloat(saldoFechamento.replace(',', '.'));
    if (isNaN(saldoInf) || saldoInf < 0) {
      setErroMsg('Informe o saldo físico apurado em dinheiro para fechar o caixa.');
      return;
    }

    setLoading(true);
    try {
      const res = await fecharTurnoCaixa({
        turnoId: turno.id,
        operadorId: usuarioId,
        saldoInformado: saldoInf,
        observacoes: obsFechamento.trim() || null,
        gerenteId
      });
      setResultadoFechamento(res);
      setTurno(null);
      setSucessoMsg(`Turno #${res.turno.id} encerrado com sucesso!`);
      if (onShiftChange) onShiftChange(null);
    } catch (e) {
      setErroMsg(e.message || 'Erro ao fechar caixa.');
    } finally {
      setLoading(false);
    }
  };

  const handleCarregarAuditoria = async () => {
    if (!turno) return;
    setLoading(true);
    setErroMsg('');
    try {
      const aud = await auditarTurnoCaixa(turno.id, gerenteId);
      setAuditoriaData(aud);
      setAbaAtiva('auditoria');
    } catch (e) {
      setErroMsg(e.message || 'Erro na auditoria do caixa.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.card}>
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name="cash" size={24} color="#1E63EC" style={{ marginRight: 8 }} />
              <View>
                <Text style={styles.title}>Controle de Turnos de Caixa</Text>
                <Text style={styles.subtitle}>Operador: {usuarioNome} • Gerência: #{gerenteId}</Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color="#718096" />
            </TouchableOpacity>
          </View>

          {/* Abas */}
          <View style={styles.tabsRow}>
            {turno && (
              <TouchableOpacity
                style={[styles.tabBtn, abaAtiva === 'status' && styles.tabBtnActive]}
                onPress={() => setAbaAtiva('status')}
              >
                <Text style={[styles.tabBtnText, abaAtiva === 'status' && styles.tabBtnTextActive]}>
                  Status Caixa
                </Text>
              </TouchableOpacity>
            )}

            {!turno && (
              <TouchableOpacity
                style={[styles.tabBtn, abaAtiva === 'abertura' && styles.tabBtnActive]}
                onPress={() => setAbaAtiva('abertura')}
              >
                <Text style={[styles.tabBtnText, abaAtiva === 'abertura' && styles.tabBtnTextActive]}>
                  Abertura
                </Text>
              </TouchableOpacity>
            )}

            {turno && turno.status === 'aberto' && (
              <TouchableOpacity
                style={[styles.tabBtn, abaAtiva === 'movimentacao' && styles.tabBtnActive]}
                onPress={() => setAbaAtiva('movimentacao')}
              >
                <Text style={[styles.tabBtnText, abaAtiva === 'movimentacao' && styles.tabBtnTextActive]}>
                  Sangria / Suprimento
                </Text>
              </TouchableOpacity>
            )}

            {turno && (
              <TouchableOpacity
                style={[styles.tabBtn, abaAtiva === 'fechamento' && styles.tabBtnActive]}
                onPress={() => setAbaAtiva('fechamento')}
              >
                <Text style={[styles.tabBtnText, abaAtiva === 'fechamento' && styles.tabBtnTextActive]}>
                  Encerrar Turno
                </Text>
              </TouchableOpacity>
            )}

            {turno && (
              <TouchableOpacity
                style={[styles.tabBtn, abaAtiva === 'auditoria' && styles.tabBtnActive]}
                onPress={handleCarregarAuditoria}
              >
                <Text style={[styles.tabBtnText, abaAtiva === 'auditoria' && styles.tabBtnTextActive]}>
                  Auditoria
                </Text>
              </TouchableOpacity>
            )}
          </View>

          <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
            {/* Mensagens de Sucesso e Erro */}
            {sucessoMsg ? (
              <View style={styles.successBox}>
                <Ionicons name="checkmark-circle" size={18} color="#276749" />
                <Text style={styles.successText}>{sucessoMsg}</Text>
              </View>
            ) : null}

            {erroMsg ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={18} color="#E53E3E" />
                <Text style={styles.errorText}>{erroMsg}</Text>
              </View>
            ) : null}

            {loading ? (
              <View style={styles.centerLoading}>
                <ActivityIndicator size="large" color="#1E63EC" />
                <Text style={styles.loadingText}>Carregando informações do caixa...</Text>
              </View>
            ) : (
              <>
                {/* ABA: STATUS DO CAIXA */}
                {abaAtiva === 'status' && turno && (
                  <View>
                    <View style={[
                      styles.statusBanner,
                      turno.status === 'aberto' ? styles.statusAberto : styles.statusBloqueado
                    ]}>
                      <Ionicons
                        name={turno.status === 'aberto' ? 'checkmark-circle' : 'lock-closed'}
                        size={28}
                        color={turno.status === 'aberto' ? '#276749' : '#C53030'}
                      />
                      <View style={{ marginLeft: 10, flex: 1 }}>
                        <Text style={styles.statusBannerTitle}>
                          Turno #{turno.id} — {turno.status === 'aberto' ? 'CAIXA ATIVO (ABERTO)' : 'CAIXA BLOQUEADO'}
                        </Text>
                        <Text style={styles.statusBannerSub}>
                          {turno.status === 'aberto'
                            ? 'Liberado para registrar vendas no balcão e checkout.'
                            : `Bloqueado: ${turno.motivo_bloqueio || 'Operação suspensa'}. Checkout bloqueado!`}
                        </Text>
                      </View>
                    </View>

                    {/* Resumo Financeiro do Turno */}
                    <View style={styles.gridCards}>
                      <View style={styles.cardItem}>
                        <Text style={styles.cardLabel}>Fundo Inicial</Text>
                        <Text style={styles.cardValue}>{formatCurrency(turno.fundo_troco_inicial)}</Text>
                      </View>
                      <View style={styles.cardItem}>
                        <Text style={styles.cardLabel}>Vendas em Dinheiro</Text>
                        <Text style={[styles.cardValue, { color: '#276749' }]}>
                          +{formatCurrency(turno.total_vendas_dinheiro)}
                        </Text>
                      </View>
                      <View style={styles.cardItem}>
                        <Text style={styles.cardLabel}>Suprimentos</Text>
                        <Text style={[styles.cardValue, { color: '#2B6CB0' }]}>
                          +{formatCurrency(turno.total_suprimentos)}
                        </Text>
                      </View>
                      <View style={styles.cardItem}>
                        <Text style={styles.cardLabel}>Sangrias</Text>
                        <Text style={[styles.cardValue, { color: '#C53030' }]}>
                          -{formatCurrency(turno.total_sangrias)}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.destaqueSaldoBox}>
                      <Text style={styles.destaqueSaldoLabel}>SALDO ATUAL EM DINHEIRO NO CAIXA</Text>
                      <Text style={styles.destaqueSaldoValor}>{formatCurrency(turno.saldo_esperado_dinheiro)}</Text>
                      <Text style={styles.destaqueOutros}>
                        Vendas em outros meios (PIX, Cartão): {formatCurrency(turno.total_vendas_outros)}
                      </Text>
                    </View>

                    {/* Ações de Bloqueio / Desbloqueio */}
                    <View style={styles.actionsSection}>
                      <Text style={styles.sectionHeader}>Controle de Acesso ao Caixa</Text>
                      {turno.status === 'aberto' ? (
                        <View style={styles.blockBox}>
                          <Text style={styles.inputLabel}>Pausar/Bloquear Caixa Temporariamente:</Text>
                          <TextInput
                            style={styles.textInput}
                            placeholder="Motivo (Ex: Saída para almoço, conferência...)"
                            placeholderTextColor="#A0AEC0"
                            value={motivoBloqueio}
                            onChangeText={setMotivoBloqueio}
                          />
                          <TouchableOpacity style={styles.btnBloquear} onPress={handleBloquearCaixa}>
                            <Ionicons name="lock-closed" size={16} color="#FFF" style={{ marginRight: 6 }} />
                            <Text style={styles.btnTextWhite}>Bloquear Caixa</Text>
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <View style={styles.unblockBox}>
                          <Text style={styles.unblockText}>
                            O caixa está bloqueado. Clique abaixo para reativar as vendas:
                          </Text>
                          <TouchableOpacity style={styles.btnDesbloquear} onPress={handleDesbloquearCaixa}>
                            <Ionicons name="lock-open" size={16} color="#FFF" style={{ marginRight: 6 }} />
                            <Text style={styles.btnTextWhite}>Desbloquear e Reativar Caixa</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  </View>
                )}

                {/* ABA: ABERTURA DE CAIXA */}
                {abaAtiva === 'abertura' && (
                  <View style={styles.formBox}>
                    <View style={styles.infoAlert}>
                      <Ionicons name="information-circle" size={20} color="#2B6CB0" />
                      <Text style={styles.infoAlertText}>
                        Não há caixa aberto para você no momento. Para iniciar vendas e registrar recebimentos,
                        abra o turno informando o fundo de troco inicial.
                      </Text>
                    </View>

                    <Text style={styles.inputLabel}>Fundo de Troco Inicial (R$):</Text>
                    <TextInput
                      style={styles.textInputBig}
                      placeholder="0.00"
                      placeholderTextColor="#A0AEC0"
                      keyboardType="numeric"
                      value={fundoTroco}
                      onChangeText={setFundoTroco}
                    />

                    <Text style={styles.inputLabel}>Observações da Abertura (Opcional):</Text>
                    <TextInput
                      style={styles.textInput}
                      placeholder="Ex: Notas miúdas e moedas contadas pelo gerente..."
                      placeholderTextColor="#A0AEC0"
                      value={obsAbertura}
                      onChangeText={setObsAbertura}
                    />

                    <TouchableOpacity style={styles.btnPrincipal} onPress={handleAbrirCaixa}>
                      <Ionicons name="key-outline" size={18} color="#FFF" style={{ marginRight: 8 }} />
                      <Text style={styles.btnPrincipalText}>Abrir Turno de Caixa</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {/* ABA: SANGRIA / SUPRIMENTO */}
                {abaAtiva === 'movimentacao' && turno && (
                  <View style={styles.formBox}>
                    <Text style={styles.inputLabel}>Tipo de Movimentação:</Text>
                    <View style={styles.radioRow}>
                      <TouchableOpacity
                        style={[styles.radioBtn, tipoMov === 'SANGRIA' && styles.radioBtnActiveRed]}
                        onPress={() => setTipoMov('SANGRIA')}
                      >
                        <Ionicons name="arrow-up-circle" size={18} color={tipoMov === 'SANGRIA' ? '#FFF' : '#C53030'} />
                        <Text style={[styles.radioBtnText, tipoMov === 'SANGRIA' && styles.radioBtnTextActive]}>
                          Sangria (Retirada de Dinheiro)
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.radioBtn, tipoMov === 'SUPRIMENTO' && styles.radioBtnActiveBlue]}
                        onPress={() => setTipoMov('SUPRIMENTO')}
                      >
                        <Ionicons name="arrow-down-circle" size={18} color={tipoMov === 'SUPRIMENTO' ? '#FFF' : '#2B6CB0'} />
                        <Text style={[styles.radioBtnText, tipoMov === 'SUPRIMENTO' && styles.radioBtnTextActive]}>
                          Suprimento (Entrada de Troco)
                        </Text>
                      </TouchableOpacity>
                    </View>

                    <Text style={styles.inputLabel}>Valor (R$):</Text>
                    <TextInput
                      style={styles.textInputBig}
                      placeholder="0.00"
                      placeholderTextColor="#A0AEC0"
                      keyboardType="numeric"
                      value={valorMov}
                      onChangeText={setValorMov}
                    />

                    <Text style={styles.inputLabel}>Justificativa Obrigatória:</Text>
                    <TextInput
                      style={styles.textInput}
                      placeholder="Ex: Recolhimento de excesso de notas para o cofre"
                      placeholderTextColor="#A0AEC0"
                      value={justificativaMov}
                      onChangeText={setJustificativaMov}
                    />

                    <TouchableOpacity style={styles.btnPrincipal} onPress={handleRegistrarMovimentacao}>
                      <Ionicons name="save-outline" size={18} color="#FFF" style={{ marginRight: 8 }} />
                      <Text style={styles.btnPrincipalText}>Confirmar Movimentação</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {/* ABA: ENCERRAMENTO DE TURNO */}
                {abaAtiva === 'fechamento' && turno && (
                  <View style={styles.formBox}>
                    <View style={styles.warningAlert}>
                      <Ionicons name="alert" size={20} color="#C05621" />
                      <Text style={styles.warningAlertText}>
                        Conferência de Fechamento de Caixa: conte todas as notas e moedas físicas na gaveta
                        e informe o valor exato para o cálculo de sobras ou quebras.
                      </Text>
                    </View>

                    <Text style={styles.inputLabel}>Saldo Físico Apurado em Dinheiro (R$):</Text>
                    <TextInput
                      style={styles.textInputBig}
                      placeholder="Ex: 250.00"
                      placeholderTextColor="#A0AEC0"
                      keyboardType="numeric"
                      value={saldoFechamento}
                      onChangeText={setSaldoFechamento}
                    />

                    <Text style={styles.inputLabel}>Observações do Fechamento (Opcional):</Text>
                    <TextInput
                      style={styles.textInput}
                      placeholder="Observações do operador..."
                      placeholderTextColor="#A0AEC0"
                      value={obsFechamento}
                      onChangeText={setObsFechamento}
                    />

                    <TouchableOpacity style={styles.btnEncerrar} onPress={handleFecharCaixa}>
                      <Ionicons name="checkmark-done" size={18} color="#FFF" style={{ marginRight: 8 }} />
                      <Text style={styles.btnPrincipalText}>Encerrar e Fechar Turno</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {/* Resultado pós-fechamento */}
                {resultadoFechamento && (
                  <View style={styles.resultadoCard}>
                    <Text style={styles.resultadoTitle}>Resumo do Fechamento de Caixa</Text>
                    <Text style={styles.resultadoRow}>Saldo Esperado: {formatCurrency(resultadoFechamento.saldoEsperado)}</Text>
                    <Text style={styles.resultadoRow}>Saldo Físico Informado: {formatCurrency(resultadoFechamento.saldoInformado)}</Text>
                    <Text style={[
                      styles.resultadoDiferenca,
                      resultadoFechamento.diferenca === 0 ? { color: '#276749' } : { color: '#C53030' }
                    ]}>
                      Diferença: {formatCurrency(resultadoFechamento.diferenca)} ({resultadoFechamento.situacao})
                    </Text>
                  </View>
                )}

                {/* ABA: AUDITORIA DO TURNO */}
                {abaAtiva === 'auditoria' && auditoriaData && (
                  <View>
                    <View style={styles.auditoriaHeader}>
                      <Text style={styles.auditoriaTitle}>Auditoria de Integridade do Caixa</Text>
                      <Text style={[
                        styles.auditoriaBadge,
                        auditoriaData.conforme ? styles.badgeConforme : styles.badgeDivergente
                      ]}>
                        {auditoriaData.conforme ? '✓ 100% CONFORME' : '⚠ DIVERGÊNCIA IDENTIFICADA'}
                      </Text>
                    </View>

                    <Text style={styles.miniLabel}>Histórico de Movimentações ({auditoriaData.totalMovimentacoes}):</Text>
                    {auditoriaData.movimentacoes.map((m, idx) => (
                      <View key={idx} style={styles.movCard}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.movTipo}>{m.tipo_operacao} • {m.data_movimentacao.substring(11, 16)}</Text>
                          <Text style={styles.movJust}>{m.justificativa || 'Sem justificativa'}</Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={styles.movValor}>{formatCurrency(m.valor)}</Text>
                          <Text style={styles.movSaldoApos}>Saldo: {formatCurrency(m.saldo_apos)}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </>
            )}
          </ScrollView>

          {/* Footer */}
          <View style={styles.footer}>
            <TouchableOpacity style={styles.btnVoltar} onPress={onClose}>
              <Text style={styles.btnVoltarText}>Fechar Janela</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: 16
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    maxHeight: '90%',
    overflow: 'hidden'
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    backgroundColor: '#F8FAFC'
  },
  title: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1A202C'
  },
  subtitle: {
    fontSize: 12,
    color: '#718096'
  },
  closeBtn: {
    padding: 6
  },
  tabsRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    backgroundColor: '#EDF2F7'
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center'
  },
  tabBtnActive: {
    borderBottomWidth: 3,
    borderBottomColor: '#1E63EC',
    backgroundColor: '#FFFFFF'
  },
  tabBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#718096'
  },
  tabBtnTextActive: {
    color: '#1E63EC'
  },
  body: {
    padding: 16
  },
  centerLoading: {
    padding: 30,
    alignItems: 'center'
  },
  loadingText: {
    marginTop: 10,
    color: '#718096',
    fontSize: 13
  },
  successBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#C6F6D5',
    padding: 10,
    borderRadius: 8,
    marginBottom: 12
  },
  successText: {
    color: '#22543D',
    fontSize: 13,
    marginLeft: 6,
    flex: 1
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FED7D7',
    padding: 10,
    borderRadius: 8,
    marginBottom: 12
  },
  errorText: {
    color: '#742A2A',
    fontSize: 13,
    marginLeft: 6,
    flex: 1
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    marginBottom: 16
  },
  statusAberto: {
    backgroundColor: '#E6FFFA',
    borderWidth: 1,
    borderColor: '#38B2AC'
  },
  statusBloqueado: {
    backgroundColor: '#FFF5F5',
    borderWidth: 1,
    borderColor: '#E53E3E'
  },
  statusBannerTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#1A202C'
  },
  statusBannerSub: {
    fontSize: 12,
    color: '#4A5568',
    marginTop: 2
  },
  gridCards: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16
  },
  cardItem: {
    flexBasis: '48%',
    backgroundColor: '#F7FAFC',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0'
  },
  cardLabel: {
    fontSize: 11,
    color: '#718096'
  },
  cardValue: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#2D3748',
    marginTop: 2
  },
  destaqueSaldoBox: {
    backgroundColor: '#EBF8FF',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#BEE3F8',
    alignItems: 'center',
    marginBottom: 16
  },
  destaqueSaldoLabel: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#2B6CB0'
  },
  destaqueSaldoValor: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#1E63EC',
    marginTop: 4
  },
  destaqueOutros: {
    fontSize: 11,
    color: '#4A5568',
    marginTop: 6
  },
  actionsSection: {
    marginTop: 8
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#2D3748',
    marginBottom: 8
  },
  blockBox: {
    backgroundColor: '#F7FAFC',
    padding: 12,
    borderRadius: 8
  },
  unblockBox: {
    backgroundColor: '#FFF5F5',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FED7D7'
  },
  unblockText: {
    fontSize: 12,
    color: '#9B2C2C',
    marginBottom: 8
  },
  btnBloquear: {
    backgroundColor: '#E53E3E',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
    borderRadius: 8,
    marginTop: 6
  },
  btnDesbloquear: {
    backgroundColor: '#38A169',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
    borderRadius: 8
  },
  btnTextWhite: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 13
  },
  formBox: {
    paddingVertical: 8
  },
  infoAlert: {
    flexDirection: 'row',
    backgroundColor: '#EBF8FF',
    padding: 12,
    borderRadius: 8,
    marginBottom: 14,
    alignItems: 'center'
  },
  infoAlertText: {
    fontSize: 12,
    color: '#2B6CB0',
    marginLeft: 8,
    flex: 1
  },
  warningAlert: {
    flexDirection: 'row',
    backgroundColor: '#FEEBC8',
    padding: 12,
    borderRadius: 8,
    marginBottom: 14,
    alignItems: 'center'
  },
  warningAlertText: {
    fontSize: 12,
    color: '#7B341E',
    marginLeft: 8,
    flex: 1
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4A5568',
    marginBottom: 4,
    marginTop: 8
  },
  textInput: {
    borderWidth: 1,
    borderColor: '#CBD5E0',
    borderRadius: 8,
    padding: 10,
    fontSize: 13,
    color: '#2D3748',
    backgroundColor: '#FFF'
  },
  textInputBig: {
    borderWidth: 1,
    borderColor: '#CBD5E0',
    borderRadius: 8,
    padding: 12,
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1E63EC',
    backgroundColor: '#FFF'
  },
  radioRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8
  },
  radioBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E0',
    backgroundColor: '#F7FAFC'
  },
  radioBtnActiveRed: {
    backgroundColor: '#E53E3E',
    borderColor: '#C53030'
  },
  radioBtnActiveBlue: {
    backgroundColor: '#2B6CB0',
    borderColor: '#2C5282'
  },
  radioBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#4A5568',
    marginLeft: 6
  },
  radioBtnTextActive: {
    color: '#FFF'
  },
  btnPrincipal: {
    backgroundColor: '#1E63EC',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    borderRadius: 8,
    marginTop: 18
  },
  btnPrincipalText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 14
  },
  btnEncerrar: {
    backgroundColor: '#D69E2E',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    borderRadius: 8,
    marginTop: 18
  },
  resultadoCard: {
    backgroundColor: '#F7FAFC',
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginTop: 10
  },
  resultadoTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#2D3748',
    marginBottom: 6
  },
  resultadoRow: {
    fontSize: 12,
    color: '#4A5568',
    marginTop: 2
  },
  resultadoDiferenca: {
    fontSize: 14,
    fontWeight: 'bold',
    marginTop: 6
  },
  auditoriaHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10
  },
  auditoriaTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#2D3748'
  },
  auditoriaBadge: {
    fontSize: 11,
    fontWeight: 'bold',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6
  },
  badgeConforme: {
    backgroundColor: '#C6F6D5',
    color: '#22543D'
  },
  badgeDivergente: {
    backgroundColor: '#FED7D7',
    color: '#742A2A'
  },
  miniLabel: {
    fontSize: 11,
    color: '#718096',
    marginBottom: 6
  },
  movCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 10,
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#EDF2F7'
  },
  movTipo: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#2D3748'
  },
  movJust: {
    fontSize: 11,
    color: '#718096'
  },
  movValor: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#1A202C'
  },
  movSaldoApos: {
    fontSize: 10,
    color: '#A0AEC0'
  },
  footer: {
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    alignItems: 'center'
  },
  btnVoltar: {
    paddingVertical: 8,
    paddingHorizontal: 20
  },
  btnVoltarText: {
    color: '#718096',
    fontWeight: '600'
  }
});

