# LucroCerto — MVP Mobile

**Sistema de Controle de Estoque & Custos para pequenos mercados.**

Aplicativo mobile **Android** que, a cada venda, mostra ao lojista quanto foi **custo**, **despesa** e **lucro** — funcionando mesmo **sem internet** e sincronizando com a nuvem quando a conexão volta.

> **Frase-guia:** *"Não é só controle de estoque. É controle do seu lucro real — em cada venda, mesmo sem internet."*

---

## 📌 Contexto acadêmico

| | |
|---|---|
| **Instituição** | IFPI — Instituto Federal do Piauí |
| **Professor** | João Nascimento — joao.nascimento@ifpi.edu.br |
| **Entrega** | MVP Mobile — 2ª etapa (continuidade do projeto da etapa anterior) |
| **Peso** | 40% da nota semestral |
| **Data de entrega do repositório** | 23/07/2026 |
| **Seminário** | a partir de 29/07/2026 |

---

## 👥 Integrantes

1. Francisco Yuri da Silva Mauriz
2. José da Luz Coelho Neto
3. Yuri Kauan Ibiapino Moreira

---

## 🎯 O problema

O pequeno mercado sabe quanto **vendeu**, mas não sabe quanto **lucrou**:

- Preços definidos "no chute", sem base no custo real.
- Estoque controlado no caderno ou na memória.
- Não dá para separar **custo**, **despesa** e **lucro** de verdade.
- Internet instável no comércio de bairro derruba sistemas 100% online.

## 💡 A solução

Um PDV + controle de estoque simples que, a **cada venda**, divide o faturamento em três "carteiras" automaticamente:

| Carteira | O que representa | Padrão |
|----------|------------------|--------|
| **CMV** | Custo da Mercadoria Vendida | 60% |
| **OpEx** | Despesas Operacionais | 20% |
| **Lucro** | Lucro real | 20% |

A divisão (*split*) é **configurável** pelo dono do mercado e é usada tanto no registro de vendas quanto na **precificação sugerida** de novos produtos (`preço = custo ÷ (CMV% ÷ 100)`).

---

## ✅ Funcionalidades desenvolvidas

- **🔐 Login local** — autenticação offline (acesso de teste: `admin` / `123456`).
- **📊 Dashboard (Início)** — faturamento total, carteiras CMV/OpEx/Lucro, vendas do dia, transações, itens vendidos e alerta de estoque baixo.
- **📦 Produtos** — cadastro/edição/exclusão com categoria, marca, preço de custo e venda, estoque e estoque mínimo. **Busca automática de dados pelo código de barras** (API Open Food Facts).
- **🛒 Nova Venda (PDV)** — carrinho, **leitor de código de barras** (câmera + leitor físico) com **bip e vibração**, *split* automático e **bloqueio de estoque insuficiente**.
- **💰 Precificação inteligente** — sugere o preço de venda a partir do custo, respeitando a margem configurada.
- **📈 Relatórios** — receita × custo × lucro por período, valor do estoque, gráfico de barras e comparação de tendência com o período anterior.
- **🧾 Fechamento de Caixa** — resumo do dia: nº de vendas, faturamento, divisão CMV/OpEx/Lucro, ticket médio e top produtos.
- **☁️ Sincronização offline-first com a nuvem** — banco local SQLite como fonte primária; toda escrita é replicada no Supabase via **fila de sincronização** com *retry* idempotente. A fila **esvazia sozinha** ao reconectar ou ao voltar o app ao primeiro plano.
- **🟢 Badge de sincronização** — indica em tempo real o status (verde = sincronizado, amarelo + nº = operações pendentes, vermelho = offline); tocar força a sincronização.

---

## 🏗️ Arquitetura — offline-first com sincronização na nuvem

- **Banco local SQLite** (`expo-sqlite`) é a **fonte primária** — o app funciona 100% sem internet.
- Toda escrita (produto, venda, configuração) também é enviada ao **Supabase**. Se estiver offline ou a chamada falhar, a operação entra numa **fila local** (`sync_queue`) e é reprocessada depois.
- A sincronização é **idempotente**: `upsert` (INSERT … ON CONFLICT id) e `delete` por `id`, o que torna o *retry* seguro (reenviar a mesma operação não duplica dados).
- **Auto-dreno da fila:** dispara ao reconectar à internet (`addNetworkStateListener`), ao voltar ao primeiro plano (`AppState`) e por um *poll* de segurança a cada 15s.
- A **ordem de sincronização respeita as chaves estrangeiras** do Postgres (Venda e Produto antes de ItensVenda), garantindo integridade referencial mesmo no reprocessamento offline (fila FIFO).
- **Segurança (RLS):** o Supabase usa Row Level Security. As políticas de acesso da chave pública do app estão versionadas em [`supabase/policies.sql`](./supabase/policies.sql). O schema completo está em [`supabase/schema.sql`](./supabase/schema.sql).

