import React, { useState } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  FlatList, 
  TextInput, 
  TouchableOpacity, 
  Modal, 
  ScrollView, 
  Alert,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
  ActivityIndicator,
  Image
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useApp } from '../context/AppContext';
import { saveProduct, deleteProduct } from '../database/db';
import { Ionicons } from '@expo/vector-icons';
import BarcodeScannerModal from '../components/BarcodeScannerModal';
import { suggestPrice } from '../utils/pricing';
import { feedbackFound, feedbackNotFound } from '../utils/scanFeedback';
import SyncBadge from '../components/SyncBadge';
import ConfirmationModal from '../components/ConfirmationModal';
import StockReceivingModal from '../components/StockReceivingModal';
import StockLossModal from '../components/StockLossModal';
import KardexModal from '../components/KardexModal';
import SuppliersModal from '../components/SuppliersModal';

const CATEGORIAS = ['Laticínios', 'Mercearia', 'Bebidas', 'Higiene', 'Limpeza', 'Outros'];
export default function ProductsScreen() {
  const { products, logout, refreshData, settings, user } = useApp();
  
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Todas as categorias');
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);

  const [modalVisible, setModalVisible] = useState(false);
  const [showFormCategoryDropdown, setShowFormCategoryDropdown] = useState(false);
  const [scannerVisible, setScannerVisible] = useState(false);

  // Modais de Gestão de Estoque e Fornecedores
  const [receivingModalVisible, setReceivingModalVisible] = useState(false);
  const [lossModalVisible, setLossModalVisible] = useState(false);
  const [kardexModalVisible, setKardexModalVisible] = useState(false);
  const [suppliersModalVisible, setSuppliersModalVisible] = useState(false);
  const [selectedKardexProduct, setSelectedKardexProduct] = useState(null);
  
  const [productId, setProductId] = useState(null);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [productToDelete, setProductToDelete] = useState(null);

  const [alertVisible, setAlertVisible] = useState(false);
  const [alertConfig, setAlertConfig] = useState({ title: '', message: '', type: 'info' });
  const showCustomAlert = (title, message, type = 'info') => {
    setAlertConfig({ title, message, type });
    setAlertVisible(true);
  };
  const [codigo, setCodigo] = useState('');
  const [categoria, setCategoria] = useState('');
  const [nome, setNome] = useState('');
  const [marca, setMarca] = useState('');
  const [precoCusto, setPrecoCusto] = useState('');
  const [precoVenda, setPrecoVenda] = useState('');
  const [estoque, setEstoque] = useState('');
  const [estoqueMinimo, setEstoqueMinimo] = useState('');
  const [isFetchingApi, setIsFetchingApi] = useState(false);

  const totalProdutos = products.length;
  const estoqueBaixo = products.filter(p => p.estoque <= p.estoque_minimo).length;
  const estoqueNormal = totalProdutos - estoqueBaixo;

  const priceSuggestion = suggestPrice((precoCusto || '').replace(',', '.'), settings);
  const precoVendaNum = parseFloat((precoVenda || '').replace(',', '.'));
  const belowTarget =
    priceSuggestion.valido &&
    Number.isFinite(precoVendaNum) &&
    precoVendaNum > 0 &&
    precoVendaNum < priceSuggestion.sugerido - 0.005;

  const filteredProducts = products.filter(p => {
    const matchesSearch = p.nome.toLowerCase().includes(search.toLowerCase()) || 
                          (p.marca && p.marca.toLowerCase().includes(search.toLowerCase())) ||
                          (p.codigo_barras && p.codigo_barras.includes(search));
    const matchesCategory = selectedCategory === 'Todas as categorias' || p.categoria === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const formatCurrency = (val) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(val || 0);
  };

  const openAddModal = () => {
    setProductId(null);
    setCodigo('');
    setCategoria('Selecione...');
    setNome('');
    setMarca('');
    setPrecoCusto('');
    setPrecoVenda('');
    setEstoque('');
    setEstoqueMinimo('');
    setModalVisible(true);
  };

  const openEditModal = (product) => {
    setProductId(product.id);
    setCodigo(product.codigo_barras || '');
    setCategoria(product.categoria || 'Outros');
    setNome(product.nome);
    setMarca(product.marca || '');
    setPrecoCusto(product.preco_custo.toString());
    setPrecoVenda(product.preco_venda.toString());
    setEstoque(product.estoque.toString());
    setEstoqueMinimo(product.estoque_minimo.toString());
    setModalVisible(true);
  };

  const handleSave = async () => {
    if (!nome.trim() || categoria === 'Selecione...' || !precoCusto.trim() || !precoVenda.trim() || !estoque.trim()) {
      showCustomAlert('Erro', 'Por favor, preencha os campos obrigatórios (*): Categoria, Nome, Preço de Custo, Preço de Venda e Estoque.', 'danger');
      return;
    }

    const custo = parseFloat(precoCusto.replace(',', '.'));
    const venda = parseFloat(precoVenda.replace(',', '.'));
    const qtyEstoque = parseInt(estoque, 10);
    const qtyMin = estoqueMinimo ? parseInt(estoqueMinimo, 10) : 0;

    if (isNaN(custo) || custo <= 0) {
      showCustomAlert('Erro', 'Preço de Custo deve ser um número maior que zero.', 'danger');
      return;
    }
    if (isNaN(venda) || venda <= 0) {
      showCustomAlert('Erro', 'Preço de Venda deve ser um número maior que zero.', 'danger');
      return;
    }
    if (isNaN(qtyEstoque) || qtyEstoque < 0) {
      showCustomAlert('Erro', 'Estoque deve ser um número inteiro igual ou maior que zero.', 'danger');
      return;
    }
    if (isNaN(qtyMin) || qtyMin < 0) {
      showCustomAlert('Erro', 'Estoque Mínimo deve ser um número inteiro igual ou maior que zero.', 'danger');
      return;
    }

    try {
      await saveProduct({
        id: productId,
        nome: nome.trim(),
        marca: marca.trim() || null,
        codigo_barras: codigo.trim() || null,
        categoria: categoria,
        preco_custo: custo,
        preco_venda: venda,
        estoque: qtyEstoque,
        estoque_minimo: qtyMin
      }, user.gerente_id);

      showCustomAlert('Sucesso', productId ? 'Produto atualizado com sucesso!' : 'Produto cadastrado com sucesso!', 'success');
      setModalVisible(false);
      await refreshData();
    } catch (error) {
      showCustomAlert('Erro', 'Não foi possível salvar o produto.', 'danger');
      console.error(error);
    }
  };

  const handleDelete = (id, nome) => {
    setProductToDelete({ id, nome });
    setDeleteModalVisible(true);
  };

  const selectCategoryFilter = (cat) => {
    setSelectedCategory(cat);
    setShowCategoryDropdown(false);
  };

  const selectFormCategory = (cat) => {
    setCategoria(cat);
    setShowFormCategoryDropdown(false);
  };

  const generateAutoCode = () => {
    const shortNumericCodes = products
      .map(p => (p.codigo_barras || '').trim())
      .filter(c => /^\d{1,4}$/.test(c))
      .map(c => parseInt(c, 10));

    const maxCode = shortNumericCodes.length > 0 ? Math.max(...shortNumericCodes) : 100;
    const nextCode = Math.max(maxCode + 1, 101);
    setCodigo(String(nextCode));
  };

  const encodeBase64 = (str) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let encoded = '';
    let i = 0;
    while (i < str.length) {
      const c1 = str.charCodeAt(i++);
      const c2 = i < str.length ? str.charCodeAt(i++) : NaN;
      const c3 = i < str.length ? str.charCodeAt(i++) : NaN;
      
      const byte1 = c1 >> 2;
      const byte2 = ((c1 & 3) << 4) | (isNaN(c2) ? 0 : c2 >> 4);
      const byte3 = isNaN(c2) ? 64 : ((c2 & 15) << 2) | (isNaN(c3) ? 0 : c3 >> 6);
      const byte4 = isNaN(c3) ? 64 : c3 & 63;
      
      encoded += chars.charAt(byte1) + chars.charAt(byte2) + 
                 (byte3 === 64 ? '=' : chars.charAt(byte3)) + 
                 (byte4 === 64 ? '=' : chars.charAt(byte4));
    }
    return encoded;
  };

  const fetchProductFromApi = async (barcode) => {
    if (!barcode || barcode.trim().length < 8) {
      showCustomAlert('Código inválido', 'O código de barras para busca automática deve ter pelo menos 8 dígitos.', 'danger');
      return;
    }

    setIsFetchingApi(true);
    let productFound = false;

    try {
      console.log('Tentando buscar dados no Open Food Facts...');
      const response = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode.trim()}.json`);
      
      const data = await response.json();
      if (data && data.status === 1 && data.product) {
        const prod = data.product;
        const fetchedNome = prod.product_name || prod.product_name_pt || prod.product_name_en || '';
        const fetchedMarca = prod.brands || '';
        
        let fetchedCategoria = 'Outros';
        const categoriesStr = ((prod.categories || '') + ' ' + (prod.categories_tags || []).join(' ')).toLowerCase();
        
        const isDairy = categoriesStr.includes('laticínios') || categoriesStr.includes('dairy') || categoriesStr.includes('leite') || categoriesStr.includes('queijo') || categoriesStr.includes('yogurt') || categoriesStr.includes('iogurte') || categoriesStr.includes('manteiga');
        const isBeverage = categoriesStr.includes('bebidas') || categoriesStr.includes('beverages') || categoriesStr.includes('suco') || categoriesStr.includes('refrigerante') || categoriesStr.includes('cerva') || categoriesStr.includes('cerveja') || categoriesStr.includes('vinho') || categoriesStr.includes('água') || categoriesStr.includes('agua') || categoriesStr.includes('natar') || categoriesStr.includes('nectar');
        const isHygiene = categoriesStr.includes('higiene') || categoriesStr.includes('hygiene') || categoriesStr.includes('sabonete') || categoriesStr.includes('shampoo') || categoriesStr.includes('dental') || categoriesStr.includes('creme dental') || categoriesStr.includes('desodorante') || categoriesStr.includes('fio dental');
        const isCleaning = categoriesStr.includes('limpeza') || categoriesStr.includes('cleaning') || categoriesStr.includes('detergente') || categoriesStr.includes('amaciante') || categoriesStr.includes('sabão em pó') || categoriesStr.includes('sabao em po') || categoriesStr.includes('desinfetante') || categoriesStr.includes('saponáceo') || categoriesStr.includes('lustra móveis');
        
        if (isDairy) {
          fetchedCategoria = 'Laticínios';
        } else if (isBeverage) {
          fetchedCategoria = 'Bebidas';
        } else if (isHygiene) {
          fetchedCategoria = 'Higiene';
        } else if (isCleaning) {
          fetchedCategoria = 'Limpeza';
        } else {
          fetchedCategoria = 'Mercearia';
        }
        
        if (fetchedNome) setNome(fetchedNome);
        if (fetchedMarca) setMarca(fetchedMarca);
        setCategoria(fetchedCategoria);
        productFound = true;
        
        const alertMsg = `Produto encontrado!\n\nNome: ${fetchedNome}\nMarca: ${fetchedMarca || 'Não informada'}\nCategoria sugerida: ${fetchedCategoria}`;
        showCustomAlert('Sucesso', alertMsg, 'success');
      } else {
        showCustomAlert('Não encontrado', 'Produto não encontrado na base de dados pública. Digite os dados manualmente.', 'danger');
      }
    } catch (error) {
      console.error('Erro ao buscar produto na API pública:', error);
      showCustomAlert('Erro de Conexão', 'Não foi possível conectar à base pública para obter os dados.', 'danger');
    }

    if (productFound) {
      feedbackFound();
    } else {
      feedbackNotFound();
    }

    setIsFetchingApi(false);
  };

  const handleScanFormCode = (code) => {
    const trimmedCode = code.trim();
    setCodigo(trimmedCode);
    setScannerVisible(false);
    
    if (trimmedCode.length >= 8) {
      fetchProductFromApi(trimmedCode);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <StatusBar style="light" />
      
      {/* Header Compacto e Responsivo */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Image source={require('../../assets/logo_lucrocerto.png')} style={styles.headerLogo} />
          <View style={styles.headerTitleCol}>
            <Text style={styles.headerTitle} numberOfLines={1}>LucroCerto</Text>
            <Text style={styles.headerSubtitle} numberOfLines={1}>Estoque & Catálogo</Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          <SyncBadge />
          <TouchableOpacity style={styles.logoutBtn} onPress={logout} accessibilityLabel="Sair da Conta">
            <Ionicons name="log-out-outline" size={15} color="#FFFFFF" style={{ marginRight: 3 }} />
            <Text style={styles.logoutText}>Sair</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
        {/* Cabeçalho da Seção com Botão Novo */}
        <View style={styles.titleRow}>
          <View style={styles.titleCol}>
            <Text style={styles.mainTitle}>Produtos</Text>
            <Text style={styles.subtitle}>Gerencie o catálogo e estoque de mercadorias</Text>
          </View>
          <TouchableOpacity style={styles.topAddBtn} onPress={openAddModal} activeOpacity={0.8}>
            <Ionicons name="add" size={18} color="#FFF" style={{ marginRight: 4 }} />
            <Text style={styles.topAddBtnText}>Novo</Text>
          </TouchableOpacity>
        </View>

        {/* Grid 2x2 de Ações Rápidas de Estoque */}
        <View style={styles.quickActionsGrid}>
          <TouchableOpacity 
            style={styles.quickActionCard}
            onPress={() => setReceivingModalVisible(true)}
            activeOpacity={0.7}
          >
            <View style={[styles.quickActionIconBg, { backgroundColor: '#DEF7EC' }]}>
              <Ionicons name="archive-outline" size={18} color="#03543F" />
            </View>
            <View style={styles.quickActionTextContainer}>
              <Text style={styles.quickActionTitle}>Entrada (PMP)</Text>
              <Text style={styles.quickActionDesc}>Compras e custos</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.quickActionCard}
            onPress={() => setLossModalVisible(true)}
            activeOpacity={0.7}
          >
            <View style={[styles.quickActionIconBg, { backgroundColor: '#FDE8E8' }]}>
              <Ionicons name="alert-circle-outline" size={18} color="#9B1C1C" />
            </View>
            <View style={styles.quickActionTextContainer}>
              <Text style={styles.quickActionTitle}>Baixa Perda</Text>
              <Text style={styles.quickActionDesc}>Avarias e perdas</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.quickActionCard}
            onPress={() => {
              setSelectedKardexProduct(null);
              setKardexModalVisible(true);
            }}
            activeOpacity={0.7}
          >
            <View style={[styles.quickActionIconBg, { backgroundColor: '#EBF8FF' }]}>
              <Ionicons name="list-outline" size={18} color="#2B6CB0" />
            </View>
            <View style={styles.quickActionTextContainer}>
              <Text style={styles.quickActionTitle}>Kardex Geral</Text>
              <Text style={styles.quickActionDesc}>Movimentações</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.quickActionCard}
            onPress={() => setSuppliersModalVisible(true)}
            activeOpacity={0.7}
          >
            <View style={[styles.quickActionIconBg, { backgroundColor: '#FEF3C7' }]}>
              <Ionicons name="business-outline" size={18} color="#92400E" />
            </View>
            <View style={styles.quickActionTextContainer}>
              <Text style={styles.quickActionTitle}>Fornecedores</Text>
              <Text style={styles.quickActionDesc}>Parceiros comerciais</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Resumo de Indicadores de Estoque com Ícones Vetoriais */}
        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <View style={[styles.summaryIconBadge, { backgroundColor: '#EFF6FF' }]}>
              <Ionicons name="cube-outline" size={18} color="#1E63EC" />
            </View>
            <Text style={styles.summaryNumber}>{totalProdutos}</Text>
            <Text style={styles.summaryLabel}>Total de Itens</Text>
          </View>
          <View style={styles.summaryCard}>
            <View style={[styles.summaryIconBadge, { backgroundColor: '#F0FDF4' }]}>
              <Ionicons name="checkmark-circle-outline" size={18} color="#16A34A" />
            </View>
            <Text style={styles.summaryNumber}>{estoqueNormal}</Text>
            <Text style={styles.summaryLabel}>Estoque Normal</Text>
          </View>
          <View style={styles.summaryCard}>
            <View style={[styles.summaryIconBadge, { backgroundColor: estoqueBaixo > 0 ? '#FEF2F2' : '#F8FAFC' }]}>
              <Ionicons 
                name="alert-circle-outline" 
                size={18} 
                color={estoqueBaixo > 0 ? '#DC2626' : '#94A3B8'} 
              />
            </View>
            <Text style={[styles.summaryNumber, estoqueBaixo > 0 && { color: '#DC2626' }]}>
              {estoqueBaixo}
            </Text>
            <Text style={styles.summaryLabel}>Estoque Baixo</Text>
          </View>
        </View>

        {/* Barra de Pesquisa com Botão de Limpar */}
        <View style={styles.searchWrapper}>
          <Ionicons name="search" size={18} color="#94A3B8" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Buscar por produto, marca ou código..."
            placeholderTextColor="#94A3B8"
            value={search}
            onChangeText={setSearch}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={18} color="#94A3B8" />
            </TouchableOpacity>
          )}
        </View>

        {/* Chips de Categoria com Rolagem Horizontal Suave */}
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoryChipsContainer}
        >
          <TouchableOpacity
            style={[
              styles.categoryChip,
              selectedCategory === 'Todas as categorias' && styles.categoryChipActive
            ]}
            onPress={() => selectCategoryFilter('Todas as categorias')}
            activeOpacity={0.7}
          >
            <Text style={[
              styles.categoryChipText,
              selectedCategory === 'Todas as categorias' && styles.categoryChipTextActive
            ]}>
              Todas
            </Text>
          </TouchableOpacity>
          {CATEGORIAS.map((cat, idx) => {
            const isActive = selectedCategory === cat;
            return (
              <TouchableOpacity
                key={idx.toString()}
                style={[styles.categoryChip, isActive && styles.categoryChipActive]}
                onPress={() => selectCategoryFilter(cat)}
                activeOpacity={0.7}
              >
                <Text style={[styles.categoryChipText, isActive && styles.categoryChipTextActive]}>
                  {cat}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Barra Informativa de Itens Filtrados */}
        <View style={styles.filterMetaRow}>
          <Text style={styles.filterMetaText}>
            Mostrando <Text style={{ fontWeight: 'bold', color: '#1E293B' }}>{filteredProducts.length}</Text> de {totalProdutos} produtos
          </Text>
          {(search.length > 0 || selectedCategory !== 'Todas as categorias') && (
            <TouchableOpacity 
              onPress={() => {
                setSearch('');
                setSelectedCategory('Todas as categorias');
              }}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Text style={styles.clearFiltersText}>Limpar filtros</Text>
            </TouchableOpacity>
          )}
        </View>

        {filteredProducts.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="cube-outline" size={48} color="#CBD5E1" style={{ marginBottom: 8 }} />
            <Text style={styles.emptyText}>Nenhum produto encontrado.</Text>
            <Text style={styles.emptySubtext}>Verifique os termos da busca ou filtre por outra categoria.</Text>
          </View>
        ) : (
          <View style={styles.listContainer}>
            {filteredProducts.map((item) => {
              const isLowStock = item.estoque <= item.estoque_minimo;
              const precoVendaNum = Number(item.preco_venda || 0);
              const precoCustoNum = Number(item.preco_custo || 0);
              const margemPct = precoVendaNum > 0
                ? (((precoVendaNum - precoCustoNum) / precoVendaNum) * 100).toFixed(0)
                : 0;

              return (
                <View key={item.id.toString()} style={styles.productCard}>
                  {/* Cabeçalho do Card */}
                  <View style={styles.cardHeaderRow}>
                    <Text style={styles.productName} numberOfLines={2}>{item.nome}</Text>
                    <View style={styles.codeTag}>
                      <Text style={styles.codeTagText}>#{item.codigo_barras || 'S/CÓD'}</Text>
                    </View>
                  </View>

                  {/* Metadados: Categoria, Marca e Status de Estoque */}
                  <View style={styles.cardMetaRow}>
                    <View style={styles.cardTagsLeft}>
                      <View style={styles.categoryBadge}>
                        <Text style={styles.categoryBadgeText}>{item.categoria || 'Outros'}</Text>
                      </View>
                      {Boolean(item.marca) && (
                        <View style={styles.brandBadge}>
                          <Text style={styles.brandBadgeText}>🏷️ {item.marca}</Text>
                        </View>
                      )}
                    </View>

                    <View style={[
                      styles.stockStatusBadge,
                      isLowStock ? styles.stockStatusBadgeLow : styles.stockStatusBadgeNormal
                    ]}>
                      <Ionicons 
                        name={isLowStock ? 'alert-circle' : 'checkmark-circle'} 
                        size={13} 
                        color={isLowStock ? '#DC2626' : '#16A34A'} 
                        style={{ marginRight: 3 }}
                      />
                      <Text style={[
                        styles.stockStatusText,
                        isLowStock ? styles.stockStatusTextLow : styles.stockStatusTextNormal
                      ]}>
                        {isLowStock ? 'Estoque Baixo' : 'Normal'}
                      </Text>
                    </View>
                  </View>

                  {/* Grade de Indicadores Financeiros e Estoque */}
                  <View style={styles.valuesGrid}>
                    <View style={styles.gridCol}>
                      <Text style={styles.gridLabel}>CUSTO</Text>
                      <Text style={styles.gridValue}>{formatCurrency(item.preco_custo)}</Text>
                    </View>
                    <View style={styles.gridCol}>
                      <Text style={styles.gridLabel}>VENDA</Text>
                      <Text style={styles.gridValue}>{formatCurrency(item.preco_venda)}</Text>
                    </View>
                    <View style={styles.gridCol}>
                      <Text style={styles.gridLabel}>MARGEM</Text>
                      <Text style={[
                        styles.gridValue, 
                        margemPct >= 20 ? styles.marginHealthyText : styles.marginTightText
                      ]}>
                        {margemPct}%
                      </Text>
                    </View>
                    <View style={styles.gridCol}>
                      <Text style={styles.gridLabel}>ESTOQUE</Text>
                      <Text style={[
                        styles.gridValue, 
                        isLowStock ? styles.stockLowText : styles.stockNormalText
                      ]}>
                        {item.estoque} un
                      </Text>
                    </View>
                  </View>

                  {/* Ações do Card */}
                  <View style={styles.btnActionsRow}>
                    <TouchableOpacity 
                      style={styles.kardexCardBtn} 
                      onPress={() => {
                        setSelectedKardexProduct(item);
                        setKardexModalVisible(true);
                      }}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="time-outline" size={15} color="#475569" style={{ marginRight: 4 }} />
                      <Text style={styles.kardexCardBtnText}>Kardex</Text>
                    </TouchableOpacity>

                    <TouchableOpacity 
                      style={styles.editCardBtn} 
                      onPress={() => openEditModal(item)} 
                      activeOpacity={0.7}
                    >
                      <Ionicons name="pencil" size={14} color="#1D4ED8" style={{ marginRight: 4 }} />
                      <Text style={styles.editCardBtnText}>Editar</Text>
                    </TouchableOpacity>

                    <TouchableOpacity 
                      style={styles.deleteCardBtn} 
                      onPress={() => handleDelete(item.id, item.nome)}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="trash-outline" size={15} color="#DC2626" style={{ marginRight: 4 }} />
                      <Text style={styles.deleteCardBtnText}>Excluir</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      <TouchableOpacity style={styles.fabBtn} onPress={openAddModal}>
        <Ionicons name="add" size={32} color="#FFF" />
      </TouchableOpacity>

      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {productId ? '✏️ Editar Produto' : '＋ Novo Produto'}
              </Text>
              <TouchableOpacity onPress={() => setModalVisible(false)} style={styles.closeModalBtn}>
                <Ionicons name="close" size={20} color="#FFF" />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.modalForm}>
              <View style={styles.formRow}>
                <View style={[styles.formCol, { marginRight: 10 }]}>
                  <View style={styles.formLabelRow}>
                    <Text style={styles.formLabel}>Código</Text>
                    <TouchableOpacity onPress={generateAutoCode} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Text style={styles.generateCodeText}>Gerar</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.codeInputRow}>
                    <TextInput
                      style={[styles.formInput, { flex: 1 }]}
                      placeholder="Ex: 001"
                      placeholderTextColor="#A0AEC0"
                      value={codigo}
                      onChangeText={setCodigo}
                      keyboardType="numeric"
                    />
                    {codigo.trim().length >= 8 && (
                      <TouchableOpacity 
                        style={[styles.codeSearchBtn, isFetchingApi && { backgroundColor: '#A0AEC0' }]} 
                        onPress={() => fetchProductFromApi(codigo)}
                        disabled={isFetchingApi}
                      >
                        {isFetchingApi ? (
                          <ActivityIndicator size="small" color="#FFF" />
                        ) : (
                          <Ionicons name="search" size={20} color="#FFF" />
                        )}
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity style={styles.codeScanBtn} onPress={() => setScannerVisible(true)}>
                      <Ionicons name="barcode-outline" size={22} color="#FFF" />
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.formCol}>
                  <Text style={styles.formLabel}>Categoria *</Text>
                  <TouchableOpacity 
                    style={styles.formDropdownSelector} 
                    onPress={() => setShowFormCategoryDropdown(!showFormCategoryDropdown)}
                  >
                    <Text style={[
                      styles.formDropdownSelectorText,
                      categoria === 'Selecione...' && { color: '#A0AEC0' }
                    ]}>
                      {categoria}
                    </Text>
                    <Ionicons name="chevron-down" size={16} color="#4A5568" />
                  </TouchableOpacity>

                  {showFormCategoryDropdown && (
                    <View style={styles.formDropdownOptions}>
                      {CATEGORIAS.map((cat, idx) => (
                        <TouchableOpacity 
                          key={idx.toString()} 
                          style={styles.formDropdownOptionItem} 
                          onPress={() => selectFormCategory(cat)}
                        >
                          <Text style={styles.dropdownOptionText}>{cat}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Nome do Produto *</Text>
                <TextInput
                  style={styles.formInput}
                  placeholder="Ex: Leite Integral 1L"
                  placeholderTextColor="#A0AEC0"
                  value={nome}
                  onChangeText={setNome}
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Marca</Text>
                <TextInput
                  style={styles.formInput}
                  placeholder="Ex: Italac, Nestlé..."
                  placeholderTextColor="#A0AEC0"
                  value={marca}
                  onChangeText={setMarca}
                />
              </View>

              <View style={styles.formRow}>
                <View style={[styles.formCol, { marginRight: 10 }]}>
                  <Text style={styles.formLabel}>Preço de Custo (R$) *</Text>
                  <TextInput
                    style={styles.formInput}
                    placeholder="0.00"
                    placeholderTextColor="#A0AEC0"
                    value={precoCusto}
                    onChangeText={setPrecoCusto}
                    keyboardType="numeric"
                  />
                </View>
                <View style={styles.formCol}>
                  <Text style={styles.formLabel}>Preço de Venda (R$) *</Text>
                  <TextInput
                    style={styles.formInput}
                    placeholder="0.00"
                    placeholderTextColor="#A0AEC0"
                    value={precoVenda}
                    onChangeText={setPrecoVenda}
                    keyboardType="numeric"
                  />
                </View>
              </View>

              {priceSuggestion.valido && (
                <TouchableOpacity
                  style={styles.priceSuggestionChip}
                  onPress={() => setPrecoVenda(priceSuggestion.sugerido.toFixed(2))}
                  activeOpacity={0.7}
                >
                  <Text style={styles.priceSuggestionMain}>
                    💡 Sugerido: {formatCurrency(priceSuggestion.sugerido)} (tocar p/ usar)
                  </Text>
                  <Text style={styles.priceSuggestionBreakdown}>
                    CMV {formatCurrency(priceSuggestion.cmvValor)} · OpEx {formatCurrency(priceSuggestion.opexValor)} · Lucro {formatCurrency(priceSuggestion.lucroValor)}
                  </Text>
                </TouchableOpacity>
              )}
              {belowTarget && (
                <Text style={styles.priceWarning}>⚠️ Preço abaixo da margem alvo</Text>
              )}

              <View style={styles.formRow}>
                <View style={[styles.formCol, { marginRight: 10 }]}>
                  <Text style={styles.formLabel}>Qtd. em Estoque *</Text>
                  <TextInput
                    style={styles.formInput}
                    placeholder="0"
                    placeholderTextColor="#A0AEC0"
                    value={estoque}
                    onChangeText={setEstoque}
                    keyboardType="numeric"
                  />
                </View>
                <View style={styles.formCol}>
                  <Text style={styles.formLabel}>Estoque Mínimo</Text>
                  <TextInput
                    style={styles.formInput}
                    placeholder="0"
                    placeholderTextColor="#A0AEC0"
                    value={estoqueMinimo}
                    onChangeText={setEstoqueMinimo}
                    keyboardType="numeric"
                  />
                </View>
              </View>

              <View style={styles.modalActionsRow}>
                <TouchableOpacity 
                  style={styles.cancelModalBtn} 
                  onPress={() => setModalVisible(false)}
                >
                  <Text style={styles.cancelModalBtnText}>Cancelar</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.saveModalBtn} onPress={handleSave}>
                  <Text style={styles.saveModalBtnText}>💾 Salvar</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={scannerVisible}
        animationType="slide"
        onRequestClose={() => setScannerVisible(false)}
      >
        <BarcodeScannerModal
          onScan={handleScanFormCode}
          onClose={() => setScannerVisible(false)}
        />
      </Modal>

      <ConfirmationModal
        visible={deleteModalVisible}
        title="Confirmar Exclusão"
        message={productToDelete ? `Deseja realmente excluir o produto "${productToDelete.nome}"?` : ''}
        confirmText="Excluir"
        cancelText="Cancelar"
        type="danger"
        onConfirm={async () => {
          if (productToDelete) {
            try {
              await deleteProduct(productToDelete.id, user.gerente_id);
              setDeleteModalVisible(false);
              setProductToDelete(null);
              await refreshData();
            } catch (error) {
              setDeleteModalVisible(false);
              setProductToDelete(null);
              showCustomAlert('Erro', 'Não foi possível excluir o produto. Ele pode estar associado a vendas.', 'danger');
              console.error(error);
            }
          }
        }}
        onCancel={() => {
          setDeleteModalVisible(false);
          setProductToDelete(null);
        }}
      />

      <ConfirmationModal
        visible={alertVisible}
        title={alertConfig.title}
        message={alertConfig.message}
        confirmText="OK"
        cancelText={null}
        type={alertConfig.type}
        onConfirm={() => setAlertVisible(false)}
      />

      {/* Modal de Entrada de Mercadorias (PMP) */}
      <StockReceivingModal
        visible={receivingModalVisible}
        gerenteId={user?.gerente_id}
        usuarioId={user?.id}
        products={products}
        onSuccess={async (res) => {
          await refreshData();
          showCustomAlert(
            'Entrada Concluída',
            `NF ${res.numeroNota || 'S/N'} registrada com sucesso para ${res.fornecedorNome}!\nPreço Médio Ponderado (PMP) e estoques atualizados.`,
            'info'
          );
        }}
        onClose={() => setReceivingModalVisible(false)}
      />

      {/* Modal de Baixa de Perdas e Avarias */}
      <StockLossModal
        visible={lossModalVisible}
        gerenteId={user?.gerente_id}
        usuarioId={user?.id}
        products={products}
        onSuccess={async (res) => {
          await refreshData();
          showCustomAlert(
            'Baixa de Perda Registrada',
            `Baixa de ${res.quantidade} un do tipo ${res.tipoPerda.toUpperCase()} registrada!\nImpacto financeiro apurado: R$ ${res.impactoFinanceiro.toFixed(2)}.`,
            'danger'
          );
        }}
        onClose={() => setLossModalVisible(false)}
      />

      {/* Modal de Histórico Kardex */}
      <KardexModal
        visible={kardexModalVisible}
        gerenteId={user?.gerente_id}
        produto={selectedKardexProduct}
        onClose={() => {
          setKardexModalVisible(false);
          setSelectedKardexProduct(null);
        }}
      />

      {/* Modal de Gestão de Fornecedores */}
      <SuppliersModal
        visible={suppliersModalVisible}
        gerenteId={user?.gerente_id}
        onClose={() => setSuppliersModalVisible(false)}
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
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    marginRight: 8,
  },
  headerLogo: {
    width: 32,
    height: 32,
    borderRadius: 8,
    marginRight: 8,
    backgroundColor: '#FFFFFF',
    padding: 2,
    flexShrink: 0,
  },
  headerTitleCol: {
    justifyContent: 'center',
    flexShrink: 1,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFF',
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 10,
    color: '#DCE7FE',
    fontWeight: '500',
    marginTop: -2,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  logoutBtn: {
    backgroundColor: '#EF4444',
    height: 34,
    paddingHorizontal: 9,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  scrollContainer: {
    backgroundColor: '#F8FAFC',
    padding: 16,
    paddingBottom: 85,
    flexGrow: 1,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  titleCol: {
    flex: 1,
    marginRight: 10,
  },
  mainTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  topAddBtn: {
    backgroundColor: '#1E63EC',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    height: 36,
    borderRadius: 8,
    elevation: 2,
    shadowColor: '#1E63EC',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
  },
  topAddBtnText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '700',
  },
  quickActionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  quickActionCard: {
    flexBasis: '48.5%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  quickActionIconBg: {
    width: 34,
    height: 34,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
    flexShrink: 0,
  },
  quickActionTextContainer: {
    flex: 1,
  },
  quickActionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
  },
  quickActionDesc: {
    fontSize: 10,
    color: '#64748B',
    marginTop: 1,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
  },
  summaryIconBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  summaryNumber: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  summaryLabel: {
    fontSize: 10,
    color: '#64748B',
    marginTop: 2,
    fontWeight: '600',
    textAlign: 'center',
  },
  searchWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 12,
    height: 44,
    marginBottom: 10,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: '#0F172A',
    fontSize: 14,
    paddingVertical: 0,
  },
  categoryChipsContainer: {
    flexDirection: 'row',
    gap: 6,
    paddingBottom: 10,
  },
  categoryChip: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryChipActive: {
    backgroundColor: '#1E63EC',
    borderColor: '#1E63EC',
  },
  categoryChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  categoryChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  filterMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    paddingHorizontal: 2,
  },
  filterMetaText: {
    fontSize: 12,
    color: '#64748B',
  },
  clearFiltersText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1E63EC',
  },
  emptyContainer: {
    padding: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  emptyText: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '700',
  },
  emptySubtext: {
    color: '#94A3B8',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 4,
  },
  listContainer: {
    gap: 12,
  },
  productCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  productName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
    flex: 1,
    marginRight: 8,
    lineHeight: 20,
  },
  codeTag: {
    backgroundColor: '#F1F5F9',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  codeTagText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748B',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  cardMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardTagsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    flex: 1,
    marginRight: 8,
  },
  categoryBadge: {
    backgroundColor: '#FEF9C3',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: '#FEF08A',
  },
  categoryBadgeText: {
    color: '#854D0E',
    fontSize: 11,
    fontWeight: '700',
  },
  brandBadge: {
    backgroundColor: '#F1F5F9',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  brandBadgeText: {
    color: '#475569',
    fontSize: 11,
    fontWeight: '600',
  },
  stockStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  stockStatusBadgeNormal: {
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
  },
  stockStatusBadgeLow: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  stockStatusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  stockStatusTextNormal: {
    color: '#16A34A',
  },
  stockStatusTextLow: {
    color: '#DC2626',
  },
  valuesGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  gridCol: {
    alignItems: 'center',
    flex: 1,
  },
  gridLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#94A3B8',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  gridValue: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  marginHealthyText: {
    color: '#16A34A',
  },
  marginTightText: {
    color: '#D97706',
  },
  stockNormalText: {
    color: '#16A34A',
  },
  stockLowText: {
    color: '#DC2626',
  },
  btnActionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  kardexCardBtn: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    height: 38,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  kardexCardBtnText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '700',
  },
  editCardBtn: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#EFF6FF',
    borderRadius: 8,
    height: 38,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  editCardBtnText: {
    color: '#1D4ED8',
    fontSize: 12,
    fontWeight: '700',
  },
  deleteCardBtn: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#FEF2F2',
    borderRadius: 8,
    height: 38,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  deleteCardBtnText: {
    color: '#DC2626',
    fontSize: 12,
    fontWeight: '700',
  },
  fabBtn: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    backgroundColor: '#1E63EC',
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#1E63EC',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 5,
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
    maxHeight: '90%',
  },
  modalHeader: {
    backgroundColor: '#1E63EC',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  closeModalBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 14,
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalForm: {
    padding: 20,
    paddingBottom: Platform.OS === 'ios' ? 40 : 20,
  },
  formGroup: {
    marginBottom: 16,
  },
  formRow: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  formCol: {
    flex: 1,
    position: 'relative',
  },
  formLabel: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#4A5568',
    marginBottom: 8,
  },
  formLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  generateCodeText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#1E63EC',
    marginBottom: 8,
  },
  codeInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  codeScanBtn: {
    backgroundColor: '#1E63EC',
    width: 48,
    height: 48,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  codeSearchBtn: {
    backgroundColor: '#319795',
    width: 48,
    height: 48,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  formInput: {
    backgroundColor: '#F7FAFC',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 12,
    height: 48,
    color: '#2D3748',
    fontSize: 14,
  },
  formDropdownSelector: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F7FAFC',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 12,
    height: 48,
  },
  formDropdownSelectorText: {
    color: '#2D3748',
    fontSize: 14,
  },
  formDropdownOptions: {
    position: 'absolute',
    top: 76,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
    zIndex: 50,
  },
  formDropdownOptionItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: '#EDF2F7',
  },
  modalActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    gap: 12,
  },
  cancelModalBtn: {
    flex: 1,
    backgroundColor: '#EDF2F7',
    borderRadius: 8,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelModalBtnText: {
    color: '#4A5568',
    fontSize: 15,
    fontWeight: 'bold',
  },
  saveModalBtn: {
    flex: 1.5,
    backgroundColor: '#1E63EC',
    borderRadius: 8,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#1E63EC',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  saveModalBtnText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: 'bold',
  },
  priceSuggestionChip: {
    backgroundColor: '#EBF8FF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#BEE3F8',
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  priceSuggestionMain: {
    color: '#2B6CB0',
    fontSize: 13,
    fontWeight: 'bold',
  },
  priceSuggestionBreakdown: {
    color: '#4A5568',
    fontSize: 11,
    marginTop: 2,
  },
  priceWarning: {
    color: '#C53030',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 12,
  },
  actionToolsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
    marginTop: -4,
  },
  toolBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderRadius: 8,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
  },
  toolBtnText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '700',
  },
});
