-- =============================================
-- SCHEMA SUPABASE (PostgreSQL) - LucroCerto v2.0
-- Semanas S01 a S04: Integração Completa
-- Integrantes: Francisco Yuri, Yuri Moreira, Zé Neto
-- =============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------
-- Tabela: Usuario (Autenticação e Permissões)
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS "Usuario" (
  id         BIGSERIAL    PRIMARY KEY,
  nome       TEXT         NOT NULL,
  email      TEXT         NOT NULL UNIQUE,
  senha      TEXT         NOT NULL,
  cargo      TEXT         NOT NULL DEFAULT 'gerente', -- 'gerente', 'balconista'
  gerente_id BIGINT,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------
-- Tabela: Fornecedor (Zé Neto - S01/S02)
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS "Fornecedor" (
  id         BIGSERIAL    PRIMARY KEY,
  gerente_id BIGINT       NOT NULL,
  nome       TEXT         NOT NULL,
  cnpj_cpf   TEXT,
  telefone   TEXT,
  email      TEXT,
  cidade     TEXT,
  ativo      BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------
-- Tabela: Cliente (Yuri Mauriz - S01/S02 Caderneta/Fiado)
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS "Cliente" (
  id             BIGSERIAL     PRIMARY KEY,
  gerente_id     BIGINT        NOT NULL,
  nome           TEXT          NOT NULL,
  cpf            TEXT,
  telefone       TEXT,
  limite_fiado   NUMERIC(10,2) NOT NULL DEFAULT 0.00 CHECK (limite_fiado >= 0),
  saldo_devedor  NUMERIC(10,2) NOT NULL DEFAULT 0.00 CHECK (saldo_devedor >= 0),
  ativo          BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------
-- Tabela: Produto (Catálogo e Saldo Atual)
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS "Produto" (
  id              BIGINT        NOT NULL,
  gerente_id      BIGINT        NOT NULL,
  fornecedor_id   BIGINT,
  nome            TEXT          NOT NULL,
  marca           TEXT,
  codigo_barras   TEXT,
  categoria       TEXT,
  preco_custo     NUMERIC(10,2) NOT NULL CHECK (preco_custo >= 0), -- PMP atual
  preco_venda     NUMERIC(10,2) NOT NULL CHECK (preco_venda >= 0),
  estoque         NUMERIC(10,3) NOT NULL DEFAULT 0 CHECK (estoque >= 0),
  estoque_minimo  NUMERIC(10,3) NOT NULL DEFAULT 0 CHECK (estoque_minimo >= 0),
  unidade_medida  TEXT          NOT NULL DEFAULT 'UN',
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, gerente_id),
  FOREIGN KEY (fornecedor_id) REFERENCES "Fornecedor"(id) ON DELETE SET NULL
);

-- ------------------------------------------------
-- Tabela: FormaPagamentoConfig (Yuri Mauriz - S01/S02 Taxas)
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS "FormaPagamentoConfig" (
  id              BIGSERIAL    PRIMARY KEY,
  gerente_id      BIGINT       NOT NULL,
  codigo          TEXT         NOT NULL, -- 'dinheiro', 'pix', 'cartao_debito', 'cartao_credito', 'fiado'
  nome            TEXT         NOT NULL,
  operadora       TEXT         DEFAULT 'Padrao',
  taxa_percentual NUMERIC(5,2) NOT NULL DEFAULT 0.00 CHECK (taxa_percentual >= 0),
  taxa_fixa       NUMERIC(10,2) NOT NULL DEFAULT 0.00 CHECK (taxa_fixa >= 0),
  ativo           BOOLEAN      NOT NULL DEFAULT TRUE,
  CONSTRAINT unq_gerente_codigo_operadora UNIQUE (gerente_id, codigo, operadora)
);

-- ------------------------------------------------
-- Tabela: Venda (Yuri Moreira / Yuri Mauriz - S01 a S04)
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS "Venda" (
  id             BIGINT        NOT NULL,
  gerente_id     BIGINT        NOT NULL,
  usuario_id     BIGINT,
  cliente_id     BIGINT,
  canal_venda    TEXT          NOT NULL DEFAULT 'balcao', -- 'balcao', 'delivery', 'encomenda'
  data_venda     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  valor_bruto    NUMERIC(10,2) NOT NULL CHECK (valor_bruto >= 0),
  desconto       NUMERIC(10,2) NOT NULL DEFAULT 0.00 CHECK (desconto >= 0),
  valor_total    NUMERIC(10,2) NOT NULL CHECK (valor_total >= 0),
  total_taxas    NUMERIC(10,2) NOT NULL DEFAULT 0.00 CHECK (total_taxas >= 0),
  valor_liquido  NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  valor_cmv      NUMERIC(10,2) NOT NULL CHECK (valor_cmv >= 0),
  valor_opex     NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  valor_lucro    NUMERIC(10,2) NOT NULL, -- Resultado após CMV e taxas
  status         TEXT          NOT NULL DEFAULT 'concluida', -- 'concluida', 'cancelada', 'parcialmente_devolvida'
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, gerente_id),
  FOREIGN KEY (cliente_id) REFERENCES "Cliente"(id) ON DELETE SET NULL
);

-- ------------------------------------------------
-- Tabela: ItensVenda (Snapshot no momento da venda)
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS "ItensVenda" (
  id                    BIGINT        NOT NULL,
  gerente_id            BIGINT        NOT NULL,
  venda_id              BIGINT        NOT NULL,
  produto_id            BIGINT        NOT NULL,
  quantidade            NUMERIC(10,3) NOT NULL CHECK (quantidade > 0),
  quantidade_devolvida  NUMERIC(10,3) NOT NULL DEFAULT 0 CHECK (quantidade_devolvida >= 0),
  preco_unitario        NUMERIC(10,2) NOT NULL CHECK (preco_unitario >= 0),
  preco_custo_unitario  NUMERIC(10,2) NOT NULL CHECK (preco_custo_unitario >= 0),
  desconto_item         NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  subtotal              NUMERIC(10,2) NOT NULL CHECK (subtotal >= 0),
  PRIMARY KEY (id, gerente_id),
  FOREIGN KEY (venda_id, gerente_id) REFERENCES "Venda"(id, gerente_id) ON DELETE CASCADE,
  FOREIGN KEY (produto_id, gerente_id) REFERENCES "Produto"(id, gerente_id) ON DELETE RESTRICT
);

-- ------------------------------------------------
-- Tabela: PagamentoVenda (Yuri Mauriz - S03 Processamento Misto)
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS "PagamentoVenda" (
  id              BIGSERIAL     PRIMARY KEY,
  gerente_id      BIGINT        NOT NULL,
  venda_id        BIGINT        NOT NULL,
  forma_pagamento TEXT          NOT NULL, -- 'dinheiro', 'pix', 'cartao_debito', 'cartao_credito', 'fiado'
  operadora       TEXT          DEFAULT 'Padrao',
  valor_bruto     NUMERIC(10,2) NOT NULL CHECK (valor_bruto > 0),
  taxa_percentual NUMERIC(5,2)  NOT NULL DEFAULT 0.00,
  taxa_fixa       NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  valor_taxa      NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  valor_liquido   NUMERIC(10,2) NOT NULL,
  estornado       BOOLEAN       NOT NULL DEFAULT FALSE,
  FOREIGN KEY (venda_id, gerente_id) REFERENCES "Venda"(id, gerente_id) ON DELETE CASCADE
);

-- ------------------------------------------------
-- Tabela: CancelamentoVenda (Yuri Moreira - S03 Cancelamento)
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS "CancelamentoVenda" (
  id              BIGSERIAL    PRIMARY KEY,
  gerente_id      BIGINT       NOT NULL,
  venda_id        BIGINT       NOT NULL,
  usuario_id      BIGINT       NOT NULL,
  justificativa   TEXT         NOT NULL,
  data_cancelamento TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (venda_id, gerente_id) REFERENCES "Venda"(id, gerente_id) ON DELETE CASCADE,
  FOREIGN KEY (usuario_id) REFERENCES "Usuario"(id)
);

-- ------------------------------------------------
-- Tabela: DevolucaoVenda (Yuri Moreira - S04 Devolução Parcial)
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS "DevolucaoVenda" (
  id              BIGSERIAL     PRIMARY KEY,
  gerente_id      BIGINT        NOT NULL,
  venda_id        BIGINT        NOT NULL,
  usuario_id      BIGINT        NOT NULL,
  motivo          TEXT          NOT NULL,
  valor_estornado NUMERIC(10,2) NOT NULL CHECK (valor_estornado >= 0),
  cmv_estornado   NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  taxas_estornadas NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  data_devolucao  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  FOREIGN KEY (venda_id, gerente_id) REFERENCES "Venda"(id, gerente_id) ON DELETE CASCADE,
  FOREIGN KEY (usuario_id) REFERENCES "Usuario"(id)
);

-- ------------------------------------------------
-- Tabela: ItensDevolucao (Yuri Moreira - S04)
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS "ItensDevolucao" (
  id              BIGSERIAL     PRIMARY KEY,
  gerente_id      BIGINT        NOT NULL,
  devolucao_id    BIGINT        NOT NULL,
  item_venda_id   BIGINT        NOT NULL,
  produto_id      BIGINT        NOT NULL,
  quantidade      NUMERIC(10,3) NOT NULL CHECK (quantidade > 0),
  valor_unitario  NUMERIC(10,2) NOT NULL,
  custo_unitario  NUMERIC(10,2) NOT NULL,
  apto_retorno    BOOLEAN       NOT NULL DEFAULT TRUE, -- Se falso, item avariado/descartado
  FOREIGN KEY (devolucao_id) REFERENCES "DevolucaoVenda"(id) ON DELETE CASCADE
);

-- ------------------------------------------------
-- Tabela: EntradaMercadoria (Zé Neto - S03 Recebimento & PMP)
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS "EntradaMercadoria" (
  id               BIGSERIAL     PRIMARY KEY,
  gerente_id       BIGINT        NOT NULL,
  fornecedor_id    BIGINT        NOT NULL,
  numero_nota      TEXT,
  serie_nota       TEXT,
  chave_acesso     TEXT,
  data_recebimento TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  valor_total_nota NUMERIC(10,2) NOT NULL CHECK (valor_total_nota >= 0),
  observacoes      TEXT,
  FOREIGN KEY (fornecedor_id) REFERENCES "Fornecedor"(id) ON DELETE RESTRICT
);

-- ------------------------------------------------
-- Tabela: ItensEntrada (Zé Neto - S03)
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS "ItensEntrada" (
  id                   BIGSERIAL     PRIMARY KEY,
  gerente_id           BIGINT        NOT NULL,
  entrada_id           BIGINT        NOT NULL,
  produto_id           BIGINT        NOT NULL,
  quantidade           NUMERIC(10,3) NOT NULL CHECK (quantidade > 0),
  custo_unitario       NUMERIC(10,2) NOT NULL CHECK (custo_unitario >= 0),
  custo_total          NUMERIC(10,2) NOT NULL CHECK (custo_total >= 0),
  lote                 TEXT,
  data_validade        DATE,
  pmp_anterior         NUMERIC(10,2) NOT NULL,
  pmp_resultante       NUMERIC(10,2) NOT NULL,
  estoque_anterior     NUMERIC(10,3) NOT NULL,
  estoque_resultante   NUMERIC(10,3) NOT NULL,
  FOREIGN KEY (entrada_id) REFERENCES "EntradaMercadoria"(id) ON DELETE CASCADE
);

-- ------------------------------------------------
-- Tabela: Kardex / MovimentacaoEstoque (Zé Neto - S01/S02 Kardex)
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS "MovimentacaoEstoque" (
  id                 BIGSERIAL     PRIMARY KEY,
  gerente_id         BIGINT        NOT NULL,
  produto_id         BIGINT        NOT NULL,
  tipo_movimentacao  TEXT          NOT NULL, -- 'ENTRADA', 'SAIDA_VENDA', 'ESTORNO_VENDA', 'DEVOLUCAO_CLIENTE', 'PERDA_QUEBRA', 'PERDA_AVARIA', 'PERDA_EXTRAVIO', 'PERDA_FURTO'
  quantidade         NUMERIC(10,3) NOT NULL, -- Positivo ou negativo
  saldo_anterior     NUMERIC(10,3) NOT NULL,
  saldo_resultante   NUMERIC(10,3) NOT NULL,
  custo_unitario     NUMERIC(10,2) NOT NULL,
  valor_total        NUMERIC(10,2) NOT NULL,
  origem_tipo        TEXT, -- 'venda', 'entrada', 'cancelamento', 'devolucao', 'perda'
  origem_id          BIGINT,
  justificativa      TEXT,
  responsavel_id     BIGINT,
  data_movimentacao  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------
-- Tabela: PerdaEstoque (Zé Neto - S04 Perdas e Avarias)
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS "PerdaEstoque" (
  id                BIGSERIAL     PRIMARY KEY,
  gerente_id        BIGINT        NOT NULL,
  produto_id        BIGINT        NOT NULL,
  usuario_id        BIGINT        NOT NULL,
  tipo_perda        TEXT          NOT NULL, -- 'quebra', 'avaria', 'extravio', 'furto'
  quantidade        NUMERIC(10,3) NOT NULL CHECK (quantidade > 0),
  custo_unitario    NUMERIC(10,2) NOT NULL CHECK (custo_unitario >= 0),
  impacto_financeiro NUMERIC(10,2) NOT NULL CHECK (impacto_financeiro >= 0),
  justificativa     TEXT          NOT NULL,
  data_perda        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  FOREIGN KEY (usuario_id) REFERENCES "Usuario"(id)
);

-- ------------------------------------------------
-- Tabela: Configuracoes (Split padrão e tolerâncias)
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS "Configuracoes" (
  id               BIGINT        NOT NULL,
  gerente_id       BIGINT        NOT NULL,
  percentual_cmv   NUMERIC(5,2)  NOT NULL CHECK (percentual_cmv >= 0 AND percentual_cmv <= 100),
  percentual_opex  NUMERIC(5,2)  NOT NULL CHECK (percentual_opex >= 0 AND percentual_opex <= 100),
  percentual_lucro NUMERIC(5,2)  NOT NULL CHECK (percentual_lucro >= 0 AND percentual_lucro <= 100),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, gerente_id),
  CONSTRAINT chk_split_total CHECK (
    percentual_cmv + percentual_opex + percentual_lucro = 100
  )
);

-- ------------------------------------------------
-- Índices para integridade e performance
-- ------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_kardex_produto ON "MovimentacaoEstoque"(produto_id, data_movimentacao DESC);
CREATE INDEX IF NOT EXISTS idx_kardex_origem ON "MovimentacaoEstoque"(origem_tipo, origem_id);
CREATE INDEX IF NOT EXISTS idx_pagamento_venda ON "PagamentoVenda"(venda_id);
CREATE INDEX IF NOT EXISTS idx_itensvenda_venda ON "ItensVenda"(venda_id);
CREATE INDEX IF NOT EXISTS idx_venda_status_data ON "Venda"(status, data_venda DESC);
CREATE INDEX IF NOT EXISTS idx_perda_data ON "PerdaEstoque"(data_perda DESC);
CREATE INDEX IF NOT EXISTS idx_entrada_fornecedor ON "EntradaMercadoria"(fornecedor_id, data_recebimento DESC);
