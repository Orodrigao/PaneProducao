-- Conversões de compra: remoção da função antiga (02/10/2026).
--
-- Fase 2 da mudança destrutiva em duas fases (docs/regras/BANCO.md). Na fase 1
-- (PR 483, migration 20261001221113_conversoes_compra_regra_vinculos.sql) a
-- tela Produtos passou a mostrar as conversões de compra só para leitura e
-- deixou de chamar public.update_payable_product_mappings; a correção das
-- memórias do fornecedor ficou só em Catálogo > Vínculos NF-e, pela função
-- public.correct_payable_product_mapping, com versão, fila por fornecedor e
-- histórico. Com o site da fase 1 no ar, a função antiga não tem mais quem a
-- chame e sai do banco: nenhuma outra função, view, policy ou gatilho depende
-- dela (conferido em produção, somente leitura, em 02/10/2026).
--
-- Nenhum dado muda: as memórias em public.payable_product_mappings ficam como
-- estão.

begin;

drop function if exists public.update_payable_product_mappings(uuid, jsonb);

commit;
