-- =============================================
-- SCHEMA SUPABASE (PostgreSQL)
-- Projeto: sistema-custo-real
-- Gerado a partir do SQLite: mercado_manager.db
-- =============================================

-- ------------------------------------------------
-- Extensões úteis
-- ------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------
-- Tabela: Usuario
-- Armazena usuários do sistema (login local)
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS "Usuario" (
  id         BIGSERIAL    PRIMARY KEY,
  nome       TEXT         NOT NULL,
  email      TEXT         NOT NULL UNIQUE,
  senha      TEXT         NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  "Usuario"           IS 'Usuários do sistema (autenticação local)';
COMMENT ON COLUMN "Usuario".email     IS 'Pode ser e-mail ou username; deve ser único';
COMMENT ON COLUMN "Usuario".senha     IS 'Hash da senha (manter seguro no backend)';

-- ------------------------------------------------
-- Tabela: Produto
-- Catálogo de produtos do mercado
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS "Produto" (
  id              BIGSERIAL     PRIMARY KEY,
  nome            TEXT          NOT NULL,
  marca           TEXT,
  codigo_barras   TEXT,
  categoria       TEXT,
  preco_custo     NUMERIC(10,2) NOT NULL CHECK (preco_custo >= 0),
  preco_venda     NUMERIC(10,2) NOT NULL CHECK (preco_venda >= 0),
  estoque         INTEGER       NOT NULL DEFAULT 0 CHECK (estoque >= 0),
  estoque_minimo  INTEGER       NOT NULL DEFAULT 0 CHECK (estoque_minimo >= 0),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  "Produto"                  IS 'Catálogo de produtos do mercado';
COMMENT ON COLUMN "Produto".preco_custo      IS 'Preço de custo (CMV unitário)';
COMMENT ON COLUMN "Produto".preco_venda      IS 'Preço de venda ao cliente';
COMMENT ON COLUMN "Produto".estoque          IS 'Quantidade atual em estoque';
COMMENT ON COLUMN "Produto".estoque_minimo   IS 'Limite mínimo para alerta de estoque baixo';

-- Trigger para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_produto_updated_at
  BEFORE UPDATE ON "Produto"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------
-- Tabela: Venda
-- Cabeçalho de cada transação de venda
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS "Venda" (
  id          BIGSERIAL     PRIMARY KEY,
  data_venda  TIMESTAMPTZ   NOT NULL,
  valor_total NUMERIC(10,2) NOT NULL CHECK (valor_total >= 0),
  valor_cmv   NUMERIC(10,2) NOT NULL CHECK (valor_cmv >= 0),
  valor_opex  NUMERIC(10,2) NOT NULL CHECK (valor_opex >= 0),
  valor_lucro NUMERIC(10,2) NOT NULL,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  "Venda"            IS 'Cabeçalho de cada venda registrada';
COMMENT ON COLUMN "Venda".data_venda IS 'Data/hora da venda (ISO 8601, vinda do SQLite)';
COMMENT ON COLUMN "Venda".valor_cmv  IS 'Custo das Mercadorias Vendidas (split %)';
COMMENT ON COLUMN "Venda".valor_opex IS 'Despesas Operacionais (split %)';
COMMENT ON COLUMN "Venda".valor_lucro IS 'Lucro líquido após CMV e OpEx';

-- ------------------------------------------------
-- Tabela: ItensVenda
-- Itens individuais de cada venda
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS "ItensVenda" (
  id                    BIGSERIAL     PRIMARY KEY,
  venda_id              BIGINT        NOT NULL
                          REFERENCES "Venda"(id) ON DELETE CASCADE,
  produto_id            BIGINT        NOT NULL
                          REFERENCES "Produto"(id) ON DELETE RESTRICT,
  quantidade            INTEGER       NOT NULL CHECK (quantidade > 0),
  preco_unitario        NUMERIC(10,2) NOT NULL CHECK (preco_unitario >= 0),
  preco_custo_unitario  NUMERIC(10,2) NOT NULL CHECK (preco_custo_unitario >= 0)
);

COMMENT ON TABLE  "ItensVenda"                       IS 'Itens individuais de cada venda';
COMMENT ON COLUMN "ItensVenda".preco_unitario        IS 'Preço de venda no momento da transação (snapshot)';
COMMENT ON COLUMN "ItensVenda".preco_custo_unitario  IS 'Preço de custo no momento da transação (snapshot)';

-- ------------------------------------------------
-- Tabela: Configuracoes
-- Percentuais globais de split financeiro
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS "Configuracoes" (
  id               BIGSERIAL     PRIMARY KEY,
  percentual_cmv   NUMERIC(5,2)  NOT NULL CHECK (percentual_cmv >= 0 AND percentual_cmv <= 100),
  percentual_opex  NUMERIC(5,2)  NOT NULL CHECK (percentual_opex >= 0 AND percentual_opex <= 100),
  percentual_lucro NUMERIC(5,2)  NOT NULL CHECK (percentual_lucro >= 0 AND percentual_lucro <= 100),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_split_total CHECK (
    percentual_cmv + percentual_opex + percentual_lucro = 100
  )
);

COMMENT ON TABLE  "Configuracoes"                IS 'Configuração global dos percentuais de split financeiro';
COMMENT ON COLUMN "Configuracoes".percentual_cmv  IS 'Percentual do CMV sobre o faturamento (ex: 60.00)';
COMMENT ON COLUMN "Configuracoes".percentual_opex IS 'Percentual do OpEx sobre o faturamento (ex: 20.00)';

CREATE OR REPLACE TRIGGER trg_configuracoes_updated_at
  BEFORE UPDATE ON "Configuracoes"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------
-- Índices para otimização de consultas
-- ------------------------------------------------

-- Vendas por data (dashboard/relatórios usam filtros de período)
CREATE INDEX IF NOT EXISTS idx_venda_data_venda
  ON "Venda"(data_venda DESC);

-- Itens de uma venda (JOIN frequente Venda ↔ ItensVenda)
CREATE INDEX IF NOT EXISTS idx_itensvenda_venda_id
  ON "ItensVenda"(venda_id);

-- Itens por produto (JOIN frequente ItensVenda ↔ Produto)
CREATE INDEX IF NOT EXISTS idx_itensvenda_produto_id
  ON "ItensVenda"(produto_id);

-- Busca de produtos por categoria
CREATE INDEX IF NOT EXISTS idx_produto_categoria
  ON "Produto"(categoria);

-- Busca de produtos por nome (listagem ordenada)
CREATE INDEX IF NOT EXISTS idx_produto_nome
  ON "Produto"(nome);

-- Busca de produtos com estoque baixo (dashboard)
CREATE INDEX IF NOT EXISTS idx_produto_estoque
  ON "Produto"(estoque, estoque_minimo);

-- ------------------------------------------------
-- Row Level Security (RLS)
-- Habilitar em todas as tabelas para segurança
-- ------------------------------------------------
ALTER TABLE "Usuario"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Produto"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Venda"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ItensVenda"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Configuracoes" ENABLE ROW LEVEL SECURITY;

-- Políticas abertas para anon/service_role (ajuste conforme autenticação)
-- Por ora, permite acesso total via service_role (usado pelo app mobile)
CREATE POLICY "allow_all_service_role" ON "Usuario"
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "allow_all_service_role" ON "Produto"
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "allow_all_service_role" ON "Venda"
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "allow_all_service_role" ON "ItensVenda"
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "allow_all_service_role" ON "Configuracoes"
  FOR ALL USING (true) WITH CHECK (true);

-- ------------------------------------------------
-- Dados iniciais (seed equivalente ao SQLite)
-- ------------------------------------------------
INSERT INTO "Usuario" (nome, email, senha)
VALUES ('Administrador', 'admin', '123456')
ON CONFLICT (email) DO NOTHING;

INSERT INTO "Configuracoes" (percentual_cmv, percentual_opex, percentual_lucro)
SELECT 60.00, 20.00, 20.00
WHERE NOT EXISTS (SELECT 1 FROM "Configuracoes" LIMIT 1);