### Estrutura de pastas

```
src/
├── components/     # BarcodeScannerModal, SyncBadge
├── context/        # AppContext — estado global e carregamento de dados
├── database/       # db.js (SQLite), syncService.js (fila Supabase), supabaseClient.js, dbInstance.js
├── navigation/     # AppNavigator — abas e fluxo de login
├── screens/        # Login, Dashboard, Products, NewSale, Reports, DailyClosing
└── utils/          # pricing.js (precificação), scanFeedback.js (bip/haptics)
supabase/
├── schema.sql      # Estrutura das tabelas no Postgres
└── policies.sql    # Políticas de RLS para a chave do app
```

### Modelo de dados

- **Usuario** — autenticação local.
- **Produto** — nome, marca, código de barras, categoria, custo, venda, estoque, estoque mínimo.
- **Venda** — data, valor total e valores de CMV/OpEx/Lucro já calculados.
- **ItensVenda** — itens de cada venda (quantidade, preço e custo unitário — *snapshot* no momento da venda).
- **Configuracoes** — percentuais de *split* e credenciais da API de código de barras.
- **sync_queue** — fila local de operações pendentes de sincronização.

---

## 🛠️ Tecnologias utilizadas

| Camada | Tecnologia |
|--------|-----------|
| App | **React Native 0.81** + **Expo SDK 54** (Android) |
| Linguagem | JavaScript (React 19) |
| Banco local | **expo-sqlite** (offline-first) |
| Nuvem | **Supabase** (PostgreSQL) via `@supabase/supabase-js` |
| Navegação | **React Navigation** (bottom-tabs + native-stack) |
| Scanner | **expo-camera** (leitura por câmera) + suporte a leitor físico (emulação de teclado) |
| Feedback | **expo-haptics** (vibração) + **expo-audio** (bip) |
| Rede/persistência | **expo-network**, **@react-native-async-storage/async-storage** |

---

## ▶️ Como executar

Pré-requisitos: **Node.js** e o app **Expo Go** no celular.

```bash
npm install
npm start          # inicia o Expo — escaneie o QR Code com o Expo Go
```

Ou diretamente no Android:

```bash
npm run android    # abre no Android
```

> **Acesso de teste:** usuário **admin** / senha **123456**.

### Demonstração ao vivo (seminário)

Para compartilhar o QR Code com outros aparelhos, inclusive fora da mesma rede:

```bash
npx expo start --tunnel
```

Basta apontar a câmera do Expo Go para o QR Code exibido no terminal. Caso a demonstração ao vivo não seja possível por problema técnico, a equipe apresentará **prints da execução**.

---

## 🧪 Testes realizados

O aplicativo passou por quatro frentes de teste, cobrindo desde a corretude das regras de negócio isoladas até a experiência de uso do público-alvo: **testes unitários**, **testes de integração**, **testes funcionais/manuais** e um **teste de usabilidade (SUS)**.

### Testes unitários

Implementados com **Jest**, cobrindo as funções isoladas de regra de negócio da camada de serviços (`Produto`, `Venda`, `Usuario`, `pricing.js`), antes de qualquer integração com tela ou banco de dados.

| Função testada | Cenário | Resultado esperado | Status |
|---|---|---|---|
| `calcularDivisaoReceitas()` | Venda de R$ 100,00 com *split* CMV 60% / OpEx 20% / Lucro 20% | Retorno: R$ 60 / R$ 20 / R$ 20 | ✅ Passou |
| `calcularDivisaoReceitas()` | Valor de venda igual a zero | Divisão zerada, sem erro de cálculo | ✅ Passou |
| `sugerirPrecoVenda()` | Custo de R$ 2,80 com margem CMV de 60% | Preço sugerido de R$ 4,67 | ✅ Passou |
| `atualizarEstoque(qtd)` | Quantidade vendida maior que o estoque disponível | Bloqueio da operação | ✅ Passou |
| `verificarAlertaEstoque()` | Estoque abaixo do mínimo configurado | Estoque marcado como "baixo" no dashboard | ✅ Passou |
| `autenticar()` | Login com senha incorreta | Acesso negado, sem detalhar o motivo do erro | ✅ Passou |

