-- =============================================
-- POLICIES SUPABASE — acesso da anon key (app mobile)
-- Projeto: sistema-custo-real
-- =============================================
--
-- CONTEXTO: o app usa a chave publishable (anon) embutida no app.json e os
-- logins/cadastros acontecem de forma compartilhada. Para as inserções e
-- sincronizações funcionarem corretamente offline-first, a role `anon` precisa
-- ter acesso completo às tabelas de dados.
--
-- COMO USAR: rode este arquivo UMA VEZ no SQL Editor do Supabase para aplicar as políticas de segurança.
-- =============================================

-- Garante a RLS habilitada (idempotente)
ALTER TABLE "Produto"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Venda"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ItensVenda"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Configuracoes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Usuario"       ENABLE ROW LEVEL SECURITY;

-- Remove as policies antigas para reaplicar limpo
DROP POLICY IF EXISTS "allow_all_service_role" ON "Produto";
DROP POLICY IF EXISTS "allow_all_service_role" ON "Venda";
DROP POLICY IF EXISTS "allow_all_service_role" ON "ItensVenda";
DROP POLICY IF EXISTS "allow_all_service_role" ON "Configuracoes";
DROP POLICY IF EXISTS "allow_all_service_role" ON "Usuario";

DROP POLICY IF EXISTS "anon_all" ON "Produto";
DROP POLICY IF EXISTS "anon_all" ON "Venda";
DROP POLICY IF EXISTS "anon_all" ON "ItensVenda";
DROP POLICY IF EXISTS "anon_all" ON "Configuracoes";
DROP POLICY IF EXISTS "anon_all" ON "Usuario";
DROP POLICY IF EXISTS "anon_read" ON "Usuario";

-- Tabelas de dados: acesso total para a anon key (push/pull do app)
CREATE POLICY "anon_all" ON "Produto"       FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON "Venda"         FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON "ItensVenda"    FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON "Configuracoes" FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON "Usuario"       FOR ALL TO anon USING (true) WITH CHECK (true);
