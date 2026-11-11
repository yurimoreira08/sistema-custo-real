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
  email          TEXT,
  limite_fiado   NUMERIC(10,2) NOT NULL DEFAULT 0.00 CHECK (limite_fiado >= 0),
  saldo_devedor  NUMERIC(10,2) NOT NULL DEFAULT 0.00, -- negativo = crédito a favor do cliente
  bloqueado_inadimplente INTEGER NOT NULL DEFAULT 0,
  motivo_bloqueio TEXT,
  ativo          BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT "Cliente_id_gerente_key" UNIQUE (id, gerente_id) -- alvo do upsert do app (onConflict id,gerente_id)
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

-- =============================================
-- SEMANA S06 e S07: Financeiro, Caixa, Fiado e Validade
-- Integrantes: Francisco Yuri, Yuri Moreira, Zé Neto
-- =============================================

-- ------------------------------------------------
-- Tabela: TurnoCaixa (Francisco Yuri - S06/S07)
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS "TurnoCaixa" (
  id                         BIGSERIAL     PRIMARY KEY,
  gerente_id                 BIGINT        NOT NULL,
  operador_id                BIGINT        NOT NULL,
  status                     TEXT          NOT NULL DEFAULT 'aberto' CHECK(status IN ('aberto', 'bloqueado', 'fechado')),
  fundo_troco_inicial        NUMERIC(10,2) NOT NULL DEFAULT 0.00 CHECK (fundo_troco_inicial >= 0),
  total_vendas_dinheiro      NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  total_vendas_outros        NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  total_suprimentos          NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  total_sangrias             NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  total_recebimentos_fiado   NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  saldo_esperado_dinheiro    NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  saldo_fechamento_informado NUMERIC(10,2),
  diferenca_fechamento       NUMERIC(10,2),
  motivo_bloqueio            TEXT,
  observacoes                TEXT,
  data_abertura              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  data_bloqueio              TIMESTAMPTZ,
  data_fechamento            TIMESTAMPTZ,
  FOREIGN KEY (operador_id) REFERENCES "Usuario"(id)
);

-- ------------------------------------------------
-- Tabela: MovimentacaoCaixa (Francisco Yuri - S06/S07 Comprovantes Digitais)
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS "MovimentacaoCaixa" (
  id                 BIGSERIAL     PRIMARY KEY,
  turno_caixa_id     BIGINT        NOT NULL,
  gerente_id         BIGINT        NOT NULL,
  operador_id        BIGINT        NOT NULL,
  tipo_operacao      TEXT          NOT NULL CHECK(tipo_operacao IN ('ABERTURA', 'VENDA', 'SANGRIA', 'SUPRIMENTO', 'BLOQUEIO', 'DESBLOQUEIO', 'FECHAMENTO', 'ESTORNO', 'RECEBIMENTO_FIADO')),
  forma_pagamento    TEXT          DEFAULT 'dinheiro',
  valor              NUMERIC(10,2) NOT NULL,
  saldo_apos         NUMERIC(10,2) NOT NULL,
  origem_referencia  TEXT,
  justificativa      TEXT,
  comprovante_hash   TEXT,
  assinatura_digital TEXT,
  data_movimentacao  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  FOREIGN KEY (turno_caixa_id) REFERENCES "TurnoCaixa"(id) ON DELETE CASCADE,
  FOREIGN KEY (operador_id) REFERENCES "Usuario"(id)
);

-- ------------------------------------------------
-- Tabela: PagamentoDebitoCliente (Yuri Mauriz - S07 Caderneta & Amortização Fiado)
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS "PagamentoDebitoCliente" (
  id               BIGSERIAL     PRIMARY KEY,
  gerente_id       BIGINT        NOT NULL,
  cliente_id       BIGINT        NOT NULL,
  operador_id      BIGINT        NOT NULL,
  valor            NUMERIC(10,2) NOT NULL CHECK (valor > 0),
  forma_pagamento  TEXT          NOT NULL DEFAULT 'dinheiro',
  observacoes      TEXT,
  saldo_anterior   NUMERIC(10,2) NOT NULL,
  saldo_resultante NUMERIC(10,2) NOT NULL,
  data_pagamento   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  FOREIGN KEY (cliente_id) REFERENCES "Cliente"(id),
  FOREIGN KEY (operador_id) REFERENCES "Usuario"(id)
);

