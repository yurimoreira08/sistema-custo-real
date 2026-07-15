import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  TouchableOpacity,
  TextInput,
  Alert,
  Platform,
  ScrollView,
  Modal
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useApp } from '../context/AppContext';
import { registerSale } from '../database/db';
import { Ionicons } from '@expo/vector-icons';
import BarcodeScannerModal from '../components/BarcodeScannerModal';
import { feedbackFound, feedbackNotFound } from '../utils/scanFeedback';
import SyncBadge from '../components/SyncBadge';

export default function NewSaleScreen() {
  const { products, settings, sales, refreshData } = useApp();
  const [cart, setCart] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [scannerVisible, setScannerVisible] = useState(false);

  // Calcula número da próxima venda baseado no histórico (ex: #0024 se vendas = 23)
  const nextSaleNum = `#${String(sales.length + 1).padStart(4, '0')}`;

  // Filtrar produtos de acordo com a query de busca
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
    // RN02: Bloqueio de Estoque se estoque for zero
    if (product.estoque <= 0) {
      Alert.alert('Bloqueio de Estoque', 'Este produto está com estoque zerado.');
      return;
    }

    const cartIndex = cart.findIndex(item => item.id === product.id);
    
    if (cartIndex > -1) {
      const currentQty = cart[cartIndex].quantidade;
      // RN02: Bloqueio de Estoque se a quantidade solicitada exceder o estoque
      if (currentQty + 1 > product.estoque) {
        Alert.alert('Bloqueio de Estoque', `Não há estoque suficiente de "${product.nome}". Estoque disponível: ${product.estoque} un.`);
        return;
      }
      const updatedCart = [...cart];
      updatedCart[cartIndex].quantidade += 1;
      setCart(updatedCart);
    } else {
      setCart([...cart, { ...product, quantidade: 1 }]);
    }
    
    // Resetar busca
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
      // Remover do carrinho
      const updatedCart = cart.filter(item => item.id !== productId);
      setCart(updatedCart);
    } else {
      // RN02: Validar estoque antes de incrementar
      if (newQty > product.estoque) {
        Alert.alert('Bloqueio de Estoque', `Não é possível adicionar mais unidades. Estoque disponível: ${product.estoque} un.`);
        return;
      }
      const updatedCart = [...cart];
      updatedCart[cartIndex].quantidade = newQty;
      setCart(updatedCart);
    }
  };

  const handleClearCart = () => {
    if (cart.length === 0) return;
    Alert.alert(
      'Cancelar Venda',
      'Tem certeza de que deseja esvaziar o carrinho?',
      [
        { text: 'Não', style: 'cancel' },
        { text: 'Sim', style: 'destructive', onPress: () => setCart([]) }
      ]
    );
  };

  // Cálculos do Carrinho
  const subtotal = cart.reduce((sum, item) => sum + (item.preco_venda * item.quantidade), 0);
  const totalItensCount = cart.reduce((sum, item) => sum + item.quantidade, 0);
  
  // Splits projetados baseados na configuração global (RN01)
  const cmvSplit = parseFloat((subtotal * (settings.percentual_cmv / 100)).toFixed(2));
  const opexSplit = parseFloat((subtotal * (settings.percentual_opex / 100)).toFixed(2));
  const lucroSplit = parseFloat((subtotal - cmvSplit - opexSplit).toFixed(2));

  const handleCheckout = async () => {
    if (cart.length === 0) return;

    try {
      // Executa venda com controle transacional e de split
      await registerSale(cart, settings);
      
      Alert.alert(
        'Venda Finalizada!',
        `Faturamento Total: ${formatCurrency(subtotal)}\n\n` +
        `Split de Faturamento:\n` +
        `• Reposição (CMV ${settings.percentual_cmv}%): ${formatCurrency(cmvSplit)}\n` +
        `• Operações (OpEx ${settings.percentual_opex}%): ${formatCurrency(opexSplit)}\n` +
        `• Lucro Líquido (${settings.percentual_lucro}%): ${formatCurrency(lucroSplit)}`,
        [{ text: 'OK', onPress: () => setCart([]) }]
      );

      await refreshData();
    } catch (error) {
      Alert.alert('Erro ao Finalizar Venda', error.message || 'Houve um erro no processamento.');
      console.error(error);
    }
  };

  // Busca um produto por código de barras exato (após trim), suportando EAN e PLUs curtos.
  const findByBarcode = (code) => {
    const cleanCode = code.trim();
    if (!cleanCode) return null;
    return products.find(p => p.codigo_barras && p.codigo_barras.trim() === cleanCode) || null;
  };

  const handleSearchTextChange = (text) => {
    setSearchQuery(text);

    // Auto-adição rápida para leitores físicos: se o texto digitado corresponder
    // exatamente a um código de barras cadastrado, adiciona ao carrinho na hora.
    const cleanCode = text.trim();
    if (cleanCode.length >= 3) {
      const exactMatch = findByBarcode(cleanCode);
      if (exactMatch) {
        feedbackFound();
        handleSelectItem(exactMatch);
        setSearchQuery(''); // Limpa o input para a próxima leitura imediata
        setShowSearchResults(false);
        return;
      }
    }

    setShowSearchResults(text.length > 0);
  };

  // Reforço para o Enter enviado pelo leitor físico ao final da leitura.
  const handleSubmitEditing = () => {
    const exactMatch = findByBarcode(searchQuery);
    if (exactMatch) {
      handleSelectItem(exactMatch);
      setSearchQuery('');
      setShowSearchResults(false);
    }
  };

  // Recebe o código lido pela câmera. Ao identificar um produto, fecha o scanner
  // para evitar leituras/adições duplicadas do mesmo código.
  const handleScanCode = (code) => {
    const product = findByBarcode(code);
    if (product) {
      feedbackFound();
      handleSelectItem(product);
      setScannerVisible(false);
    } else {
      feedbackNotFound();
      Alert.alert('Produto não encontrado', `Nenhum produto cadastrado com o código "${code.trim()}".`);
    }
  };

  const renderCartItem = ({ item }) => (
    <View style={styles.cartItemRow}>
      <View style={styles.cartItemLeft}>
        <Text style={styles.cartItemName}>{item.nome}</Text>
        <Text style={styles.cartItemBrand}>{item.marca || 'Sem marca'} • {formatCurrency(item.preco_venda)}/un</Text>
      </View>
      <View style={styles.cartItemRight}>
        {/* Controles de Quantidade */}
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

      {/* Header Bar */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="cart" size={24} color="#FFF" style={{ marginRight: 8 }} />
          <Text style={styles.headerTitle}>Nova Venda</Text>
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
            {/* Botão de leitura por câmera */}
            <TouchableOpacity style={styles.scanIconBtn} onPress={() => setScannerVisible(true)}>
              <Ionicons name="barcode-outline" size={20} color="#FFF" />
            </TouchableOpacity>
          </View>

          {/* Resultados da busca (Overlay suspenso dentro do card) */}
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

        {/* Lista do Carrinho (Fundo cinza claro) */}
        <View style={styles.cartAreaContainer}>
          {cart.length === 0 ? (
            <View style={styles.emptyCartContainer}>
              {/* Ilustração customizada das sacolinhas coloridas idêntica à imagem */}
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

      {/* Modal de leitura por câmera */}
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
    paddingVertical: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFF',
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
    fontWeight: 'bold',
  },
  mainContainer: {
    flex: 1,
    backgroundColor: '#F0F4F8',
    padding: 16,
  },
  addProductCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
    zIndex: 100, // Garante que a busca suspensa apareça acima do carrinho
    position: 'relative',
  },
  addProductLabel: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#718096',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  searchInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1', // Borda azulada sutil
    paddingHorizontal: 12,
    height: 48,
  },
  searchInput: {
    flex: 1,
    color: '#2D3748',
    fontSize: 15,
  },
  scanIconBtn: {
    backgroundColor: '#1E63EC',
    width: 36,
    height: 36,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  searchResultsDropdown: {
    position: 'absolute',
    top: 86,
    left: 16,
    right: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
    zIndex: 200,
  },
  searchEmptyRow: {
    padding: 16,
    alignItems: 'center',
  },
  searchEmptyText: {
    color: '#A0AEC0',
    fontSize: 14,
  },
  searchResultItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: '#EDF2F7',
  },
  searchResultName: {
    fontSize: 14,
    fontWeight: 'bold',
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
    color: '#2D3748',
  },
  searchResultStock: {
    fontSize: 11,
    fontWeight: 'bold',
    marginTop: 2,
  },
  cartTitleRow: {
    marginVertical: 12,
  },
  cartTitleText: {
    color: '#718096',
    fontSize: 13,
    fontWeight: '600',
  },
  cartAreaContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF', // Área do carrinho em branco
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
  },
  emptyCartContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  bagsGraphic: {
    flexDirection: 'row',
    width: 60,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    position: 'relative',
  },
  bagSquare: {
    width: 28,
    height: 32,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'absolute',
  },
  bagHandleArc: {
    width: 14,
    height: 12,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#FFF',
    backgroundColor: 'transparent',
    position: 'absolute',
    top: -8,
  },
  bagLines: {
    width: 18,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.4)',
    marginVertical: 2,
  },
  emptyCartMainText: {
    fontSize: 14,
    color: '#A0AEC0',
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyCartSubText: {
    fontSize: 14,
    color: '#A0AEC0',
    textAlign: 'center',
    lineHeight: 20,
  },
  cartItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F4F8',
  },
  cartItemLeft: {
    flex: 1,
    marginRight: 8,
  },
  cartItemName: {
    fontSize: 14,
    fontWeight: 'bold',
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
    gap: 16,
  },
  qtyContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EDF2F7',
    borderRadius: 6,
    padding: 3,
  },
  qtyBtn: {
    width: 24,
    height: 24,
    borderRadius: 4,
    backgroundColor: '#FFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 1,
    elevation: 1,
  },
  qtyText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#2D3748',
    marginHorizontal: 8,
  },
  cartItemSubtotal: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#2D3748',
    minWidth: 70,
    textAlign: 'right',
  },
  footerPanel: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: Platform.OS === 'ios' ? 24 : 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 5,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 4,
  },
  summaryLabel: {
    fontSize: 14,
    color: '#718096',
  },
  summaryValue: {
    fontSize: 14,
    color: '#2D3748',
    fontWeight: '500',
  },
  dashedDivider: {
    borderStyle: 'dashed',
    borderWidth: 0.5,
    borderColor: '#CBD5E1',
    marginVertical: 12,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2D3748',
  },
  totalValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1E63EC', // Azul royal forte
  },
  checkoutBtn: {
    flexDirection: 'row',
    height: 52,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  checkoutBtnEnabled: {
    backgroundColor: '#48BB78', // Verde idêntico à imagem
  },
  checkoutBtnDisabled: {
    backgroundColor: '#CBD5E1', // Fundo cinza claro
  },
  checkoutBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
