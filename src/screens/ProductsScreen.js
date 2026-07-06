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
  Dimensions
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useApp } from '../context/AppContext';
import { saveProduct, deleteProduct } from '../database/db';
import { Ionicons } from '@expo/vector-icons';

const CATEGORIAS = ['Laticínios', 'Mercearia', 'Bebidas', 'Higiene', 'Limpeza', 'Outros'];

export default function ProductsScreen() {
  const { products, logout, refreshData } = useApp();
  
  // Filtros
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Todas as categorias');
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);

  // Modal
  const [modalVisible, setModalVisible] = useState(false);
  const [showFormCategoryDropdown, setShowFormCategoryDropdown] = useState(false);
  
  // Estado do formulário
  const [productId, setProductId] = useState(null);
  const [codigo, setCodigo] = useState('');
  const [categoria, setCategoria] = useState('');
  const [nome, setNome] = useState('');
  const [marca, setMarca] = useState('');
  const [precoCusto, setPrecoCusto] = useState('');
  const [precoVenda, setPrecoVenda] = useState('');
  const [estoque, setEstoque] = useState('');
  const [estoqueMinimo, setEstoqueMinimo] = useState('');

  // Métricas para os 3 cards do topo (calculadas de forma reativa a partir do SQLite products)
  const totalProdutos = products.length;
  const estoqueBaixo = products.filter(p => p.estoque <= p.estoque_minimo).length;
  const estoqueNormal = totalProdutos - estoqueBaixo;

  // Filtragem
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
      Alert.alert('Erro', 'Por favor, preencha os campos obrigatórios (*): Categoria, Nome, Preço de Custo, Preço de Venda e Estoque.');
      return;
    }

    const custo = parseFloat(precoCusto.replace(',', '.'));
    const venda = parseFloat(precoVenda.replace(',', '.'));
    const qtyEstoque = parseInt(estoque, 10);
    const qtyMin = estoqueMinimo ? parseInt(estoqueMinimo, 10) : 0;

    if (isNaN(custo) || custo <= 0) {
      Alert.alert('Erro', 'Preço de Custo deve ser um número maior que zero.');
      return;
    }
    if (isNaN(venda) || venda <= 0) {
      Alert.alert('Erro', 'Preço de Venda deve ser um número maior que zero.');
      return;
    }
    if (isNaN(qtyEstoque) || qtyEstoque < 0) {
      Alert.alert('Erro', 'Estoque deve ser um número inteiro igual ou maior que zero.');
      return;
    }
    if (isNaN(qtyMin) || qtyMin < 0) {
      Alert.alert('Erro', 'Estoque Mínimo deve ser um número inteiro igual ou maior que zero.');
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
      });

      Alert.alert('Sucesso', productId ? 'Produto atualizado com sucesso!' : 'Produto cadastrado com sucesso!');
      setModalVisible(false);
      await refreshData();
    } catch (error) {
      Alert.alert('Erro', 'Não foi possível salvar o produto.');
      console.error(error);
    }
  };

  const handleDelete = (id, productName) => {
    Alert.alert(
      'Excluir Produto',
      `Tem certeza de que deseja excluir o produto "${productName}"?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { 
          text: 'Excluir', 
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteProduct(id);
              await refreshData();
              Alert.alert('Sucesso', 'Produto excluído com sucesso.');
            } catch (error) {
              Alert.alert('Erro', 'Não foi possível excluir o produto. Ele pode estar associado a vendas.');
              console.error(error);
            }
          }
        }
      ]
    );
  };

  const selectCategoryFilter = (cat) => {
    setSelectedCategory(cat);
    setShowCategoryDropdown(false);
  };

  const selectFormCategory = (cat) => {
    setCategoria(cat);
    setShowFormCategoryDropdown(false);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <StatusBar style="light" />
      
      {/* Header Bar */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="cart" size={24} color="#FFF" style={{ marginRight: 8 }} />
          <Text style={styles.headerTitle}>Mercado Manager</Text>
        </View>
        <TouchableOpacity style={styles.logoutBtn} onPress={logout}>
          <Text style={styles.logoutText}>Sair</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
        {/* Título e Botão Novo */}
        <View style={styles.titleRow}>
          <View>
            <Text style={styles.mainTitle}>Produtos</Text>
            <Text style={styles.subtitle}>Gerencie o estoque do mercado</Text>
          </View>
          <TouchableOpacity style={styles.topAddBtn} onPress={openAddModal}>
            <Text style={styles.topAddBtnText}>+ Novo</Text>
          </TouchableOpacity>
        </View>

        {/* 3 Cards de Resumo */}
        <View style={styles.summaryRow}>
          {/* Card 1: Total */}
          <View style={styles.summaryCard}>
            <Text style={styles.summaryEmoji}>📦</Text>
            <Text style={styles.summaryNumber}>{totalProdutos}</Text>
            <Text style={styles.summaryLabel}>Total de Produtos</Text>
          </View>
          {/* Card 2: Estoque Normal */}
          <View style={styles.summaryCard}>
            <Text style={styles.summaryEmoji}>✅</Text>
            <Text style={styles.summaryNumber}>{estoqueNormal}</Text>
            <Text style={styles.summaryLabel}>Em Estoque Normal</Text>
          </View>
          {/* Card 3: Estoque Baixo */}
          <View style={styles.summaryCard}>
            <Text style={styles.summaryEmoji}>⚠️</Text>
            <Text style={[styles.summaryNumber, estoqueBaixo > 0 && { color: '#E53E3E' }]}>{estoqueBaixo}</Text>
            <Text style={styles.summaryLabel}>Estoque Baixo</Text>
          </View>
        </View>

        {/* Barra de Busca */}
        <View style={styles.searchWrapper}>
          <Ionicons name="search" size={20} color="#A0AEC0" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Buscar produto..."
            placeholderTextColor="#A0AEC0"
            value={search}
            onChangeText={setSearch}
          />
        </View>

        {/* Filtro de Categoria (Dropdown) */}
        <View style={styles.dropdownContainer}>
          <TouchableOpacity 
            style={styles.dropdownSelector} 
            onPress={() => setShowCategoryDropdown(!showCategoryDropdown)}
          >
            <Text style={styles.dropdownSelectorText}>{selectedCategory}</Text>
            <Ionicons name="chevron-down" size={18} color="#4A5568" />
          </TouchableOpacity>

          {showCategoryDropdown && (
            <View style={styles.dropdownOptions}>
              <TouchableOpacity 
                style={styles.dropdownOptionItem} 
                onPress={() => selectCategoryFilter('Todas as categorias')}
              >
                <Text style={styles.dropdownOptionText}>Todas as categorias</Text>
              </TouchableOpacity>
              {CATEGORIAS.map((cat, idx) => (
                <TouchableOpacity 
                  key={idx.toString()} 
                  style={styles.dropdownOptionItem} 
                  onPress={() => selectCategoryFilter(cat)}
                >
                  <Text style={styles.dropdownOptionText}>{cat}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* Listagem de Produtos */}
        {filteredProducts.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>Nenhum produto encontrado.</Text>
          </View>
        ) : (
          <View style={styles.listContainer}>
            {filteredProducts.map((item) => {
              const isLowStock = item.estoque <= item.estoque_minimo;
              return (
                <View key={item.id.toString()} style={styles.productCard}>
                  {/* Cabeçalho do Card */}
                  <View style={styles.cardHeaderRow}>
                    <Text style={styles.productName}>{item.nome}</Text>
                    <View style={styles.codeTag}>
                      <Text style={styles.codeTagText}>#{item.codigo_barras || 'N/D'}</Text>
                    </View>
                  </View>

                  {/* Categoria Badge */}
                  <View style={styles.categoryBadge}>
                    <Text style={styles.categoryBadgeText}>{item.categoria || 'Outros'}</Text>
                  </View>

                  {/* Grid de Valores */}
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
                      <Text style={styles.gridLabel}>ESTOQUE</Text>
                      <Text style={[
                        styles.gridValue, 
                        isLowStock ? styles.stockLowText : styles.stockNormalText
                      ]}>
                        {item.estoque} un
                      </Text>
                    </View>
                  </View>

                  {/* Botões Editar / Excluir */}
                  <View style={styles.btnActionsRow}>
                    <TouchableOpacity style={styles.editCardBtn} onPress={() => openEditModal(item)}>
                      <Ionicons name="pencil" size={16} color="#2B6CB0" style={{ marginRight: 6 }} />
                      <Text style={styles.editCardBtnText}>Editar</Text>
                    </TouchableOpacity>

                    <TouchableOpacity 
                      style={styles.deleteCardBtn} 
                      onPress={() => handleDelete(item.id, item.nome)}
                    >
                      <Ionicons name="trash" size={16} color="#C53030" style={{ marginRight: 6 }} />
                      <Text style={styles.deleteCardBtnText}>Excluir</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* Floating Action Button (FAB) */}
      <TouchableOpacity style={styles.fabBtn} onPress={openAddModal}>
        <Ionicons name="add" size={32} color="#FFF" />
      </TouchableOpacity>

      {/* Modal Novo/Editar Produto */}
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
            {/* Header Modal */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {productId ? '✏️ Editar Produto' : '＋ Novo Produto'}
              </Text>
              <TouchableOpacity onPress={() => setModalVisible(false)} style={styles.closeModalBtn}>
                <Ionicons name="close" size={20} color="#FFF" />
              </TouchableOpacity>
            </View>

            {/* Formulário Scroll */}
            <ScrollView contentContainerStyle={styles.modalForm}>
              {/* Grid Linha 1: Código e Categoria */}
              <View style={styles.formRow}>
                <View style={[styles.formCol, { marginRight: 10 }]}>
                  <Text style={styles.formLabel}>Código</Text>
                  <TextInput
                    style={styles.formInput}
                    placeholder="Ex: 001"
                    placeholderTextColor="#A0AEC0"
                    value={codigo}
                    onChangeText={setCodigo}
                    keyboardType="numeric"
                  />
                </View>

                {/* Dropdown de Categoria no Formulário */}
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

              {/* Nome */}
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

              {/* Marca */}
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

              {/* Grid Linha 3: Custo e Venda */}
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

              {/* Grid Linha 4: Estoque e Mínimo */}
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

              {/* Botões Salvar / Cancelar */}
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
  logoutBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 8,
  },
  logoutText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  scrollContainer: {
    backgroundColor: '#F0F4F8',
    padding: 16,
    paddingBottom: 80,
    flexGrow: 1,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  mainTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#2D3748',
  },
  subtitle: {
    fontSize: 13,
    color: '#718096',
    marginTop: 2,
  },
  topAddBtn: {
    backgroundColor: '#1E63EC',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    shadowColor: '#1E63EC',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  topAddBtnText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  summaryEmoji: {
    fontSize: 20,
    marginBottom: 4,
  },
  summaryNumber: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2D3748',
  },
  summaryLabel: {
    fontSize: 9,
    color: '#A0AEC0',
    marginTop: 2,
    fontWeight: '600',
    textAlign: 'center',
  },
  searchWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 14,
    height: 48,
    marginBottom: 12,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: '#2D3748',
    fontSize: 15,
  },
  dropdownContainer: {
    position: 'relative',
    zIndex: 10,
    marginBottom: 16,
  },
  dropdownSelector: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 14,
    height: 48,
  },
  dropdownSelectorText: {
    color: '#4A5568',
    fontSize: 15,
    fontWeight: '500',
  },
  dropdownOptions: {
    position: 'absolute',
    top: 50,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 5,
    zIndex: 20,
  },
  dropdownOptionItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: '#EDF2F7',
  },
  dropdownOptionText: {
    color: '#4A5568',
    fontSize: 14,
  },
  emptyContainer: {
    padding: 32,
    alignItems: 'center',
  },
  emptyText: {
    color: '#718096',
    fontSize: 15,
  },
  listContainer: {
    gap: 12,
  },
  productCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  productName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2D3748',
    flex: 1,
    marginRight: 8,
  },
  codeTag: {
    backgroundColor: '#EDF2F7',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  codeTagText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#718096',
  },
  categoryBadge: {
    backgroundColor: '#FEFCBF', // Fundo amarelo clarinho igual à imagem
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignSelf: 'flex-start',
    marginTop: 6,
    marginBottom: 12,
  },
  categoryBadgeText: {
    color: '#B7791F', // Texto laranja amarelado
    fontSize: 11,
    fontWeight: 'bold',
  },
  valuesGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2F7',
    marginBottom: 12,
  },
  gridCol: {
    alignItems: 'flex-start',
  },
  gridLabel: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#A0AEC0',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  gridValue: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#2D3748',
  },
  stockNormalText: {
    color: '#2F855A', // Verde se estoque normal
  },
  stockLowText: {
    color: '#C53030', // Vermelho se estoque crítico
  },
  btnActionsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  editCardBtn: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#EBF8FF', // Azul claro idêntico à imagem
    borderRadius: 8,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  editCardBtnText: {
    color: '#2B6CB0', // Texto azul royal
    fontSize: 14,
    fontWeight: 'bold',
  },
  deleteCardBtn: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#FFF5F5', // Vermelho claro idêntico à imagem
    borderRadius: 8,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteCardBtnText: {
    color: '#C53030', // Texto vermelho
    fontSize: 14,
    fontWeight: 'bold',
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
});
