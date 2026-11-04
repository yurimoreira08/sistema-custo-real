import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Modal
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useApp } from '../context/AppContext';
import { finalizarVendaCompleta } from '../database/db';
import { Ionicons } from '@expo/vector-icons';
import BarcodeScannerModal from '../components/BarcodeScannerModal';
import { feedbackFound, feedbackNotFound } from '../utils/scanFeedback';
import SyncBadge from '../components/SyncBadge';
import ConfirmationModal from '../components/ConfirmationModal';
import CheckoutPaymentModal from '../components/CheckoutPaymentModal';
import CashRegisterModal from '../components/CashRegisterModal';
import ClientsModal from '../components/ClientsModal';
import { obterTurnoAtivo } from '../services/cashService';

export default function NewSaleScreen() {
  const { user, products, settings, sales, refreshData } = useApp();
  const [cart, setCart] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [scannerVisible, setScannerVisible] = useState(false);
  const [clearCartModalVisible, setClearCartModalVisible] = useState(false);
  const [checkoutModalVisible, setCheckoutModalVisible] = useState(false);
  const [successModalVisible, setSuccessModalVisible] = useState(false);

  // Turno de Caixa e Controle de Ciclo de Vida
  const [turnoCaixa, setTurnoCaixa] = useState(null);
  const [cashModalVisible, setCashModalVisible] = useState(false);
  const [clientsModalVisible, setClientsModalVisible] = useState(false);

  const [vendaSucessoInfo, setVendaSucessoInfo] = useState(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  const [alertVisible, setAlertVisible] = useState(false);
  const [alertConfig, setAlertConfig] = useState({ title: '', message: '', type: 'info' });
  const showCustomAlert = (title, message, type = 'info') => {
    setAlertConfig({ title, message, type });
    setAlertVisible(true);
  };

  const nextSaleNum = `#${String(sales.length + 1).padStart(4, '0')}`;

  const carregarTurno = async () => {
    if (user?.id) {
      try {
        const t = await obterTurnoAtivo(user.id, user.gerente_id);
        setTurnoCaixa(t);
      } catch (e) {
        console.warn('Erro ao carregar turno de caixa:', e);
      }
    }
  };

  useEffect(() => {
    carregarTurno();
  }, [user]);

  const searchResults = products.filter(p => 
    p.nome.toLowerCase().includes(searchQuery.toLowerCase()) || 
    (p.marca && p.marca.toLowerCase().includes(searchQuery.toLowerCase())) ||
    (p.codigo_barras && p.codigo_barras.includes(searchQuery))
  );

  const formatCurrency = (val) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(val || 0);
  };

  const handleSelectItem = (product) => {
    if (product.estoque <= 0) {
      showCustomAlert('Bloqueio de Estoque', 'Este produto está com estoque zerado.', 'danger');
      return;
    }

    const cartIndex = cart.findIndex(item => item.id === product.id);
    
    if (cartIndex > -1) {
      const currentQty = cart[cartIndex].quantidade;
      if (currentQty + 1 > product.estoque) {
        showCustomAlert('Bloqueio de Estoque', `Não há estoque suficiente de "${product.nome}". Estoque disponível: ${product.estoque} un.`, 'danger');
        return;
      }
      const updatedCart = [...cart];
      updatedCart[cartIndex].quantidade += 1;
      setCart(updatedCart);
    } else {
      setCart([...cart, { ...product, quantidade: 1 }]);
    }
    
    setSearchQuery('');
    setShowSearchResults(false);
  };

  const handleUpdateQty = (productId, change) => {
    const product = products.find(p => p.id === productId);
    if (!product) return;

    const cartIndex = cart.findIndex(item => item.id === productId);
    if (cartIndex === -1) return;

    const newQty = cart[cartIndex].quantidade + change;

    if (newQty <= 0) {
      const updatedCart = cart.filter(item => item.id !== productId);
      setCart(updatedCart);
    } else {
      if (newQty > product.estoque) {
        showCustomAlert('Bloqueio de Estoque', `Não é possível adicionar mais unidades. Estoque disponível: ${product.estoque} un.`, 'danger');
        return;
      }
      const updatedCart = [...cart];
      updatedCart[cartIndex].quantidade = newQty;
      setCart(updatedCart);
    }
  };

  const handleClearCart = () => {
    if (cart.length === 0) return;
    setClearCartModalVisible(true);
  };

  const subtotal = cart.reduce((sum, item) => sum + (item.preco_venda * item.quantidade), 0);
  const totalItensCount = cart.reduce((sum, item) => sum + item.quantidade, 0);

  /**
   * Bloqueio rigoroso do checkout sem caixa ativo ou se estiver bloqueado
   */
  const handleCheckout = async () => {
    if (cart.length === 0) return;

    try {
      const turno = await obterTurnoAtivo(user?.id, user?.gerente_id);
      setTurnoCaixa(turno);

      if (!turno) {
        showCustomAlert(
          'Caixa Fechado',
          'Checkout bloqueado: Não há caixa aberto para o seu operador. Realize a abertura do caixa com o fundo de troco inicial para registrar vendas.',
          'danger'
        );
        setCashModalVisible(true);
        return;
      }

      if (turno.status === 'bloqueado') {
        showCustomAlert(
          'Caixa Bloqueado',
          `Checkout bloqueado: O caixa #${turno.id} está temporariamente BLOQUEADO (${turno.motivo_bloqueio || 'Operação suspensa'}). Desbloqueie o caixa para continuar.`,
          'danger'
        );
        setCashModalVisible(true);
        return;
      }

      setCheckoutModalVisible(true);
    } catch (e) {
      setCheckoutModalVisible(true);
    }
  };

  const confirmCheckout = async (dadosCheckout) => {
    setCheckoutLoading(true);
    try {
      const res = await finalizarVendaCompleta({
        carrinho: cart,
        pagamentos: dadosCheckout.pagamentos,
        clienteId: dadosCheckout.clienteId,
        descontoGlobal: dadosCheckout.descontoGlobal,
        canalVenda: dadosCheckout.canalVenda,
        usuarioId: user.id
      }, user.gerente_id);

      setCheckoutModalVisible(false);
      setVendaSucessoInfo(res);
      setSuccessModalVisible(true);
      await refreshData();
      await carregarTurno();
    } catch (error) {
      showCustomAlert('Erro ao Finalizar Venda', error.message || 'Houve um erro no processamento.', 'danger');
      console.error(error);
    } finally {
      setCheckoutLoading(false);
    }
  };

  const findByBarcode = (code) => {
    const cleanCode = code.trim();
    if (!cleanCode) return null;
    return products.find(p => p.codigo_barras && p.codigo_barras.trim() === cleanCode) || null;
  };

  const handleSearchTextChange = (text) => {
    setSearchQuery(text);

    const cleanCode = text.trim();
    if (cleanCode.length >= 3) {
      const exactMatch = findByBarcode(cleanCode);
      if (exactMatch) {
        feedbackFound();
        handleSelectItem(exactMatch);
        setSearchQuery('');
        setShowSearchResults(false);
        return;
      }
    }

    setShowSearchResults(text.length > 0);
  };

  const handleSubmitEditing = () => {
    const exactMatch = findByBarcode(searchQuery);
    if (exactMatch) {
      handleSelectItem(exactMatch);
      setSearchQuery('');
      setShowSearchResults(false);
    }
  };

  const handleScanCode = (code) => {
    const product = findByBarcode(code);
    if (product) {
      feedbackFound();
      handleSelectItem(product);
      setScannerVisible(false);
    } else {
      feedbackNotFound();
      showCustomAlert('Produto não encontrado', `Nenhum produto cadastrado com o código "${code.trim()}".`, 'danger');
    }
  };

  const renderCartItem = ({ item }) => (
    <View style={styles.cartItemRow}>
      <View style={styles.cartItemLeft}>
        <Text style={styles.cartItemName}>{item.nome}</Text>
        <Text style={styles.cartItemBrand}>{item.marca || 'Sem marca'} • {formatCurrency(item.preco_venda)}/un</Text>
      </View>
      <View style={styles.cartItemRight}>
        <View style={styles.qtyContainer}>
          <TouchableOpacity style={styles.qtyBtn} onPress={() => handleUpdateQty(item.id, -1)}>
            <Ionicons name="remove" size={14} color="#4A5568" />
          </TouchableOpacity>
          <Text style={styles.qtyText}>{item.quantidade}</Text>
          <TouchableOpacity style={styles.qtyBtn} onPress={() => handleUpdateQty(item.id, 1)}>
            <Ionicons name="add" size={14} color="#4A5568" />
          </TouchableOpacity>
        </View>
        <Text style={styles.cartItemSubtotal}>{formatCurrency(item.preco_venda * item.quantidade)}</Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <StatusBar style="light" />

      {/* Header Bar com Badge de Ciclo de Vida do Caixa */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="cart" size={24} color="#FFF" style={{ marginRight: 8 }} />
          <View>
            <Text style={styles.headerTitle}>Nova Venda</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
              {/* Pill de Status do Caixa */}
            <TouchableOpacity 
              style={[
                styles.caixaStatusPill,
                !turnoCaixa ? styles.caixaFechadoPill : turnoCaixa.status === 'aberto' ? styles.caixaAbertoPill : styles.caixaBloqueadoPill
              ]}
              onPress={() => setCashModalVisible(true)}
            >
              <Ionicons 
                name={!turnoCaixa ? "ellipse" : turnoCaixa.status === 'aberto' ? "checkmark-circle" : "lock-closed"} 
                size={11} 
                color="#FFF" 
                style={{ marginRight: 4 }} 
              />
              <Text style={styles.caixaStatusPillText}>
                {!turnoCaixa ? "Caixa Fechado" : turnoCaixa.status === 'aberto' ? `Caixa #${turnoCaixa.id}` : "Bloqueado"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.clientesPill}
              onPress={() => setClientsModalVisible(true)}
            >
              <Ionicons name="people" size={11} color="#FFF" style={{ marginRight: 4 }} />
              <Text style={styles.caixaStatusPillText}>Clientes & Fiado</Text>
            </TouchableOpacity>
            </View>
          </View>
        </View>

        <View style={styles.headerRight}>
          <SyncBadge />
          <Text style={styles.ticketNumber}>{nextSaleNum}</Text>
          <TouchableOpacity 
            style={[styles.cancelBtn, cart.length === 0 && { opacity: 0.5 }]} 
            onPress={handleClearCart}
            disabled={cart.length === 0}
          >
            <Text style={styles.cancelBtnText}>Cancelar</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.mainContainer}>
        {/* Painel: Adicionar Produto */}
        <View style={styles.addProductCard}>
          <Text style={styles.addProductLabel}>🔍 ADICIONAR PRODUTO</Text>
          <View style={styles.searchInputWrapper}>
            <Ionicons name="search" size={18} color="#A0AEC0" style={{ marginRight: 8 }} />
            <TextInput
              style={styles.searchInput}
              placeholder="Nome ou código do produto..."
              placeholderTextColor="#A0AEC0"
              value={searchQuery}
              onChangeText={handleSearchTextChange}
              onFocus={() => setShowSearchResults(searchQuery.length > 0)}
              onSubmitEditing={handleSubmitEditing}
              returnKeyType="search"
              blurOnSubmit={false}
              autoCorrect={false}
              autoCapitalize="none"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => handleSearchTextChange('')} style={{ marginLeft: 4 }}>
                <Ionicons name="close-circle" size={18} color="#A0AEC0" />
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.scanIconBtn} onPress={() => setScannerVisible(true)}>
              <Ionicons name="barcode-outline" size={20} color="#FFF" />
            </TouchableOpacity>
          </View>

          {/* Resultados da busca */}
          {showSearchResults && (
            <View style={styles.searchResultsDropdown}>
              {searchResults.length === 0 ? (
                <View style={styles.searchEmptyRow}>
                  <Text style={styles.searchEmptyText}>Nenhum produto correspondente.</Text>
                </View>
              ) : (
                <ScrollView 
                  style={{ maxHeight: 200 }} 
                  keyboardShouldPersistTaps="handled"
                  nestedScrollEnabled={true}
                >
                  {searchResults.map((item) => {
                    const isOutOfStock = item.estoque <= 0;
                    return (
                      <TouchableOpacity 
                        key={item.id.toString()} 
                        style={[styles.searchResultItem, isOutOfStock && { opacity: 0.5 }]}
                        onPress={() => handleSelectItem(item)}
                      >
                        <View>
                          <Text style={styles.searchResultName}>{item.nome}</Text>
                          <Text style={styles.searchResultMeta}>
                            Marca: {item.marca || 'N/D'} • Categoria: {item.categoria || 'N/D'}
                          </Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={styles.searchResultPrice}>{formatCurrency(item.preco_venda)}</Text>
                          <Text style={[
                            styles.searchResultStock, 
                            isOutOfStock ? { color: '#E53E3E' } : { color: '#48BB78' }
                          ]}>
                            Estoque: {item.estoque} un
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}
            </View>
          )}
        </View>

        {/* Título da seção carrinho */}
        <View style={styles.cartTitleRow}>
          <Text style={styles.cartTitleText}>🛒 Itens da venda ({cart.length})</Text>
        </View>

        {/* Lista do Carrinho */}
        <View style={styles.cartAreaContainer}>
          {cart.length === 0 ? (
            <View style={styles.emptyCartContainer}>
              <View style={styles.bagsGraphic}>
                <View style={[styles.bagSquare, { backgroundColor: '#4299E1', zIndex: 2 }]}>
                  <View style={styles.bagHandleArc} />
                  <View style={styles.bagLines} />
                </View>
                <View style={[styles.bagSquare, { backgroundColor: '#ED8936', zIndex: 1, transform: [{ translateX: 14 }, { translateY: 6 }, { scale: 0.85 }] }]}>
                  <View style={styles.bagHandleArc} />
                </View>
              </View>
              
              <Text style={styles.emptyCartMainText}>Nenhum produto adicionado.</Text>
              <Text style={styles.emptyCartSubText}>Busque um produto acima.</Text>
            </View>
          ) : (
            <FlatList
              data={cart}
              keyExtractor={(item) => item.id.toString()}
              renderItem={renderCartItem}
              contentContainerStyle={{ padding: 12 }}
            />
          )}
        </View>
      </View>

      {/* Rodapé Resumo de Valores */}
      <View style={styles.footerPanel}>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Subtotal</Text>
          <Text style={styles.summaryValue}>{formatCurrency(subtotal)}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Itens</Text>
          <Text style={styles.summaryValue}>{totalItensCount} un</Text>
        </View>

        <View style={styles.dashedDivider} />

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>{formatCurrency(subtotal)}</Text>
        </View>

        {/* Botão Finalizar Venda */}
        <TouchableOpacity 
          style={[
            styles.checkoutBtn, 
            cart.length === 0 ? styles.checkoutBtnDisabled : styles.checkoutBtnEnabled
          ]} 
          onPress={handleCheckout}
          disabled={cart.length === 0}
        >
          <Ionicons 
            name="checkmark-circle" 
            size={20} 
            color={cart.length === 0 ? "rgba(255,255,255,0.4)" : "#FFF"} 
            style={{ marginRight: 8 }} 
          />
          <Text style={[
            styles.checkoutBtnText,
            cart.length === 0 && { color: 'rgba(255,255,255,0.4)' }
          ]}>
            Finalizar Venda
          </Text>
        </TouchableOpacity>
      </View>

      {/* Modal de Leitura por Câmera */}
      <Modal
        visible={scannerVisible}
        animationType="slide"
        onRequestClose={() => setScannerVisible(false)}
      >
        <BarcodeScannerModal
          onScan={handleScanCode}
          onClose={() => setScannerVisible(false)}
        />
      </Modal>

      {/* Modal de Confirmação de Esvaziamento */}
      <ConfirmationModal
        visible={clearCartModalVisible}
        title="Cancelar Venda"
        message="Tem certeza de que deseja esvaziar o carrinho?"
        confirmText="Sim, esvaziar"
        cancelText="Não"
        type="danger"
        onConfirm={() => {
          setCart([]);
          setClearCartModalVisible(false);
        }}
        onCancel={() => setClearCartModalVisible(false)}
      />

      {/* Modal de Gestão de Turnos de Caixa */}
      <CashRegisterModal
        visible={cashModalVisible}
        gerenteId={user?.gerente_id}
        usuarioId={user?.id}
        usuarioNome={user?.nome}
        onClose={() => setCashModalVisible(false)}
        onShiftChange={(novoTurno) => setTurnoCaixa(novoTurno)}
      />

      {/* Modal de Gestão de Clientes & Contas */}
      <ClientsModal
        visible={clientsModalVisible}
        gerenteId={user?.gerente_id}
        onClose={() => setClientsModalVisible(false)}
      />

      {/* Modal de Checkout & Pagamentos */}
      <CheckoutPaymentModal
        visible={checkoutModalVisible}
        totalVenda={subtotal}
        gerenteId={user?.gerente_id}
        loading={checkoutLoading}
        onConfirmSale={confirmCheckout}
        onClose={() => setCheckoutModalVisible(false)}
      />

      {/* Modal de Sucesso pós-venda */}
      <ConfirmationModal
        visible={successModalVisible}
        title={`Venda Finalizada! #${vendaSucessoInfo?.vendaId || ''}`}
        message={
          `Faturamento Total: ${formatCurrency(vendaSucessoInfo?.valorTotal || subtotal)}\n` +
          `Taxas Operacionais: -${formatCurrency(vendaSucessoInfo?.taxas || 0)}\n` +
          `Valor Líquido Recebido: ${formatCurrency(vendaSucessoInfo?.valorLiquido || subtotal)}\n` +
          `CMV dos Produtos: ${formatCurrency(vendaSucessoInfo?.cmv || 0)}\n\n` +
          `Pagamentos Registrados:\n` +
          (vendaSucessoInfo?.pagamentos?.map(p => `• ${p.forma_pagamento.toUpperCase()}: ${formatCurrency(p.valor_bruto)} (Líq: ${formatCurrency(p.valor_liquido)})`).join('\n') || '')
        }
        confirmText="OK"
        cancelText={null}
        type="info"
        onConfirm={() => {
          setCart([]);
          setVendaSucessoInfo(null);
          setSuccessModalVisible(false);
        }}
      />

      {/* Alerta Genérico */}
      <ConfirmationModal
        visible={alertVisible}
        title={alertConfig.title}
        message={alertConfig.message}
        confirmText="OK"
        cancelText={null}
        type={alertConfig.type}
        onConfirm={() => setAlertVisible(false)}
      />
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
    paddingVertical: 10,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFF',
  },
  caixaStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    marginTop: 2,
    alignSelf: 'flex-start'
  },
  caixaAbertoPill: {
    backgroundColor: '#2E7D32'
  },
  caixaBloqueadoPill: {
    backgroundColor: '#D97706'
  },
  caixaFechadoPill: {
    backgroundColor: '#C53030'
  },
  clientesPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    marginTop: 2,
    backgroundColor: '#4338CA',
    alignSelf: 'flex-start'
  },
  caixaStatusPillText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: 'bold'
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  ticketNumber: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 14,
    fontWeight: 'bold',
  },
  cancelBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 8,
  },
  cancelBtnText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
  },
  mainContainer: {
    flex: 1,
    backgroundColor: '#F7FAFC',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 16,
  },
  addProductCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    position: 'relative',
    zIndex: 10,
  },
  addProductLabel: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#4A5568',
    marginBottom: 8,
  },
  searchInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#CBD5E0',
    borderRadius: 8,
    paddingHorizontal: 10,
    height: 44,
    backgroundColor: '#FFF',
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#2D3748',
  },
  scanIconBtn: {
    backgroundColor: '#1E63EC',
    borderRadius: 6,
    padding: 6,
    marginLeft: 6,
  },
  searchResultsDropdown: {
    position: 'absolute',
    top: 76,
    left: 12,
    right: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E0',
    borderRadius: 8,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 6,
    elevation: 8,
    zIndex: 20,
    overflow: 'hidden',
  },
  searchResultItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2F7',
  },
  searchResultName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2D3748',
  },
  searchResultMeta: {
    fontSize: 11,
    color: '#718096',
    marginTop: 2,
  },
  searchResultPrice: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#1E63EC',
  },
  searchResultStock: {
    fontSize: 10,
    fontWeight: 'bold',
    marginTop: 2,
  },
  searchEmptyRow: {
    padding: 16,
    alignItems: 'center',
  },
  searchEmptyText: {
    color: '#718096',
    fontSize: 13,
  },
  cartTitleRow: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 6,
  },
  cartTitleText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#2D3748',
  },
  cartAreaContainer: {
    flex: 1,
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: '#EDF2F7',
    borderRadius: 12,
    overflow: 'hidden',
  },
  emptyCartContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  bagsGraphic: {
    position: 'relative',
    width: 60,
    height: 60,
    marginBottom: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bagSquare: {
    width: 38,
    height: 44,
    borderRadius: 6,
    position: 'absolute',
    alignItems: 'center',
  },
  bagHandleArc: {
    width: 16,
    height: 12,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    borderBottomWidth: 0,
    marginTop: -6,
  },
  bagLines: {
    width: 20,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.4)',
    marginTop: 14,
  },
  emptyCartMainText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#4A5568',
    marginBottom: 4,
  },
  emptyCartSubText: {
    fontSize: 12,
    color: '#718096',
  },
  cartItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  cartItemLeft: {
    flex: 1,
  },
  cartItemName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2D3748',
  },
  cartItemBrand: {
    fontSize: 11,
    color: '#718096',
    marginTop: 2,
  },
  cartItemRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  qtyContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EDF2F7',
    borderRadius: 6,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  qtyBtn: {
    padding: 4,
  },
  qtyText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#2D3748',
    paddingHorizontal: 8,
  },
  cartItemSubtotal: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#1E63EC',
    minWidth: 64,
    textAlign: 'right',
  },
  footerPanel: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  summaryLabel: {
    fontSize: 12,
    color: '#718096',
  },
  summaryValue: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2D3748',
  },
  dashedDivider: {
    borderBottomWidth: 1,
    borderBottomColor: '#CBD5E0',
    borderStyle: 'dashed',
    marginVertical: 8,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  totalLabel: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#1A202C',
  },
  totalValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1E63EC',
  },
  checkoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 10,
  },
  checkoutBtnEnabled: {
    backgroundColor: '#1E63EC',
  },
  checkoutBtnDisabled: {
    backgroundColor: '#A0AEC0',
  },
  checkoutBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: 'bold',
  },
});
