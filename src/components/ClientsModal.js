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
  Switch
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { 
  fetchClientes, 
  saveCliente, 
  alterarBloqueioInadimplente,
  fetchExtratoCliente,
  registrarPagamentoDebitoCliente
} from '../services/clientService';
import { formatarDocumento, formatarTelefone, validarDocumento, validarTelefone } from '../utils/validators';

export default function ClientsModal({
  visible,
  gerenteId,
  onClose,
  onSelectClient = null
}) {
  const [clientes, setClientes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [erroMsg, setErroMsg] = useState('');
  const [sucessoMsg, setSucessoMsg] = useState('');

  // Form de cadastro / edição
  const [modoEdicao, setModoEdicao] = useState(false);
  const [clienteId, setClienteId] = useState(null);
  const [nome, setNome] = useState('');
  const [cpfCnpj, setCpfCnpj] = useState('');
  const [telefone, setTelefone] = useState('');
  const [email, setEmail] = useState('');
  const [limiteFiado, setLimiteFiado] = useState('200.00');
  const [bloqueadoInadimplente, setBloqueadoInadimplente] = useState(false);
  const [motivoBloqueio, setMotivoBloqueio] = useState('');
  const [salvando, setSalvando] = useState(false);

  // Estados do Extrato da Caderneta (S07)
  const [modoExtrato, setModoExtrato] = useState(false);
  const [extratoClienteObj, setExtratoClienteObj] = useState(null);
  const [extratoData, setExtratoData] = useState(null);
  const [extratoLoading, setExtratoLoading] = useState(false);
  const [valorPagamentoDebito, setValorPagamentoDebito] = useState('');
  const [formaPagamentoDebito, setFormaPagamentoDebito] = useState('dinheiro');
  const [obsPagamentoDebito, setObsPagamentoDebito] = useState('');
  const [salvandoPagamento, setSalvandoPagamento] = useState(false);

  useEffect(() => {
    if (visible && gerenteId) {
      carregarClientes();
    }
  }, [visible, gerenteId]);

  const carregarClientes = async () => {
    setLoading(true);
    setErroMsg('');
    try {
      const list = await fetchClientes(gerenteId, false);
      setClientes(list);
    } catch (e) {
      console.error('Erro ao carregar clientes:', e);
      setErroMsg('Erro ao listar clientes.');
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

  const abrirNovoCliente = () => {
    setClienteId(null);
    setNome('');
    setCpfCnpj('');
    setTelefone('');
    setEmail('');
    setLimiteFiado('200.00');
    setBloqueadoInadimplente(false);
    setMotivoBloqueio('');
    setErroMsg('');
    setSucessoMsg('');
    setModoEdicao(true);
  };

  const abrirEditarCliente = (cli) => {
    setClienteId(cli.id);
    setNome(cli.nome || '');
    setCpfCnpj(cli.cpf || '');
    setTelefone(cli.telefone || '');
    setEmail(cli.email || '');
    setLimiteFiado(String(cli.limite_fiado != null ? cli.limite_fiado : '0'));
    setBloqueadoInadimplente(cli.bloqueado_inadimplente === 1);
    setMotivoBloqueio(cli.motivo_bloqueio || '');
    setErroMsg('');
    setSucessoMsg('');
    setModoEdicao(true);
  };

  const handleSalvarCliente = async () => {
    setErroMsg('');
    setSucessoMsg('');

    if (!nome.trim()) {
      setErroMsg('Nome do cliente é obrigatório.');
      return;
    }

    if (cpfCnpj.trim()) {
      const vDoc = validarDocumento(cpfCnpj);
      if (!vDoc.valido) {
        setErroMsg(`Documento inválido: ${vDoc.mensagem}`);
        return;
      }
    }

    if (telefone.trim()) {
      const vTel = validarTelefone(telefone);
      if (!vTel.valido) {
        setErroMsg(`Contato telefônico inválido: ${vTel.mensagem}`);
        return;
      }
    }

    const limNum = parseFloat(limiteFiado.replace(',', '.'));
    if (isNaN(limNum) || limNum < 0) {
      setErroMsg('Teto de crédito deve ser um valor numérico válido (R$ 0 ou superior).');
      return;
    }

    setSalvando(true);
    try {
      const saved = await saveCliente({
        id: clienteId,
        nome: nome.trim(),
        cpf: cpfCnpj.trim() || null,
        telefone: telefone.trim() || null,
        email: email.trim() || null,
        limite_fiado: limNum,
        bloqueado_inadimplente: bloqueadoInadimplente ? 1 : 0,
        motivo_bloqueio: bloqueadoInadimplente ? (motivoBloqueio.trim() || 'Inadimplência') : null,
        ativo: 1
      }, gerenteId);

      setSucessoMsg(`Cliente "${saved.nome}" salvo com sucesso!`);
      setModoEdicao(false);
      await carregarClientes();
    } catch (e) {
      setErroMsg(e.message || 'Erro ao salvar cliente.');
    } finally {
      setSalvando(false);
    }
  };

  const handleToggleBloqueio = async (cli) => {
    const novoStatus = cli.bloqueado_inadimplente === 1 ? false : true;
    const motivoPadrao = novoStatus ? 'Bloqueio preventivo por atraso de pagamento' : null;
    try {
      await alterarBloqueioInadimplente({
        clienteId: cli.id,
        gerenteId,
        bloquear: novoStatus,
        motivo: motivoPadrao
      });
      await carregarClientes();
    } catch (e) {
      setErroMsg(e.message || 'Erro ao alterar status de bloqueio.');
    }
  };

  const abrirExtratoCliente = async (cli) => {
    setModoEdicao(false);
    setModoExtrato(true);
    setExtratoClienteObj(cli);
    setExtratoLoading(true);
    setErroMsg('');
    setSucessoMsg('');
    setValorPagamentoDebito('');
    try {
      const ext = await fetchExtratoCliente(cli.id, gerenteId);
      setExtratoData(ext);
    } catch (e) {
      console.error('Erro ao consultar extrato:', e);
      setErroMsg(e.message || 'Erro ao consultar extrato de fiado.');
    } finally {
      setExtratoLoading(false);
    }
  };

  const handleRegistrarPagamento = async () => {
    if (!extratoData || !extratoData.cliente) return;
    setErroMsg('');
    const val = parseFloat((valorPagamentoDebito || '').replace(',', '.'));
    if (isNaN(val) || val <= 0) {
      setErroMsg('Informe um valor de pagamento válido maior que zero.');
      return;
    }

    setSalvandoPagamento(true);
    try {
      const res = await registrarPagamentoDebitoCliente({
        clienteId: extratoData.cliente.id,
        valor: val,
        formaPagamento: formaPagamentoDebito,
        operadorId: 1,
        gerenteId,
        observacoes: obsPagamentoDebito.trim() || 'Amortização de fiado na caderneta'
      });
      setSucessoMsg(`Pagamento de ${formatCurrency(res.valorPago)} recebido com sucesso! Saldo restante: ${formatCurrency(res.saldoRestante)}.`);
      setValorPagamentoDebito('');
      setObsPagamentoDebito('');
      // Recarrega extrato e lista de clientes
      const extAtualizado = await fetchExtratoCliente(extratoData.cliente.id, gerenteId);
      setExtratoData(extAtualizado);
      await carregarClientes();
    } catch (e) {
      setErroMsg(e.message || 'Erro ao registrar pagamento.');
    } finally {
      setSalvandoPagamento(false);
    }
  };

  const clientesFiltrados = clientes.filter(c =>
    c.nome.toLowerCase().includes(search.toLowerCase()) ||
    (c.cpf && c.cpf.includes(search)) ||
    (c.telefone && c.telefone.includes(search))
  );

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
              <Ionicons name="people" size={24} color="#1E63EC" style={{ marginRight: 8 }} />
              <View>
                <Text style={styles.title}>Clientes & Teto de Crédito</Text>
                <Text style={styles.subtitle}>Validação de Documento, Contato e Prevenção de Inadimplência</Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color="#718096" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
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

            {modoExtrato ? (
              /* TELA DE EXTRATO DA CADERNETA / HISTÓRICO DE FIADO (S07) */
              <View style={styles.extratoContainer}>
                <View style={styles.extratoHeaderNav}>
                  <TouchableOpacity style={styles.btnVoltarExtrato} onPress={() => setModoExtrato(false)}>
                    <Ionicons name="arrow-back" size={16} color="#1E63EC" style={{ marginRight: 4 }} />
                    <Text style={styles.btnVoltarExtratoText}>Voltar aos Clientes</Text>
                  </TouchableOpacity>
                  <Text style={styles.extratoSectionTitle}>Caderneta Digital</Text>
                </View>

                {extratoLoading || !extratoData ? (
                  <View style={styles.centerLoading}>
                    <ActivityIndicator size="large" color="#1E63EC" />
                    <Text style={styles.loadingText}>Carregando extrato de transações...</Text>
                  </View>
                ) : (
                  <>
                    {/* Cartão de Identificação do Cliente */}
                    <View style={styles.extratoClienteCard}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.extratoClienteNome}>{extratoData.cliente.nome}</Text>
                        <Text style={styles.extratoClienteDoc}>
                          Doc: {extratoData.cliente.cpf || 'Não informado'} • Fone: {extratoData.cliente.telefone || 'Não informado'}
                        </Text>
                      </View>
                      {extratoData.cliente.bloqueadoInadimplente ? (
                        <View style={styles.badgeBloqueado}>
                          <Text style={styles.badgeBloqueadoText}>BLOQUEADO</Text>
                        </View>
                      ) : (
                        <View style={styles.badgeAdimplente}>
                          <Text style={styles.badgeAdimplenteText}>ATIVO</Text>
                        </View>
                      )}
                    </View>

                    {/* Resumo Financeiro em 3 Cards */}
                    <View style={styles.extratoResumoRow}>
                      <View style={[styles.extratoResumoCard, { backgroundColor: '#F7FAFC' }]}>
                        <Text style={styles.extratoResumoLabel}>TETO CRÉDITO</Text>
                        <Text style={[styles.extratoResumoVal, { color: '#4A5568' }]}>
                          {formatCurrency(extratoData.totais.limiteFiado)}
                        </Text>
                      </View>

                      <View style={[styles.extratoResumoCard, { backgroundColor: '#FFF5F5' }]}>
                        <Text style={styles.extratoResumoLabel}>DÉBITO ATUAL</Text>
                        <Text style={[styles.extratoResumoVal, { color: extratoData.totais.saldoDevedorAtual > 0 ? '#C53030' : '#276749' }]}>
                          {formatCurrency(extratoData.totais.saldoDevedorAtual)}
                        </Text>
                      </View>

                      <View style={[styles.extratoResumoCard, { backgroundColor: '#F0FFF4' }]}>
                        <Text style={styles.extratoResumoLabel}>DISPONÍVEL</Text>
                        <Text style={[styles.extratoResumoVal, { color: '#276749' }]}>
                          {formatCurrency(extratoData.totais.limiteDisponivel)}
                        </Text>
                      </View>
                    </View>

                    {/* Formulário para Receber Pagamento de Conta / Amortização */}
                    {extratoData.totais.saldoDevedorAtual > 0 && (
                      <View style={styles.amortizacaoBox}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <Text style={styles.amortizacaoTitle}>Receber Pagamento de Conta (Amortização)</Text>
                          <TouchableOpacity
                            style={styles.btnQuitarTotal}
                            onPress={() => setValorPagamentoDebito(String(extratoData.totais.saldoDevedorAtual.toFixed(2)))}
                          >
                            <Text style={styles.btnQuitarTotalText}>Quitar Total</Text>
                          </TouchableOpacity>
                        </View>

                        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                          <TextInput
                            style={[styles.textInput, { flex: 1, marginBottom: 0 }]}
                            placeholder={`Valor R$ (Máx: ${extratoData.totais.saldoDevedorAtual.toFixed(2)})`}
                            placeholderTextColor="#A0AEC0"
                            keyboardType="numeric"
                            value={valorPagamentoDebito}
                            onChangeText={setValorPagamentoDebito}
                          />

                          <View style={styles.formaDebitoRow}>
                            {['dinheiro', 'pix', 'cartao_debito'].map(f => (
                              <TouchableOpacity
                                key={f}
                                style={[styles.formaDebitoBtn, formaPagamentoDebito === f && styles.formaDebitoBtnActive]}
                                onPress={() => setFormaPagamentoDebito(f)}
                              >
                                <Text style={[styles.formaDebitoBtnText, formaPagamentoDebito === f && styles.formaDebitoBtnTextActive]}>
                                  {f === 'dinheiro' ? 'Dinheiro' : f === 'pix' ? 'PIX' : 'Débito'}
                                </Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                        </View>

                        <TextInput
                          style={[styles.textInput, { marginBottom: 8 }]}
                          placeholder="Observações (Ex: Pago no balcão pelo próprio cliente)"
                          placeholderTextColor="#A0AEC0"
                          value={obsPagamentoDebito}
                          onChangeText={setObsPagamentoDebito}
                        />

                        <TouchableOpacity
                          style={styles.btnRegistrarPagamento}
                          onPress={handleRegistrarPagamento}
                          disabled={salvandoPagamento}
                        >
                          {salvandoPagamento ? (
                            <ActivityIndicator size="small" color="#FFF" />
                          ) : (
                            <>
                              <Ionicons name="checkmark-circle-outline" size={16} color="#FFF" style={{ marginRight: 6 }} />
                              <Text style={styles.btnRegistrarPagamentoText}>Registrar Pagamento na Caderneta</Text>
                            </>
                          )}
                        </TouchableOpacity>
                      </View>
                    )}

                    {/* Linha do Tempo de Transações */}
                    <Text style={styles.transacoesSectionTitle}>
                      Histórico de Transações a Prazo ({extratoData.transacoes.length})
                    </Text>

                    {extratoData.transacoes.length === 0 ? (
                      <View style={styles.emptyTransacoesBox}>
                        <Ionicons name="receipt-outline" size={32} color="#CBD5E0" />
                        <Text style={styles.emptyTransacoesText}>Nenhuma movimentação de fiado registrada para este cliente.</Text>
                      </View>
                    ) : (
                      extratoData.transacoes.map((item, idx) => {
                        const isDebito = item.tipoOperacao === 'DEBITO';
                        const isEstorno = item.tipo === 'CANCELAMENTO_ESTORNO' || item.tipo === 'DEVOLUCAO_ESTORNO';
                        const isPagamento = item.tipo === 'PAGAMENTO_DEBITO';

                        return (
                          <View key={idx} style={[styles.transacaoCard, isDebito ? styles.transacaoCardDebito : styles.transacaoCardCredito]}>
                            <View style={{ flex: 1 }}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                                <View style={[
                                  styles.badgeTipoOperacao,
                                  isDebito ? styles.badgeDebito : isPagamento ? styles.badgePagamento : styles.badgeEstorno
                                ]}>
                                  <Text style={styles.badgeTipoOperacaoText}>
                                    {isDebito ? 'COMPRA A PRAZO' : isPagamento ? 'PAGAMENTO' : 'ESTORNO'}
                                  </Text>
                                </View>
                                <Text style={styles.transacaoRef}>{item.referencia}</Text>
                              </View>
                              <Text style={styles.transacaoDesc}>{item.descricao}</Text>
                              <Text style={styles.transacaoData}>
                                {new Date(item.data).toLocaleString('pt-BR')}
                              </Text>
                            </View>

                            <View style={{ alignItems: 'flex-end', justifyContent: 'center' }}>
                              <Text style={[
                                styles.transacaoValor,
                                isDebito ? { color: '#C53030' } : { color: '#276749' }
                              ]}>
                                {isDebito ? `+ ${formatCurrency(item.valor)}` : `- ${formatCurrency(item.valor)}`}
                              </Text>
                              <Text style={styles.transacaoSaldoApos}>
                                Saldo: {formatCurrency(item.saldoAcumuladoApos)}
                              </Text>
                            </View>
                          </View>
                        );
                      })
                    )}
                  </>
                )}
              </View>
            ) : modoEdicao ? (
              /* FORMULÁRIO DE CADASTRO / EDIÇÃO */
              <View style={styles.formContainer}>
                <Text style={styles.formSectionTitle}>
                  {clienteId ? 'Editar Cadastro de Cliente' : 'Novo Cliente'}
                </Text>

                <Text style={styles.inputLabel}>Nome Completo *</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="Nome do cliente"
                  placeholderTextColor="#A0AEC0"
                  value={nome}
                  onChangeText={setNome}
                />

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>CPF ou CNPJ</Text>
                    <TextInput
                      style={styles.textInput}
                      placeholder="000.000.000-00"
                      placeholderTextColor="#A0AEC0"
                      keyboardType="numeric"
                      value={cpfCnpj}
                      onChangeText={(t) => setCpfCnpj(formatarDocumento(t))}
                    />
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>Telefone / WhatsApp</Text>
                    <TextInput
                      style={styles.textInput}
                      placeholder="(00) 00000-0000"
                      placeholderTextColor="#A0AEC0"
                      keyboardType="phone-pad"
                      value={telefone}
                      onChangeText={(t) => setTelefone(formatarTelefone(t))}
                    />
                  </View>
                </View>

                <Text style={styles.inputLabel}>E-mail (Opcional)</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="cliente@email.com"
                  placeholderTextColor="#A0AEC0"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  value={email}
                  onChangeText={setEmail}
                />

                <Text style={styles.inputLabel}>Teto de Crédito Personalizado (Limite Fiado R$):</Text>
                <TextInput
                  style={styles.textInputBig}
                  placeholder="200.00"
                  placeholderTextColor="#A0AEC0"
                  keyboardType="numeric"
                  value={limiteFiado}
                  onChangeText={setLimiteFiado}
                />
                <Text style={styles.helperText}>
                  Valor máximo que o cliente pode acumular em débito pendente.
                </Text>

                {/* Bloqueio Preventivo */}
                <View style={styles.switchRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.switchLabel}>Bloqueio Preventivo de Inadimplência</Text>
                    <Text style={styles.switchSub}>
                      Impede imediatamente novas vendas a prazo/fiado no checkout.
                    </Text>
                  </View>
                  <Switch
                    value={bloqueadoInadimplente}
                    onValueChange={setBloqueadoInadimplente}
                    trackColor={{ false: '#CBD5E0', true: '#FEB2B2' }}
                    thumbColor={bloqueadoInadimplente ? '#E53E3E' : '#FFF'}
                  />
                </View>

                {bloqueadoInadimplente && (
                  <View style={{ marginTop: 8 }}>
                    <Text style={styles.inputLabel}>Motivo / Justificativa do Bloqueio:</Text>
                    <TextInput
                      style={styles.textInput}
                      placeholder="Ex: Parcela vencida há mais de 15 dias"
                      placeholderTextColor="#A0AEC0"
                      value={motivoBloqueio}
                      onChangeText={setMotivoBloqueio}
                    />
                  </View>
                )}

                {/* Botões do Form */}
                <View style={styles.formBtnRow}>
                  <TouchableOpacity
                    style={styles.btnSecundario}
                    onPress={() => setModoEdicao(false)}
                    disabled={salvando}
                  >
                    <Text style={styles.btnSecundarioText}>Cancelar</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.btnSalvar}
                    onPress={handleSalvarCliente}
                    disabled={salvando}
                  >
                    {salvando ? (
                      <ActivityIndicator color="#FFF" size="small" />
                    ) : (
                      <Text style={styles.btnSalvarText}>Salvar Cliente</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              /* LISTAGEM DE CLIENTES */
              <View>
                <View style={styles.topActionsRow}>
                  <View style={styles.searchBox}>
                    <Ionicons name="search" size={16} color="#A0AEC0" style={{ marginRight: 6 }} />
                    <TextInput
                      style={styles.searchInput}
                      placeholder="Buscar por nome, CPF ou fone..."
                      placeholderTextColor="#A0AEC0"
                      value={search}
                      onChangeText={setSearch}
                    />
                  </View>

                  <TouchableOpacity style={styles.btnNovoCliente} onPress={abrirNovoCliente}>
                    <Ionicons name="person-add" size={16} color="#FFF" style={{ marginRight: 6 }} />
                    <Text style={styles.btnNovoClienteText}>Novo</Text>
                  </TouchableOpacity>
                </View>

                {loading ? (
                  <ActivityIndicator size="large" color="#1E63EC" style={{ marginVertical: 30 }} />
                ) : clientesFiltrados.length === 0 ? (
                  <View style={styles.emptyBox}>
                    <Ionicons name="people-outline" size={36} color="#A0AEC0" />
                    <Text style={styles.emptyText}>Nenhum cliente cadastrado.</Text>
                  </View>
                ) : (
                  clientesFiltrados.map((cli) => {
                    const isBloqueado = cli.bloqueado_inadimplente === 1;
                    const saldo = Number(cli.saldo_devedor) || 0;
                    const limite = Number(cli.limite_fiado) || 0;
                    const excedido = limite > 0 && saldo >= limite;

                    return (
                      <View key={cli.id} style={[styles.clientCard, isBloqueado && styles.cardBloqueado]}>
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Text style={styles.clientNome}>{cli.nome}</Text>
                            {isBloqueado && (
                              <View style={styles.badgeBloqueado}>
                                <Text style={styles.badgeBloqueadoText}>BLOQUEADO</Text>
                              </View>
                            )}
                            {excedido && !isBloqueado && (
                              <View style={styles.badgeLimite}>
                                <Text style={styles.badgeLimiteText}>TETO ATINGIDO</Text>
                              </View>
                            )}
                          </View>

                          <Text style={styles.clientMeta}>
                            Doc: {cli.cpf || 'Não informado'} • Fone: {cli.telefone || 'Não informado'}
                          </Text>

                          <View style={styles.financeRow}>
                            <Text style={styles.saldoDevedorText}>
                              Débito: <Text style={{ color: saldo > 0 ? '#C53030' : '#276749', fontWeight: 'bold' }}>{formatCurrency(saldo)}</Text>
                            </Text>
                            <Text style={styles.limiteText}>
                              Teto: <Text style={{ fontWeight: 'bold' }}>{formatCurrency(limite)}</Text>
                            </Text>
                          </View>

                          {isBloqueado && (
                            <Text style={styles.motivoBloqText}>
                              Motivo: {cli.motivo_bloqueio || 'Inadimplência registrada'}
                            </Text>
                          )}
                        </View>

                        <View style={styles.clientActionsCol}>
                          <TouchableOpacity
                            style={styles.btnExtratoAcao}
                            onPress={() => abrirExtratoCliente(cli)}
                          >
                            <Ionicons name="receipt-outline" size={14} color="#1E63EC" style={{ marginRight: 3 }} />
                            <Text style={styles.btnExtratoAcaoText}>Extrato</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={styles.iconActionBtn}
                            onPress={() => abrirEditarCliente(cli)}
                          >
                            <Ionicons name="create-outline" size={18} color="#1E63EC" />
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={[styles.toggleBloqBtn, isBloqueado ? styles.btnDesbloqSmall : styles.btnBloqSmall]}
                            onPress={() => handleToggleBloqueio(cli)}
                          >
                            <Ionicons
                              name={isBloqueado ? 'lock-open-outline' : 'lock-closed-outline'}
                              size={15}
                              color={isBloqueado ? '#276749' : '#C53030'}
                            />
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })
                )}
              </View>
            )}
          </ScrollView>

          {/* Footer */}
          <View style={styles.footer}>
            <TouchableOpacity style={styles.btnFechar} onPress={onClose}>
              <Text style={styles.btnFecharText}>Fechar Janela</Text>
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
  body: {
    padding: 16
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
  topActionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    paddingHorizontal: 10,
    height: 42
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: '#1E293B'
  },
  btnNovoCliente: {
    backgroundColor: '#1E63EC',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    borderRadius: 8,
    height: 42
  },
  btnNovoClienteText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 13
  },
  emptyBox: {
    alignItems: 'center',
    paddingVertical: 30
  },
  emptyText: {
    color: '#A0AEC0',
    marginTop: 8,
    fontSize: 13
  },
  clientCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0'
  },
  cardBloqueado: {
    backgroundColor: '#FFF5F5',
    borderColor: '#FEB2B2'
  },
  clientNome: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#1E293B'
  },
  badgeBloqueado: {
    backgroundColor: '#FED7D7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4
  },
  badgeBloqueadoText: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#C53030'
  },
  badgeLimite: {
    backgroundColor: '#FEEBC8',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4
  },
  badgeLimiteText: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#C05621'
  },
  clientMeta: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2
  },
  financeRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 6
  },
  saldoDevedorText: {
    fontSize: 12,
    color: '#475569'
  },
  limiteText: {
    fontSize: 12,
    color: '#475569'
  },
  motivoBloqText: {
    fontSize: 11,
    color: '#C53030',
    fontStyle: 'italic',
    marginTop: 4
  },
  clientActionsCol: {
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingLeft: 8
  },
  iconActionBtn: {
    padding: 6
  },
  toggleBloqBtn: {
    padding: 6,
    borderRadius: 6
  },
  btnBloqSmall: {
    backgroundColor: '#FED7D7'
  },
  btnDesbloqSmall: {
    backgroundColor: '#C6F6D5'
  },
  formContainer: {
    paddingVertical: 4
  },
  formSectionTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#1E293B',
    marginBottom: 10
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
    marginBottom: 4,
    marginTop: 8
  },
  textInput: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    padding: 10,
    fontSize: 13,
    color: '#1E293B',
    backgroundColor: '#FFF'
  },
  textInputBig: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    padding: 10,
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1E63EC',
    backgroundColor: '#FFF'
  },
  helperText: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    padding: 12,
    borderRadius: 8,
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0'
  },
  switchLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#1E293B'
  },
  switchSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2
  },
  formBtnRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 20
  },
  btnSecundario: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    alignItems: 'center'
  },
  btnSecundarioText: {
    color: '#64748B',
    fontWeight: '600',
    fontSize: 13
  },
  btnSalvar: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#1E63EC',
    alignItems: 'center'
  },
  btnSalvarText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 13
  },
  footer: {
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    alignItems: 'center'
  },
  btnFechar: {
    paddingVertical: 8,
    paddingHorizontal: 20
  },
  btnFecharText: {
    color: '#64748B',
    fontWeight: '600'
  },
  btnExtratoAcao: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EBF8FF',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#BEE3F8'
  },
  btnExtratoAcaoText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#1E63EC'
  },
  extratoContainer: {
    paddingVertical: 4
  },
  extratoHeaderNav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12
  },
  btnVoltarExtrato: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6
  },
  btnVoltarExtratoText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1E63EC'
  },
  extratoSectionTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#1E293B'
  },
  centerLoading: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 30
  },
  loadingText: {
    marginTop: 8,
    fontSize: 12,
    color: '#64748B'
  },
  extratoClienteCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 10
  },
  extratoClienteNome: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#0F172A'
  },
  extratoClienteDoc: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2
  },
  badgeAdimplente: {
    backgroundColor: '#DEF7EC',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6
  },
  badgeAdimplenteText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#03543F'
  },
  extratoResumoRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12
  },
  extratoResumoCard: {
    flex: 1,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center'
  },
  extratoResumoLabel: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#64748B',
    textTransform: 'uppercase'
  },
  extratoResumoVal: {
    fontSize: 13,
    fontWeight: 'bold',
    marginTop: 3
  },
  amortizacaoBox: {
    backgroundColor: '#F8FAFC',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    marginBottom: 14
  },
  amortizacaoTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#1E293B'
  },
  btnQuitarTotal: {
    backgroundColor: '#E2E8F0',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4
  },
  btnQuitarTotalText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#334155'
  },
  formaDebitoRow: {
    flexDirection: 'row',
    gap: 4
  },
  formaDebitoBtn: {
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#EDF2F7',
    borderWidth: 1,
    borderColor: '#CBD5E1'
  },
  formaDebitoBtnActive: {
    backgroundColor: '#1E63EC',
    borderColor: '#1E63EC'
  },
  formaDebitoBtnText: {
    fontSize: 11,
    color: '#475569',
    fontWeight: '600'
  },
  formaDebitoBtnTextActive: {
    color: '#FFF',
    fontWeight: 'bold'
  },
  btnRegistrarPagamento: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#276749',
    paddingVertical: 10,
    borderRadius: 8
  },
  btnRegistrarPagamentoText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: 'bold'
  },
  transacoesSectionTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#334155',
    marginBottom: 8
  },
  emptyTransacoesBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0'
  },
  emptyTransacoesText: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 6
  },
  transacaoCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 8
  },
  transacaoCardDebito: {
    backgroundColor: '#FFFDFD',
    borderColor: '#FED7D7'
  },
  transacaoCardCredito: {
    backgroundColor: '#F8FFF9',
    borderColor: '#C6F6D5'
  },
  badgeTipoOperacao: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4
  },
  badgeDebito: {
    backgroundColor: '#FEB2B2'
  },
  badgePagamento: {
    backgroundColor: '#BEE3F8'
  },
  badgeEstorno: {
    backgroundColor: '#C6F6D5'
  },
  badgeTipoOperacaoText: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#1A202C'
  },
  transacaoRef: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#475569'
  },
  transacaoDesc: {
    fontSize: 11,
    color: '#334155',
    marginTop: 1
  },
  transacaoData: {
    fontSize: 10,
    color: '#94A3B8',
    marginTop: 2
  },
  transacaoValor: {
    fontSize: 13,
    fontWeight: 'bold'
  },
  transacaoSaldoApos: {
    fontSize: 10,
    color: '#64748B',
    marginTop: 2
  }
});

