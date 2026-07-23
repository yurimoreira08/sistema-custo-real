-- =============================================
-- POLICIES SUPABASE — acesso da anon key (app mobile)
-- Projeto: sistema-custo-real
-- =============================================
--
-- CONTEXTO: o app usa a chave publishable (anon) embutida no app.json e NÃO
-- possui autenticação por usuário (o login é local: admin/123456). Para o push
-- offline-first funcionar, o papel `anon` precisa poder escrever nas tabelas de
-- dados. Sem as policies abaixo, toda escrita é rejeitada pela RLS
-- ("new row violates row-level security policy") e a fila de sync nunca esvazia.
--
-- >>> PRODUÇÃO: substituir por policies baseadas em auth.uid() quando houver
-- >>> login real. Anon com escrita total significa que qualquer um que extraia
-- >>> a chave do app pode ler/gravar no banco.
--
-- COMO USAR: rode este arquivo UMA VEZ no SQL Editor do Supabase.
-- =============================================

-- Garante a RLS habilitada (idempotente)
ALTER TABLE "Produto"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Venda"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ItensVenda"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Configuracoes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Usuario"       ENABLE ROW LEVEL SECURITY;

-- Remove as policies antigas (não cobrem a anon na prática) para reaplicar limpo
DROP POLICY IF EXISTS "allow_all_service_role" ON "Produto";
DROP POLICY IF EXISTS "allow_all_service_role" ON "Venda";
DROP POLICY IF EXISTS "allow_all_service_role" ON "ItensVenda";
DROP POLICY IF EXISTS "allow_all_service_role" ON "Configuracoes";
DROP POLICY IF EXISTS "allow_all_service_role" ON "Usuario";

-- Tabelas de dados: acesso total para a anon key (push do app)
DROP POLICY IF EXISTS "anon_all" ON "Produto";
CREATE POLICY "anon_all" ON "Produto"       FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_all" ON "Venda";
CREATE POLICY "anon_all" ON "Venda"         FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_all" ON "ItensVenda";
CREATE POLICY "anon_all" ON "ItensVenda"    FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_all" ON "Configuracoes";
CREATE POLICY "anon_all" ON "Configuracoes" FOR ALL TO anon USING (true) WITH CHECK (true);

-- Usuario: somente leitura para a anon (o app não escreve usuários pela nuvem)
DROP POLICY IF EXISTS "anon_read" ON "Usuario";
CREATE POLICY "anon_read" ON "Usuario"      FOR SELECT TO anon USING (true);