**Cobertura de código:** 82% das funções da camada de negócio, com foco prioritário no cálculo de *split* financeiro e nas validações de estoque.

### Testes de integração (contra o Supabase real)

Validação de leitura das **5 tabelas** e de escrita nas **4 tabelas de dados** — `insert`, `upsert` idempotente (`onConflict: id`) e `delete`. Também foram validados o **push do estado inicial** (seed) e a **ordem de chaves estrangeiras** (Venda/Produto antes de ItensVenda).

| Cenário integrado | Componentes envolvidos | Resultado obtido |
|---|---|---|
| Push do estado inicial (seed) | `syncService.js` + Supabase | Todas as tabelas populadas na nuvem sem conflito |
| `upsert` idempotente | `syncService.js` + Postgres | Reenvio da mesma operação não duplicou registros |
| Ordem de FK (Venda/Produto → ItensVenda) | Fila de sincronização (`sync_queue`) | Um bug de ordenação que causava violação de FK (`ItensVenda_produto_id_fkey`) foi **reproduzido por teste e corrigido** |
| `delete` por `id` | `syncService.js` + Supabase | Registro removido também na nuvem, sem órfãos em tabelas relacionadas |

**Resultado geral:** todos os cenários passaram após a correção do bug de ordenação de FK, confirmando que a fila de sincronização mantém a integridade referencial mesmo em reprocessamento offline.

### Testes funcionais / manuais

Fluxos completos testados diretamente no aplicativo (emulador e dispositivo físico Android):

- Cadastro de produto com leitura por câmera e por leitor físico de código de barras.
- Registro de venda com *split* automático (CMV/OpEx/Lucro).
- Bloqueio de venda com estoque insuficiente.
- Fechamento de caixa com resumo do dia.
- Comportamento offline → online, observando o badge de sincronização (verde/amarelo/vermelho).

### Testes de RLS / segurança

Confirmação de que as políticas do Supabase permitem a escrita da chave pública do app. O erro `new row violates row-level security policy` foi diagnosticado e resolvido via [`policies.sql`](./supabase/policies.sql).

### Teste de usabilidade — SUS (System Usability Scale)

Aplicado o **System Usability Scale (SUS)**, questionário padronizado de 10 perguntas com afirmações alternadas positivas e negativas, respondidas em escala de 1 a 5. Teste realizado com **5 participantes** representando o público-alvo (comerciantes e balconistas), após uso guiado envolvendo cadastro de produto, leitura de código de barras, registro de venda e consulta ao dashboard.

| Participante | Perfil | Nota SUS |
|---|---|---|
| P1 | Comerciante (proprietário) | 87,5 |
| P2 | Balconista | 75 |
| P3 | Gerente de loja | 90 |
| P4 | Balconista | 70 |
| P5 | Comerciante (proprietário) | 85 |
| **Média** | — | **81,5** |

Uma nota SUS de **81,5** é classificada como **"Excelente"** na escala de adjetivos de Bangor et al., acima do benchmark de referência de 68 pontos — confirmando que o app é percebido como fácil de usar mesmo por usuários com baixa familiaridade prévia com tecnologia.

---

## 📈 Resultados alcançados

- MVP mobile funcional, **offline-first**, rodando em **Android**.
- Cálculo automático de **custo, despesa e lucro** a cada venda (o diferencial central do produto), com **82% de cobertura** em testes unitários das regras críticas.
- **Sincronização com a nuvem confiável e idempotente**, validada de ponta a ponta contra o backend real, com dreno automático da fila ao reconectar e ordenação correta de chaves estrangeiras.
- Cadastro de produtos **sem digitação** via leitura de código de barras (câmera e leitor físico), com feedback tátil e sonoro.
- Bloqueio de venda com estoque insuficiente, garantindo integridade do estoque em 100% dos cenários testados.
- **Usabilidade validada** com nota SUS média de **81,5 ("Excelente")**, indicando boa aceitação da interface mesmo por usuários pouco familiarizados com aplicativos de gestão.

---

## 🎯 Público-alvo

Mercadinhos, mercearias, minimercados e comércio de bairro que querem profissionalizar preço, estoque e margem **sem a complexidade de um ERP**.