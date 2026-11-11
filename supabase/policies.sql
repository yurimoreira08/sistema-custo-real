-- =============================================
-- POLICIES SUPABASE (Row Level Security) - LucroCerto v2.0
-- =============================================

ALTER TABLE "Usuario"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Fornecedor"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Cliente"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Produto"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FormaPagamentoConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Venda"                ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ItensVenda"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PagamentoVenda"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CancelamentoVenda"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DevolucaoVenda"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ItensDevolucao"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EntradaMercadoria"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ItensEntrada"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MovimentacaoEstoque"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PerdaEstoque"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Configuracoes"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TurnoCaixa"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MovimentacaoCaixa"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PagamentoDebitoCliente" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LoteEstoque"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BaixaLote"             ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'Usuario', 'Fornecedor', 'Cliente', 'Produto', 'FormaPagamentoConfig',
    'Venda', 'ItensVenda', 'PagamentoVenda', 'CancelamentoVenda',
    'DevolucaoVenda', 'ItensDevolucao', 'EntradaMercadoria', 'ItensEntrada',
    'MovimentacaoEstoque', 'PerdaEstoque', 'Configuracoes',
    'TurnoCaixa', 'MovimentacaoCaixa', 'PagamentoDebitoCliente', 'LoteEstoque', 'BaixaLote'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS "allow_all_service_role" ON %I;', t);
    EXECUTE format('CREATE POLICY "allow_all_service_role" ON %I FOR ALL USING (true) WITH CHECK (true);', t);
  END LOOP;
END $$;