-- ------------------------------------------------
-- Tabela: LoteEstoque (Zé Neto - S06/S07 Controle de Validade)
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS "LoteEstoque" (
  id                 BIGSERIAL     PRIMARY KEY,
  gerente_id         BIGINT        NOT NULL,
  produto_id         BIGINT        NOT NULL,
  entrada_id         BIGINT,
  item_entrada_id    BIGINT,
  numero_lote        TEXT          NOT NULL,
  data_entrada       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  data_validade      DATE,
  quantidade_inicial NUMERIC(10,3) NOT NULL CHECK (quantidade_inicial >= 0),
  quantidade_saldo   NUMERIC(10,3) NOT NULL CHECK (quantidade_saldo >= 0),
  custo_unitario     NUMERIC(10,2) NOT NULL CHECK (custo_unitario >= 0),
  status             TEXT          NOT NULL DEFAULT 'ativo' CHECK(status IN ('ativo', 'esgotado', 'vencido')),
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------
-- Tabela: BaixaLote (Zé Neto - S06/S07 Rastreabilidade PEPS)
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS "BaixaLote" (
  id                    BIGSERIAL     PRIMARY KEY,
  gerente_id            BIGINT        NOT NULL,
  lote_id               BIGINT        NOT NULL,
  produto_id            BIGINT        NOT NULL,
  origem_tipo           TEXT          NOT NULL,
  origem_id             BIGINT,
  item_venda_id         BIGINT,
  quantidade            NUMERIC(10,3) NOT NULL CHECK (quantidade > 0),
  quantidade_restaurada NUMERIC(10,3) NOT NULL DEFAULT 0.0 CHECK (quantidade_restaurada >= 0),
  data_baixa            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  FOREIGN KEY (lote_id) REFERENCES "LoteEstoque"(id)
);

-- ------------------------------------------------
-- View: vw_triagem_validade_lotes (Zé Neto - S07 Faixas de Risco & Capital Parado)
-- ------------------------------------------------
CREATE OR REPLACE VIEW vw_triagem_validade_lotes AS
SELECT 
  le.id,
  le.gerente_id,
  le.produto_id,
  p.nome AS produto_nome,
  p.categoria AS produto_categoria,
  le.numero_lote,
  le.data_entrada,
  le.data_validade,
  le.quantidade_saldo,
  le.custo_unitario,
  ROUND(le.quantidade_saldo * le.custo_unitario, 2) AS capital_parado,
  CASE 
    WHEN le.data_validade < CURRENT_DATE THEN 'VENCIDO'
    WHEN le.data_validade <= CURRENT_DATE + INTERVAL '7 days' THEN 'RISCO_CRITICO'
    WHEN le.data_validade <= CURRENT_DATE + INTERVAL '15 days' THEN 'RISCO_MEDIO'
    WHEN le.data_validade <= CURRENT_DATE + INTERVAL '30 days' THEN 'ALERTA'
    ELSE 'SEGURO'
  END AS faixa_risco
FROM "LoteEstoque" le
JOIN "Produto" p ON p.id = le.produto_id AND p.gerente_id = le.gerente_id
WHERE le.quantidade_saldo > 0 AND le.status = 'ativo' AND le.data_validade IS NOT NULL;

-- ------------------------------------------------
-- Índices para Turnos, Movimentações e Lotes
-- ------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_turno_caixa_operador ON "TurnoCaixa"(operador_id, status);
CREATE INDEX IF NOT EXISTS idx_mov_caixa_turno ON "MovimentacaoCaixa"(turno_caixa_id, data_movimentacao DESC);
CREATE INDEX IF NOT EXISTS idx_mov_caixa_comprovante ON "MovimentacaoCaixa"(comprovante_hash);
CREATE INDEX IF NOT EXISTS idx_pag_debito_cliente ON "PagamentoDebitoCliente"(cliente_id, data_pagamento DESC);
CREATE INDEX IF NOT EXISTS idx_lote_produto_validade ON "LoteEstoque"(produto_id, data_validade ASC);
CREATE INDEX IF NOT EXISTS idx_lote_status_saldo ON "LoteEstoque"(status, quantidade_saldo);
CREATE INDEX IF NOT EXISTS idx_baixa_lote_rastreio ON "BaixaLote"(origem_tipo, origem_id);

-- ------------------------------------------------
-- Migrações para bancos já existentes (idempotentes)
-- ------------------------------------------------
-- Crédito a favor do cliente: estorno de venda fiado já paga deixa saldo negativo
ALTER TABLE "Cliente" DROP CONSTRAINT IF EXISTS "Cliente_saldo_devedor_check";
-- Recebimento de fiado em dinheiro entra na gaveta do caixa
ALTER TABLE "TurnoCaixa" ADD COLUMN IF NOT EXISTS total_recebimentos_fiado NUMERIC(10,2) NOT NULL DEFAULT 0.00;
ALTER TABLE "MovimentacaoCaixa" DROP CONSTRAINT IF EXISTS "MovimentacaoCaixa_tipo_operacao_check";
ALTER TABLE "MovimentacaoCaixa" ADD CONSTRAINT "MovimentacaoCaixa_tipo_operacao_check"
  CHECK (tipo_operacao IN ('ABERTURA', 'VENDA', 'SANGRIA', 'SUPRIMENTO', 'BLOQUEIO', 'DESBLOQUEIO', 'FECHAMENTO', 'ESTORNO', 'RECEBIMENTO_FIADO'));
-- Sincronização de Cliente (S06): colunas que o app envia
ALTER TABLE "Cliente" ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE "Cliente" ADD COLUMN IF NOT EXISTS bloqueado_inadimplente INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Cliente" ADD COLUMN IF NOT EXISTS motivo_bloqueio TEXT;
ALTER TABLE "Cliente" ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- O app faz upsert com onConflict "id,gerente_id": a tabela precisa de uma restrição única nessas colunas
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Cliente', 'Fornecedor', 'TurnoCaixa'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t || '_id_gerente_key') THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I UNIQUE (id, gerente_id);', t, t || '_id_gerente_key');
    END IF;
  END LOOP;
END $$;
