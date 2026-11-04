begin;
create extension if not exists pgtap with schema extensions;
select plan(101);

-- Revenda sem cadastro, fase 3: corrigir nota gravada entre uso ou despesa,
-- revenda sem cadastro e produto, pela correção de notas
-- (public.correct_payable_purchase_items). Cobre cada troca nos dois sentidos
-- com prévia e gravação, a memória do fornecedor (troca de tipo, desligar,
-- regra de conflito e desfazer), o desfazer de correção antiga sem o tipo, o
-- replay do mesmo pedido (inclusive o gravado antes desta fase), o PT409, o
-- custo do produto de origem, conta, parcelas e livro-caixa iguais, e quem
-- pode: Financeiro autorizado e Administrador corrigem; Vendas JA e
-- Expedição JC são barrados.

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values
  ('97900000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-fase3@example.com', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('97900000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'financeiro-fase3@example.com', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('97900000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'vendas-ja-fase3@example.com', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('97900000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'expedicao-jc-fase3@example.com', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false);

insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes) values
  ('97900000-0000-4000-8000-000000000001', 'Administrador Fase 3', 'admin', null, true, '["/produtos"]'::jsonb),
  ('97900000-0000-4000-8000-000000000002', 'Financeiro Fase 3', 'financeiro', 'jc', true, '["/produtos", "/contas-pagar"]'::jsonb),
  ('97900000-0000-4000-8000-000000000003', 'Vendas JA Fase 3', 'vendas', 'ja', true, '["/", "/produtos"]'::jsonb),
  ('97900000-0000-4000-8000-000000000004', 'Expedicao JC Fase 3', 'expedicao', 'jc', true, '["/estoque", "/produtos"]'::jsonb);

insert into public.app_user_permissions (user_id, permission_key, scope) values
  ('97900000-0000-4000-8000-000000000002', 'contas_pagar.acessar', 'jc'),
  ('97900000-0000-4000-8000-000000000003', 'contas_pagar.acessar', 'ja'),
  ('97900000-0000-4000-8000-000000000004', 'estoque.contar_semanal', 'jc');

insert into public.suppliers (id, name, active) values
  ('97900000-0000-4000-8000-000000000011', '[TESTE] Fornecedor fase 3', true);

insert into public.products (id, name, category, active, unit, kind, cost_price, is_fabricacao_propria) values
  ('97900000-0000-4000-8000-000000000021', '[TESTE] Whey fase 3', 'Revenda', true, 'un', 'final', 40.00, false),
  ('97900000-0000-4000-8000-000000000022', '[TESTE] Creatina fase 3', 'Revenda', true, 'un', 'final', 30.00, false),
  ('97900000-0000-4000-8000-000000000023', '[TESTE] Barra fase 3', 'Revenda', true, 'un', 'final', 12.00, false);

insert into public.payable_purchases (
  id, request_id, store, supplier_id, purchase_date, origin, document_type,
  payment_method, status, total_value, nfe_number, nfe_issued_at, classification_status, created_by
) values
  -- Conta PAGA com o whey lançado como uso ou despesa, numa categoria de despesa.
  ('97900000-0000-4000-8000-000000000040', '97900000-0000-4000-8000-000000000140', 'jc', '97900000-0000-4000-8000-000000000011', '2024-04-10', 'xml', 'nfe', 'boleto', 'paga', 200, '979040', '2024-04-10', 'completa', '97900000-0000-4000-8000-000000000001'),
  -- Creatina já como revenda sem cadastro, em CMV de revenda.
  ('97900000-0000-4000-8000-000000000041', '97900000-0000-4000-8000-000000000141', 'jc', '97900000-0000-4000-8000-000000000011', '2024-04-11', 'xml', 'nfe', 'boleto', 'aberta', 50, '979041', '2024-04-11', 'completa', '97900000-0000-4000-8000-000000000001'),
  -- Creatina com cadastro: nota antiga (25) e nota nova (30, dá o custo).
  ('97900000-0000-4000-8000-000000000042', '97900000-0000-4000-8000-000000000142', 'jc', '97900000-0000-4000-8000-000000000011', '2024-04-09', 'xml', 'nfe', 'boleto', 'aberta', 25, '979042', '2024-04-09', 'completa', '97900000-0000-4000-8000-000000000001'),
  ('97900000-0000-4000-8000-000000000043', '97900000-0000-4000-8000-000000000143', 'jc', '97900000-0000-4000-8000-000000000011', '2024-04-12', 'xml', 'nfe', 'boleto', 'aberta', 30, '979043', '2024-04-12', 'completa', '97900000-0000-4000-8000-000000000001'),
  -- Barra com cadastro: única nota do produto.
  ('97900000-0000-4000-8000-000000000044', '97900000-0000-4000-8000-000000000144', 'jc', '97900000-0000-4000-8000-000000000011', '2024-04-12', 'xml', 'nfe', 'boleto', 'aberta', 12, '979044', '2024-04-12', 'completa', '97900000-0000-4000-8000-000000000001'),
  -- Itens de uso ou despesa para conflito, destinos diferentes e memória mudada depois.
  ('97900000-0000-4000-8000-000000000045', '97900000-0000-4000-8000-000000000145', 'jc', '97900000-0000-4000-8000-000000000011', '2024-04-12', 'xml', 'nfe', 'boleto', 'aberta', 30, '979045', '2024-04-12', 'completa', '97900000-0000-4000-8000-000000000001'),
  -- Itens das correções antigas (sem o tipo).
  ('97900000-0000-4000-8000-000000000046', '97900000-0000-4000-8000-000000000146', 'jc', '97900000-0000-4000-8000-000000000011', '2024-04-08', 'xml', 'nfe', 'boleto', 'aberta', 20, '979046', '2024-04-08', 'completa', '97900000-0000-4000-8000-000000000001');

insert into public.payable_purchase_items (
  id, purchase_id, product_id, item_name, unit, quantity, unit_price, source_product_code,
  source_description, source_unit, source_quantity, conversion_basis, conversion_factor,
  usable_quantity, normalized_unit_cost, category_snapshot, mapping_status, non_catalog_kind,
  cost_applied, mapping_confirmed_by, mapping_confirmed_at
) values
  ('97900000-0000-4000-8000-000000000060', '97900000-0000-4000-8000-000000000040', null, 'WHEY PROTEIN 900G', 'UN', 2, 100, 'WHEY9', 'WHEY PROTEIN 900G', 'UN', 2, null, null, null, null, null, 'nao_aplicavel', 'uso_despesa', null, '97900000-0000-4000-8000-000000000001', now()),
  ('97900000-0000-4000-8000-000000000061', '97900000-0000-4000-8000-000000000041', null, 'CREATINA 300G', 'UN', 1, 50, 'CREA3', 'CREATINA 300G', 'UN', 1, null, null, null, null, null, 'nao_aplicavel', 'revenda', null, '97900000-0000-4000-8000-000000000001', now()),
  ('97900000-0000-4000-8000-000000000062', '97900000-0000-4000-8000-000000000042', '97900000-0000-4000-8000-000000000022', '[TESTE] Creatina fase 3', 'un', 1, 25, 'CREAP', 'CREATINA POTE', 'UN', 1, 'simple', 1, 1, 25, 'Revenda', 'mapeado', null, false, '97900000-0000-4000-8000-000000000001', now()),
  ('97900000-0000-4000-8000-000000000063', '97900000-0000-4000-8000-000000000043', '97900000-0000-4000-8000-000000000022', '[TESTE] Creatina fase 3', 'un', 1, 30, 'CREAP', 'CREATINA POTE', 'UN', 1, 'simple', 1, 1, 30, 'Revenda', 'mapeado', null, true, '97900000-0000-4000-8000-000000000001', now()),
  ('97900000-0000-4000-8000-000000000064', '97900000-0000-4000-8000-000000000044', '97900000-0000-4000-8000-000000000023', '[TESTE] Barra fase 3', 'un', 1, 12, 'BARRA', 'BARRA PROTEICA', 'UN', 1, 'simple', 1, 1, 12, 'Revenda', 'mapeado', null, true, '97900000-0000-4000-8000-000000000001', now()),
  -- Decidido em 12/04/2024; a memória dele mudou em 01/05/2024 (decisão mais nova).
  ('97900000-0000-4000-8000-000000000065', '97900000-0000-4000-8000-000000000045', null, 'PAPEL TOALHA', 'UN', 1, 10, 'PAPEL', 'PAPEL TOALHA', 'UN', 1, null, null, null, null, null, 'nao_aplicavel', 'uso_despesa', null, '97900000-0000-4000-8000-000000000001', '2024-04-12 10:00+00'),
  -- Mesmo código do whey: casa com a mesma memória.
  ('97900000-0000-4000-8000-000000000066', '97900000-0000-4000-8000-000000000045', null, 'WHEY PROTEIN 900G', 'UN', 1, 10, 'WHEY9', 'WHEY PROTEIN 900G', 'UN', 1, null, null, null, null, null, 'nao_aplicavel', 'uso_despesa', null, '97900000-0000-4000-8000-000000000001', now()),
  ('97900000-0000-4000-8000-000000000067', '97900000-0000-4000-8000-000000000045', null, 'AGUA MINERAL', 'UN', 1, 10, 'AGUA', 'AGUA MINERAL', 'UN', 1, null, null, null, null, null, 'nao_aplicavel', 'uso_despesa', null, '97900000-0000-4000-8000-000000000001', now()),
  ('97900000-0000-4000-8000-000000000068', '97900000-0000-4000-8000-000000000046', null, 'BARRA LEGADA', 'UN', 1, 10, 'BARL', 'BARRA LEGADA', 'UN', 1, null, null, null, null, null, 'nao_aplicavel', 'uso_despesa', null, '97900000-0000-4000-8000-000000000001', now()),
  ('97900000-0000-4000-8000-000000000069', '97900000-0000-4000-8000-000000000046', null, 'ITEM LEGADO', 'UN', 1, 10, 'LEG2', 'ITEM LEGADO', 'UN', 1, null, null, null, null, null, 'nao_aplicavel', 'uso_despesa', null, '97900000-0000-4000-8000-000000000001', now()),
  -- Para o desfazer recusado quando só o tipo mudou depois da correção.
  ('97900000-0000-4000-8000-00000000006a', '97900000-0000-4000-8000-000000000046', null, 'GUARDANAPO', 'UN', 1, 10, 'GUARD', 'GUARDANAPO', 'UN', 1, null, null, null, null, null, 'nao_aplicavel', 'uso_despesa', null, '97900000-0000-4000-8000-000000000001', now()),
  -- Sem a data da decisão (item antigo): a memória fica como está.
  ('97900000-0000-4000-8000-00000000006b', '97900000-0000-4000-8000-000000000046', null, 'LATA', 'UN', 1, 10, 'LATA', 'LATA', 'UN', 1, null, null, null, null, null, 'nao_aplicavel', 'uso_despesa', null, '97900000-0000-4000-8000-000000000001', null),
  -- Dois itens da mesma memória: um decidido antes da última mudança dela, outro depois.
  ('97900000-0000-4000-8000-00000000006c', '97900000-0000-4000-8000-000000000046', null, 'CHOCOLATE', 'UN', 1, 10, 'CHOCO', 'CHOCOLATE', 'UN', 1, null, null, null, null, null, 'nao_aplicavel', 'uso_despesa', null, '97900000-0000-4000-8000-000000000001', '2024-04-10 10:00+00'),
  ('97900000-0000-4000-8000-00000000006d', '97900000-0000-4000-8000-000000000045', null, 'CHOCOLATE', 'UN', 1, 10, 'CHOCO', 'CHOCOLATE', 'UN', 1, null, null, null, null, null, 'nao_aplicavel', 'uso_despesa', null, '97900000-0000-4000-8000-000000000001', now()),
  -- Memória reafirmada depois da correção, com carimbo anterior ao dela.
  ('97900000-0000-4000-8000-00000000006e', '97900000-0000-4000-8000-000000000046', null, 'SUCO', 'UN', 1, 10, 'SUCO', 'SUCO', 'UN', 1, null, null, null, null, null, 'nao_aplicavel', 'uso_despesa', null, '97900000-0000-4000-8000-000000000001', now()),
  -- Conflito vindo de uma memória de insumo desligada depois da nota.
  ('97900000-0000-4000-8000-00000000006f', '97900000-0000-4000-8000-000000000046', null, 'BISCOITO', 'UN', 1, 10, 'BISC', 'BISCOITO', 'UN', 1, null, null, null, null, null, 'nao_aplicavel', 'uso_despesa', null, '97900000-0000-4000-8000-000000000001', '2024-04-12 10:00+00'),
  -- Item com duas memórias (fora do cadastro ligada e de insumo desligada antiga).
  ('97900000-0000-4000-8000-000000000170', '97900000-0000-4000-8000-000000000046', null, 'MEL', 'UN', 1, 10, 'MEL', 'MEL', 'UN', 1, null, null, null, null, null, 'nao_aplicavel', 'uso_despesa', null, '97900000-0000-4000-8000-000000000001', now()),
  -- Item cuja memória deixa de casar depois da correção.
  ('97900000-0000-4000-8000-000000000171', '97900000-0000-4000-8000-000000000046', null, 'PAO DE QUEIJO', 'UN', 1, 10, 'PAOQ', 'PAO DE QUEIJO', 'UN', 1, null, null, null, null, null, 'nao_aplicavel', 'uso_despesa', null, '97900000-0000-4000-8000-000000000001', now()),
  -- Importado às 10:00:01; uma classificação concorrente que começou às 10:00:00
  -- e esperou a trava gravou a memória depois, com o now() dela (anterior).
  ('97900000-0000-4000-8000-000000000172', '97900000-0000-4000-8000-000000000046', null, 'QUEIJO MINAS', 'UN', 1, 10, 'QMIN', 'QUEIJO MINAS', 'UN', 1, null, null, null, null, null, 'nao_aplicavel', 'uso_despesa', null, '97900000-0000-4000-8000-000000000001', '2024-04-12 10:00:01+00'),
  -- Memória de um dia antes da nota: decisão de fato anterior.
  ('97900000-0000-4000-8000-000000000173', '97900000-0000-4000-8000-000000000046', null, 'FARELO', 'UN', 1, 10, 'FARE', 'FARELO', 'UN', 1, null, null, null, null, null, 'nao_aplicavel', 'uso_despesa', null, '97900000-0000-4000-8000-000000000001', '2024-04-12 10:00+00'),
  -- Duas correções do item no mesmo instante.
  ('97900000-0000-4000-8000-000000000174', '97900000-0000-4000-8000-000000000046', null, 'MASSA', 'UN', 1, 10, 'MASS', 'MASSA', 'UN', 1, null, null, null, null, null, 'nao_aplicavel', 'uso_despesa', null, '97900000-0000-4000-8000-000000000001', now()),
  -- Correção com outra do item no mesmo instante: o desfazer não arrisca.
  ('97900000-0000-4000-8000-000000000175', '97900000-0000-4000-8000-000000000046', null, 'FUBA', 'UN', 1, 10, 'FUBA', 'FUBA', 'UN', 1, null, null, null, null, null, 'nao_aplicavel', 'uso_despesa', null, '97900000-0000-4000-8000-000000000001', now()),
  -- Par correção e desfazer no mesmo instante, com identificadores em ordem desfavorável.
  ('97900000-0000-4000-8000-000000000176', '97900000-0000-4000-8000-000000000046', null, 'AVEIA', 'UN', 1, 10, 'AVEI', 'AVEIA', 'UN', 1, null, null, null, null, null, 'nao_aplicavel', 'uso_despesa', null, '97900000-0000-4000-8000-000000000001', now()),
  -- Limitação conhecida da janela: memória de insumo desligada por uma nota
  -- anterior, um minuto antes desta, deixa a ordem incerta.
  ('97900000-0000-4000-8000-000000000177', '97900000-0000-4000-8000-000000000046', null, 'CEVADA', 'UN', 1, 10, 'CEVA', 'CEVADA', 'UN', 1, null, null, null, null, null, 'nao_aplicavel', 'uso_despesa', null, '97900000-0000-4000-8000-000000000001', '2024-04-12 10:01+00');

-- Conta paga: parcela paga, rateio em despesa e lançamentos no livro gerados
-- pela função oficial da baixa. As outras contas: rateio em CMV de revenda.
insert into public.payable_installments (id, purchase_id, installment_number, due_date, amount, status, paid_date, paid_amount, paid_method)
values ('97900000-0000-4000-8000-000000000071', '97900000-0000-4000-8000-000000000040', 1, '2024-04-15', 200, 'paga', '2024-04-15', 200, 'boleto');
insert into public.payable_purchase_categories (purchase_id, category_id, amount)
select '97900000-0000-4000-8000-000000000040', category.id, 200
from public.finance_categories category where category.key = 'outras_despesas';
insert into public.payable_purchase_categories (purchase_id, category_id, amount)
select purchase.id, category.id, purchase.total_value
from public.payable_purchases purchase
cross join public.finance_categories category
where category.key = 'cmv_revenda'
  and purchase.id in ('97900000-0000-4000-8000-000000000041', '97900000-0000-4000-8000-000000000043', '97900000-0000-4000-8000-000000000044');
select private.sync_payable_finance_entries('97900000-0000-4000-8000-000000000071', '97900000-0000-4000-8000-000000000001', null);

-- Memórias de fora do cadastro, ligadas. A do papel mudou depois da nota.
insert into public.payable_non_catalog_mappings (
  id, supplier_id, supplier_product_code, supplier_ean, supplier_description, purchase_unit, active,
  non_catalog_kind, last_confirmed_by, updated_at
) values
  ('97900000-0000-4000-8000-000000000081', '97900000-0000-4000-8000-000000000011', 'WHEY9', null, 'WHEY PROTEIN 900G', 'UN', true, 'uso_despesa', '97900000-0000-4000-8000-000000000001', now()),
  ('97900000-0000-4000-8000-000000000082', '97900000-0000-4000-8000-000000000011', 'CREA3', null, 'CREATINA 300G', 'UN', true, 'revenda', '97900000-0000-4000-8000-000000000001', now()),
  ('97900000-0000-4000-8000-000000000083', '97900000-0000-4000-8000-000000000011', 'PAPEL', null, 'PAPEL TOALHA', 'UN', true, 'uso_despesa', '97900000-0000-4000-8000-000000000001', '2024-05-01 12:00+00'),
  ('97900000-0000-4000-8000-000000000085', '97900000-0000-4000-8000-000000000011', 'AGUA', null, 'AGUA MINERAL', 'UN', true, 'uso_despesa', '97900000-0000-4000-8000-000000000001', now()),
  ('97900000-0000-4000-8000-00000000008b', '97900000-0000-4000-8000-000000000011', 'LATA', null, 'LATA', 'UN', true, 'uso_despesa', '97900000-0000-4000-8000-000000000001', now()),
  ('97900000-0000-4000-8000-00000000008c', '97900000-0000-4000-8000-000000000011', 'CHOCO', null, 'CHOCOLATE', 'UN', true, 'uso_despesa', '97900000-0000-4000-8000-000000000001', '2024-04-20 12:00+00'),
  ('97900000-0000-4000-8000-00000000008e', '97900000-0000-4000-8000-000000000011', 'SUCO', null, 'SUCO', 'UN', true, 'uso_despesa', '97900000-0000-4000-8000-000000000001', now()),
  ('97900000-0000-4000-8000-00000000008f', '97900000-0000-4000-8000-000000000011', 'BISC', null, 'BISCOITO', 'UN', true, 'uso_despesa', '97900000-0000-4000-8000-000000000001', '2024-04-12 10:00+00'),
  ('97900000-0000-4000-8000-000000000180', '97900000-0000-4000-8000-000000000011', 'MEL', null, 'MEL', 'UN', true, 'uso_despesa', '97900000-0000-4000-8000-000000000001', now()),
  ('97900000-0000-4000-8000-000000000182', '97900000-0000-4000-8000-000000000011', 'PAOQ', null, 'PAO DE QUEIJO', 'UN', true, 'uso_despesa', '97900000-0000-4000-8000-000000000001', now()),
  ('97900000-0000-4000-8000-000000000183', '97900000-0000-4000-8000-000000000011', 'QMIN', null, 'QUEIJO MINAS', 'UN', true, 'revenda', '97900000-0000-4000-8000-000000000001', '2024-04-12 10:00:00+00'),
  ('97900000-0000-4000-8000-000000000184', '97900000-0000-4000-8000-000000000011', 'FARE', null, 'FARELO', 'UN', true, 'uso_despesa', '97900000-0000-4000-8000-000000000001', '2024-04-11 10:00+00'),
  ('97900000-0000-4000-8000-000000000185', '97900000-0000-4000-8000-000000000011', 'MASS', null, 'MASSA', 'UN', true, 'uso_despesa', '97900000-0000-4000-8000-000000000001', now()),
  ('97900000-0000-4000-8000-000000000186', '97900000-0000-4000-8000-000000000011', 'FUBA', null, 'FUBA', 'UN', true, 'uso_despesa', '97900000-0000-4000-8000-000000000001', now()),
  ('97900000-0000-4000-8000-000000000187', '97900000-0000-4000-8000-000000000011', 'AVEI', null, 'AVEIA', 'UN', true, 'uso_despesa', '97900000-0000-4000-8000-000000000001', now()),
  ('97900000-0000-4000-8000-000000000188', '97900000-0000-4000-8000-000000000011', 'CEVA', null, 'CEVADA', 'UN', true, 'uso_despesa', '97900000-0000-4000-8000-000000000001', '2024-04-12 10:01+00');
insert into public.payable_product_mappings (
  id, supplier_id, supplier_product_code, supplier_ean, supplier_description, purchase_unit,
  base_product_id, base_unit, conversion_basis, conversion_factor, factor_confirmed, active, last_confirmed_by, updated_at
) values (
  '97900000-0000-4000-8000-00000000008d', '97900000-0000-4000-8000-000000000011', 'BISC', null, 'BISCOITO', 'UN',
  '97900000-0000-4000-8000-000000000023', 'un', 'simple', 1, true, false, '97900000-0000-4000-8000-000000000001', '2024-05-02 12:00+00'
), (
  '97900000-0000-4000-8000-000000000181', '97900000-0000-4000-8000-000000000011', 'MEL', null, 'MEL', 'UN',
  '97900000-0000-4000-8000-000000000023', 'un', 'simple', 1, true, false, '97900000-0000-4000-8000-000000000001', '2024-01-01 12:00+00'
), (
  '97900000-0000-4000-8000-000000000189', '97900000-0000-4000-8000-000000000011', 'CEVA', null, 'CEVADA', 'UN',
  '97900000-0000-4000-8000-000000000023', 'un', 'simple', 1, true, false, '97900000-0000-4000-8000-000000000001', '2024-04-12 10:00+00'
);
create temporary table memoria_mel_antes on commit drop as
select mapping.updated_at from public.payable_non_catalog_mappings mapping
where mapping.id = '97900000-0000-4000-8000-000000000180';

-- Duas contagens fechadas: semana de 01/04/2024 (sábado 06/04) e de 08/04/2024
-- (sábado 13/04). As notas de 08 a 12/04 caem nesse período; o whey é contado.
insert into public.inventory_weekly_counts (id, store, week_start, status, opened_by, opened_by_name, closed_at, closed_by, closed_by_name) values
  ('97900000-0000-4000-8000-000000000091', 'jc', '2024-04-01', 'fechada', '97900000-0000-4000-8000-000000000004', 'Expedicao', '2024-04-06 15:00+00', '97900000-0000-4000-8000-000000000004', 'Expedicao'),
  ('97900000-0000-4000-8000-000000000092', 'jc', '2024-04-08', 'fechada', '97900000-0000-4000-8000-000000000004', 'Expedicao', '2024-04-13 15:00+00', '97900000-0000-4000-8000-000000000004', 'Expedicao');
insert into public.inventory_weekly_count_items (count_id, product_id, quantity, unit) values
  ('97900000-0000-4000-8000-000000000091', '97900000-0000-4000-8000-000000000021', 5, 'un'),
  ('97900000-0000-4000-8000-000000000092', '97900000-0000-4000-8000-000000000021', 3, 'un');

create temporary table contas_antes on commit drop as
select purchase.id, purchase.total_value, purchase.status, purchase.classification_status
from public.payable_purchases purchase
where purchase.id::text like '97900000-0000-4000-8000-00000000004%';
create temporary table parcelas_antes on commit drop as
select installment.id, installment.status, installment.amount, installment.paid_amount, installment.paid_date
from public.payable_installments installment
where installment.purchase_id::text like '97900000-0000-4000-8000-00000000004%';
create temporary table rateio_antes on commit drop as
select split.purchase_id, split.category_id, split.amount
from public.payable_purchase_categories split
where split.purchase_id::text like '97900000-0000-4000-8000-00000000004%';
create temporary table livro_antes on commit drop as
select entry.id, entry.category_id, entry.amount, entry.competence_month, entry.reversed_at
from public.finance_entries entry
where entry.source = 'contas_pagar' and entry.source_ref = '97900000-0000-4000-8000-000000000071';
create temporary table valores_antes on commit drop as
select item.id, item.quantity, item.unit_price, item.line_total, item.acquisition_value
from public.payable_purchase_items item
where item.purchase_id::text like '97900000-0000-4000-8000-00000000004%';
create temporary table memoria_creatina_antes on commit drop as
select mapping.updated_at from public.payable_non_catalog_mappings mapping
where mapping.id = '97900000-0000-4000-8000-000000000082';

-- Estrutura ------------------------------------------------------------------

select ok(not has_function_privilege('authenticated', 'private.memorias_casadas_item_nfe(uuid)', 'execute'),
  'as memórias do item (ligadas ou não) ficam fora da Data API');
select col_not_null('public', 'payable_purchase_item_corrections', 'item_ids',
  'toda correção de notas guarda os itens');
select ok(exists (select 1 from pg_indexes where indexname = 'payable_purchase_item_corrections_items_idx'),
  'o histórico é achado pelo item com índice');
select is(livro.count, 1, 'a conta paga começa com o pagamento no livro')
from (select count(*)::int as count from livro_antes where reversed_at is null) livro;

-- Gatilho: só a correção tira a revenda de fora do cadastro ----------------------

select throws_ok(
  $$update public.payable_purchase_items
    set mapping_status = 'mapeado', product_id = '97900000-0000-4000-8000-000000000021'
    where id = '97900000-0000-4000-8000-000000000061'$$,
  '22023', 'Revenda sem cadastro só muda pela correção de notas, em Catálogo > Vínculos NF-e.',
  'gravador de fora da correção não tira a revenda de fora do cadastro');
select throws_ok(
  $$update public.payable_purchase_items set non_catalog_kind = 'uso_despesa'
    where id = '97900000-0000-4000-8000-000000000061'$$,
  '22023', 'Revenda sem cadastro só muda pela correção de notas, em Catálogo > Vínculos NF-e.',
  'gravador de fora da correção não troca a revenda por uso ou despesa');
select is((select non_catalog_kind from public.payable_purchase_items where id = '97900000-0000-4000-8000-000000000061'),
  'revenda', 'a revenda continua revenda depois das recusas');

set local role authenticated;

-- Barrados -------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '97900000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select public.correct_payable_purchase_items(null, 'previa',
    '[{"item_id":"97900000-0000-4000-8000-000000000060","product_id":null,"conversion_factor":null,"non_catalog_kind":"revenda"}]')$$,
  '42501', 'Sem permissão para corrigir itens de NF-e.', 'Vendas JA é barrada');
select is((select count(*)::int from public.payable_purchase_item_corrections), 0, 'Vendas JA não lê o histórico');
select set_config('request.jwt.claim.sub', '97900000-0000-4000-8000-000000000004', true);
select throws_ok(
  $$select public.correct_payable_purchase_items(null, 'previa',
    '[{"item_id":"97900000-0000-4000-8000-000000000060","product_id":null,"conversion_factor":null,"non_catalog_kind":"revenda"}]')$$,
  '42501', 'Sem permissão para corrigir itens de NF-e.', 'Expedição JC é barrada');

-- Contrato do pedido ------------------------------------------------------------

select set_config('request.jwt.claim.sub', '97900000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.correct_payable_purchase_items(null, 'previa',
    '[{"item_id":"97900000-0000-4000-8000-000000000060","product_id":null,"conversion_factor":null,"non_catalog_kind":"brinde"}]')$$,
  '22023', 'Tipo do item fora do cadastro inválido.', 'tipo fora da lista é recusado');
select throws_ok(
  $$select public.correct_payable_purchase_items(null, 'previa',
    '[{"item_id":"97900000-0000-4000-8000-000000000060","product_id":null,"conversion_factor":null,"non_catalog_kind":1}]')$$,
  '22023', 'Tipo do item fora do cadastro inválido.', 'tipo que não é texto é recusado');
select throws_ok(
  $$select public.correct_payable_purchase_items(null, 'previa',
    '[{"item_id":"97900000-0000-4000-8000-000000000060","product_id":"97900000-0000-4000-8000-000000000021","conversion_factor":1,"non_catalog_kind":"revenda"}]')$$,
  '22023', 'Item ligado a produto não tem tipo de fora do cadastro: envie o tipo vazio.',
  'item que vai para produto não leva tipo');
select throws_ok(
  $$select public.correct_payable_purchase_items(null, 'previa',
    '[{"item_id":"97900000-0000-4000-8000-000000000066","product_id":null,"conversion_factor":null,"non_catalog_kind":"uso_despesa"}]')$$,
  '22023', 'A correção não muda nada em um dos itens.', 'uso ou despesa para uso ou despesa é recusado');
select throws_ok(
  $$select public.correct_payable_purchase_items(null, 'previa',
    '[{"item_id":"97900000-0000-4000-8000-000000000061","product_id":null,"conversion_factor":null,"non_catalog_kind":"revenda"}]')$$,
  '22023', 'A correção não muda nada em um dos itens.', 'revenda para revenda é recusada');
select throws_ok(
  $$select public.correct_payable_purchase_items(null, 'previa',
    '[{"item_id":"97900000-0000-4000-8000-000000000061","product_id":null,"conversion_factor":null}]')$$,
  '22023', 'Esta tela foi aberta antes da revenda sem cadastro e trataria a revenda como uso ou despesa. Recarregue a página e confira a nota de novo.',
  'pedido sem o tipo (site anterior) não troca revenda por uso ou despesa');
select throws_ok(
  $$select public.correct_payable_purchase_items(null, 'previa',
    '[{"item_id":"97900000-0000-4000-8000-000000000060","product_id":"97900000-0000-4000-8000-000000000021","conversion_factor":1,"non_catalog_kind":null},
      {"item_id":"97900000-0000-4000-8000-000000000066","product_id":null,"conversion_factor":null,"non_catalog_kind":"revenda"}]')$$,
  '22023', 'Itens que o fornecedor manda com o mesmo código estão com destinos diferentes no pedido: corrija um grupo de cada vez.',
  'itens da mesma memória com destinos diferentes são recusados');

-- Uso ou despesa -> revenda sem cadastro, prévia ----------------------------------

select set_config('teste.p1', public.correct_payable_purchase_items(null, 'previa',
  '[{"item_id":"97900000-0000-4000-8000-000000000060","product_id":null,"conversion_factor":null,"non_catalog_kind":"revenda"}]')::text, true);

select results_eq(
  $$select entry -> 'before' ->> 'mapping_status', entry -> 'before' ->> 'non_catalog_kind',
           entry -> 'after' ->> 'mapping_status', entry -> 'after' ->> 'non_catalog_kind', entry -> 'after' ->> 'product_id'
    from jsonb_array_elements(current_setting('teste.p1')::jsonb -> 'impact' -> 'items') entry$$,
  $$values ('nao_aplicavel', 'uso_despesa', 'nao_aplicavel', 'revenda', null::text)$$,
  'prévia: o whey fica fora do cadastro e passa de uso ou despesa a revenda sem cadastro');
select is(current_setting('teste.p1')::jsonb -> 'impact' -> 'products', '[]'::jsonb,
  'prévia: troca de tipo não tem produto nem custo de cadastro');
select results_eq(
  $$select entry ->> 'mapping_id', entry ->> 'action', entry -> 'before' ->> 'non_catalog_kind', entry -> 'after' ->> 'non_catalog_kind',
           (entry -> 'after' ->> 'active')::boolean
    from jsonb_array_elements(current_setting('teste.p1')::jsonb -> 'impact' -> 'memory_changes') entry$$,
  $$values ('97900000-0000-4000-8000-000000000081'::text, 'trocar_tipo'::text, 'uso_despesa'::text, 'revenda'::text, true)$$,
  'prévia: mostra a memória atingida, que passa a revenda');
select results_eq(
  $$select entry -> 'next_suggestion' ->> 'mapping_id', entry -> 'next_suggestion' ->> 'non_catalog_kind',
           entry -> 'memories_after' -> 0 ->> 'changed', entry -> 'memories_after' -> 0 -> 'version'
    from jsonb_array_elements(current_setting('teste.p1')::jsonb -> 'impact' -> 'items') entry$$,
  $$values ('97900000-0000-4000-8000-000000000081'::text, 'revenda'::text, 'true'::text, 'null'::jsonb)$$,
  'prévia: a próxima nota sugere revenda, e a versão da memória mexida fica fora do hash');
select results_eq(
  $$select (entry -> 'before' ->> 'not_stock')::numeric = (entry -> 'after' ->> 'not_stock')::numeric,
           (entry -> 'before' ->> 'resale')::numeric, (entry -> 'after' ->> 'resale')::numeric
    from jsonb_array_elements(current_setting('teste.p1')::jsonb -> 'impact' -> 'consumption' -> 'periods') entry
    where entry ->> 'period_end_count_id' = '97900000-0000-4000-8000-000000000092'$$,
  $$values (true, 50::numeric, 250::numeric)$$,
  'prévia: no consumo semanal o valor sai do uso ou despesa e entra na revenda sem cadastro, sem mudar o "não é estoque"');
select results_eq(
  $$select entry ->> 'status', (entry ->> 'installments_paid')::int, entry -> 'split' -> 0 ->> 'key'
    from jsonb_array_elements(current_setting('teste.p1')::jsonb -> 'impact' -> 'purchases') entry$$,
  $$values ('paga', 1, 'outras_despesas')$$,
  'prévia financeira: conta paga, rateio em despesa (a tela avisa que revenda costuma ir para CMV)');
select is((select non_catalog_kind from public.payable_purchase_items where id = '97900000-0000-4000-8000-000000000060'),
  'uso_despesa', 'prévia não grava o item');
select is((select non_catalog_kind from public.payable_non_catalog_mappings where id = '97900000-0000-4000-8000-000000000081'),
  'uso_despesa', 'prévia não grava a memória');
select is((select count(*)::int from public.payable_purchase_item_corrections), 0, 'prévia não grava histórico');

-- Memória mexida entre a prévia e a confirmação: PT409 ---------------------------

reset role;
update public.payable_non_catalog_mappings set updated_at = updated_at - interval '1 day'
where id = '97900000-0000-4000-8000-000000000081';
set local role authenticated;
select set_config('request.jwt.claim.sub', '97900000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.correct_payable_purchase_items('97900000-0000-4000-8000-0000000000a0', 'aplicar',
    '[{"item_id":"97900000-0000-4000-8000-000000000060","product_id":null,"conversion_factor":null,"non_catalog_kind":"revenda"}]',
    null, current_setting('teste.p1')::jsonb ->> 'impact_hash')$$,
  'PT409', null, 'memória alterada depois da prévia exige prévia nova');
select set_config('teste.p1', public.correct_payable_purchase_items(null, 'previa',
  '[{"item_id":"97900000-0000-4000-8000-000000000060","product_id":null,"conversion_factor":null,"non_catalog_kind":"revenda"}]')::text, true);

-- Uso ou despesa -> revenda sem cadastro, confirmação ------------------------------

select set_config('teste.a1', public.correct_payable_purchase_items('97900000-0000-4000-8000-0000000000a1', 'aplicar',
  '[{"item_id":"97900000-0000-4000-8000-000000000060","product_id":null,"conversion_factor":null,"non_catalog_kind":"revenda"}]',
  null, current_setting('teste.p1')::jsonb ->> 'impact_hash')::text, true);
select results_eq(
  $$select mapping_status, non_catalog_kind, product_id, item_name, unit, quantity, mapping_confirmed_by
    from public.payable_purchase_items where id = '97900000-0000-4000-8000-000000000060'$$,
  $$values ('nao_aplicavel'::text, 'revenda'::text, null::uuid, 'WHEY PROTEIN 900G'::text, 'UN'::text, 2::numeric,
            '97900000-0000-4000-8000-000000000002'::uuid)$$,
  'confirmação: o whey vira revenda sem cadastro, com o que a nota diz e o autor');
select results_eq(
  $$select mapping.active, mapping.non_catalog_kind, mapping.updated_at = correction.corrected_at
    from public.payable_non_catalog_mappings mapping
    cross join public.payable_purchase_item_corrections correction
    where mapping.id = '97900000-0000-4000-8000-000000000081' and correction.request_id = '97900000-0000-4000-8000-0000000000a1'$$,
  $$values (true, 'revenda'::text, true)$$,
  'confirmação: a memória passa a revenda, com o carimbo da correção');
select results_eq(
  $$select item_ids, product_ids from public.payable_purchase_item_corrections
    where request_id = '97900000-0000-4000-8000-0000000000a1'$$,
  $$values (array['97900000-0000-4000-8000-000000000060']::uuid[], '{}'::uuid[])$$,
  'confirmação: a troca de tipo é achada pelo item, sem produto');
select ok(exists (
    select 1 from public.payable_events event
    where event.purchase_id = '97900000-0000-4000-8000-000000000040' and event.event_type = 'corrigida'
      and event.details -> 'items' -> 0 ->> 'from_non_catalog_kind' = 'uso_despesa'
      and event.details -> 'items' -> 0 ->> 'to_non_catalog_kind' = 'revenda'),
  'confirmação: o evento da conta registra a troca de tipo');
select is(
  (public.correct_payable_purchase_items('97900000-0000-4000-8000-0000000000a1', 'aplicar',
    '[{"item_id":"97900000-0000-4000-8000-000000000060","product_id":null,"conversion_factor":null,"non_catalog_kind":"revenda"}]',
    null, current_setting('teste.p1')::jsonb ->> 'impact_hash') ->> 'replayed')::boolean,
  true, 'mesmo pedido repetido devolve o resultado gravado');
select is(
  public.correct_payable_purchase_items('97900000-0000-4000-8000-0000000000a1', 'aplicar',
    '[{"item_id":"97900000-0000-4000-8000-000000000060","product_id":null,"conversion_factor":null,"non_catalog_kind":"revenda"}]',
    null, current_setting('teste.p1')::jsonb ->> 'impact_hash') -> 'impact',
  current_setting('teste.a1')::jsonb -> 'impact', 'o replay devolve o mesmo efeito gravado');
select throws_ok(
  $$select public.correct_payable_purchase_items('97900000-0000-4000-8000-0000000000a1', 'aplicar',
    '[{"item_id":"97900000-0000-4000-8000-000000000060","product_id":null,"conversion_factor":null,"non_catalog_kind":"uso_despesa"}]',
    null, current_setting('teste.p1')::jsonb ->> 'impact_hash')$$,
  '22023', 'Este pedido já foi usado em outra correção.', 'o mesmo identificador com outro tipo é recusado');

-- Revenda sem cadastro -> produto ----------------------------------------------

select set_config('teste.p2', public.correct_payable_purchase_items(null, 'previa',
  '[{"item_id":"97900000-0000-4000-8000-000000000060","product_id":"97900000-0000-4000-8000-000000000021","conversion_factor":1}]')::text, true);
select results_eq(
  $$select entry ->> 'action', (entry -> 'after' ->> 'active')::boolean
    from jsonb_array_elements(current_setting('teste.p2')::jsonb -> 'impact' -> 'memory_changes') entry$$,
  $$values ('desligar'::text, false)$$,
  'prévia: a revenda que vira produto desliga a memória de fora do cadastro');
select is(current_setting('teste.p2')::jsonb -> 'impact' -> 'memories_off',
  '["97900000-0000-4000-8000-000000000081"]'::jsonb, 'prévia: a lista antiga de memórias desligadas continua preenchida');
select results_eq(
  $$select (entry ->> 'cost_before')::numeric, (entry ->> 'cost_after')::numeric
    from jsonb_array_elements(current_setting('teste.p2')::jsonb -> 'impact' -> 'products') entry$$,
  $$values (40.00::numeric, 100.00::numeric)$$,
  'prévia: a nota é a mais recente do whey cadastrado e passa a dar o custo');
select results_eq(
  $$select (entry -> 'before' ->> 'qty_in')::numeric, (entry -> 'after' ->> 'qty_in')::numeric
    from jsonb_array_elements(current_setting('teste.p2')::jsonb -> 'impact' -> 'consumption' -> 'items') entry
    where entry ->> 'period_end_count_id' = '97900000-0000-4000-8000-000000000092'$$,
  $$values (0::numeric, 2::numeric)$$,
  'prévia: a semana fechada passa a contar a entrada no produto');
select set_config('teste.a2', public.correct_payable_purchase_items('97900000-0000-4000-8000-0000000000a2', 'aplicar',
  '[{"item_id":"97900000-0000-4000-8000-000000000060","product_id":"97900000-0000-4000-8000-000000000021","conversion_factor":1}]',
  null, current_setting('teste.p2')::jsonb ->> 'impact_hash')::text, true);
select results_eq(
  $$select mapping_status, non_catalog_kind, product_id, conversion_factor, usable_quantity, normalized_unit_cost
    from public.payable_purchase_items where id = '97900000-0000-4000-8000-000000000060'$$,
  $$values ('mapeado'::text, null::text, '97900000-0000-4000-8000-000000000021'::uuid, 1::numeric, 2::numeric, 100::numeric)$$,
  'confirmação: a revenda sai de fora do cadastro pela correção e entra no produto');
select is((select active from public.payable_non_catalog_mappings where id = '97900000-0000-4000-8000-000000000081'),
  false, 'confirmação: a memória de fora do cadastro fica desligada');
select is((select cost_price from public.products where id = '97900000-0000-4000-8000-000000000021'),
  100.00::numeric, 'confirmação: custo do whey vai a 100,00');

-- Desfazer a ida para o produto: volta a revenda e a memória ------------------------

select set_config('teste.u2', public.correct_payable_purchase_items(null, 'previa', null,
  (current_setting('teste.a2')::jsonb ->> 'correction_id')::uuid)::text, true);
select results_eq(
  $$select entry ->> 'action', (entry -> 'after' ->> 'active')::boolean, entry -> 'after' ->> 'non_catalog_kind'
    from jsonb_array_elements(current_setting('teste.u2')::jsonb -> 'impact' -> 'memory_changes') entry$$,
  $$values ('restaurar'::text, true, 'revenda'::text)$$,
  'prévia do desfazer: a memória volta ligada como revenda, porque nada mudou depois');
select results_eq(
  $$select entry ->> 'kind'
    from jsonb_array_elements(current_setting('teste.u2')::jsonb -> 'impact' -> 'decisions') entry$$,
  $$values ('origem_sem_nota'::text)$$,
  'prévia do desfazer: sem outra nota do whey cadastrado, o custo fica como está');
select set_config('teste.d2', public.correct_payable_purchase_items('97900000-0000-4000-8000-0000000000d2', 'aplicar', null,
  (current_setting('teste.a2')::jsonb ->> 'correction_id')::uuid,
  current_setting('teste.u2')::jsonb ->> 'impact_hash')::text, true);
select results_eq(
  $$select mapping_status, non_catalog_kind, product_id, item_name, unit
    from public.payable_purchase_items where id = '97900000-0000-4000-8000-000000000060'$$,
  $$values ('nao_aplicavel'::text, 'revenda'::text, null::uuid, 'WHEY PROTEIN 900G'::text, 'UN'::text)$$,
  'desfazer: o whey volta a revenda sem cadastro, com o tipo da foto');
select results_eq(
  $$select mapping.active, mapping.non_catalog_kind, mapping.updated_at = correction.corrected_at
    from public.payable_non_catalog_mappings mapping
    cross join public.payable_purchase_item_corrections correction
    where mapping.id = '97900000-0000-4000-8000-000000000081' and correction.request_id = '97900000-0000-4000-8000-0000000000a1'$$,
  $$values (true, 'revenda'::text, true)$$,
  'desfazer: a memória volta inteira, como a correção anterior a deixou');
select is((select cost_price from public.products where id = '97900000-0000-4000-8000-000000000021'),
  100.00::numeric, 'desfazer: sem outra nota, o custo do whey cadastrado fica como estava');
select throws_ok(
  $$select public.correct_payable_purchase_items(null, 'previa', null,
    (current_setting('teste.a1')::jsonb ->> 'correction_id')::uuid)$$,
  '22023', 'Um item foi corrigido de novo depois desta correção; desfaça a correção mais nova.',
  'a correção mais antiga do mesmo item não é desfeita por cima da mais nova');

-- Revenda sem cadastro -> uso ou despesa, e desfazer ----------------------------

select set_config('teste.p3', public.correct_payable_purchase_items(null, 'previa',
  '[{"item_id":"97900000-0000-4000-8000-000000000061","product_id":null,"conversion_factor":null,"non_catalog_kind":"uso_despesa"}]')::text, true);
select results_eq(
  $$select entry ->> 'action', entry -> 'after' ->> 'non_catalog_kind'
    from jsonb_array_elements(current_setting('teste.p3')::jsonb -> 'impact' -> 'memory_changes') entry$$,
  $$values ('trocar_tipo'::text, 'uso_despesa'::text)$$,
  'prévia: a memória da creatina passa a uso ou despesa');
select results_eq(
  $$select (entry -> 'before' ->> 'resale')::numeric - (entry -> 'after' ->> 'resale')::numeric
    from jsonb_array_elements(current_setting('teste.p3')::jsonb -> 'impact' -> 'consumption' -> 'periods') entry
    where entry ->> 'period_end_count_id' = '97900000-0000-4000-8000-000000000092'$$,
  $$values (50::numeric)$$,
  'prévia: os R$ 50 saem da revenda sem cadastro do período');
select is(current_setting('teste.p3')::jsonb -> 'impact' -> 'purchases' -> 0 -> 'split' -> 0 ->> 'key', 'cmv_revenda',
  'prévia financeira: a conta está em CMV de revenda (a tela avisa que uso ou despesa costuma ficar fora do CMV)');
select set_config('teste.a3', public.correct_payable_purchase_items('97900000-0000-4000-8000-0000000000a3', 'aplicar',
  '[{"item_id":"97900000-0000-4000-8000-000000000061","product_id":null,"conversion_factor":null,"non_catalog_kind":"uso_despesa"}]',
  null, current_setting('teste.p3')::jsonb ->> 'impact_hash')::text, true);
select is((select non_catalog_kind from public.payable_purchase_items where id = '97900000-0000-4000-8000-000000000061'),
  'uso_despesa', 'confirmação: a creatina passa a uso ou despesa pela correção');
select is((select non_catalog_kind from public.payable_non_catalog_mappings where id = '97900000-0000-4000-8000-000000000082'),
  'uso_despesa', 'confirmação: a memória da creatina passa a uso ou despesa');
select set_config('teste.u3', public.correct_payable_purchase_items(null, 'previa', null,
  (current_setting('teste.a3')::jsonb ->> 'correction_id')::uuid)::text, true);
select set_config('teste.d3', public.correct_payable_purchase_items('97900000-0000-4000-8000-0000000000d3', 'aplicar', null,
  (current_setting('teste.a3')::jsonb ->> 'correction_id')::uuid,
  current_setting('teste.u3')::jsonb ->> 'impact_hash')::text, true);
select is((select non_catalog_kind from public.payable_purchase_items where id = '97900000-0000-4000-8000-000000000061'),
  'revenda', 'desfazer: a creatina volta a revenda sem cadastro');
reset role;
select results_eq(
  $$select mapping.non_catalog_kind, mapping.updated_at = antes.updated_at
    from public.payable_non_catalog_mappings mapping cross join memoria_creatina_antes antes
    where mapping.id = '97900000-0000-4000-8000-000000000082'$$,
  $$values ('revenda'::text, true)$$,
  'desfazer: a memória volta a revenda, com a versão que tinha antes da correção');
set local role authenticated;
select set_config('request.jwt.claim.sub', '97900000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.correct_payable_purchase_items(null, 'previa', null,
    (current_setting('teste.a3')::jsonb ->> 'correction_id')::uuid)$$,
  '22023', 'Esta correção já foi desfeita.', 'desfazer duas vezes é recusado');

-- Regra de conflito: memória decidida depois da nota fica como está -------------------

select set_config('teste.p4', public.correct_payable_purchase_items(null, 'previa',
  '[{"item_id":"97900000-0000-4000-8000-000000000065","product_id":null,"conversion_factor":null,"non_catalog_kind":"revenda"}]')::text, true);
select results_eq(
  $$select entry ->> 'action', entry ->> 'reason', entry ->> 'newer_at', entry -> 'after'
    from jsonb_array_elements(current_setting('teste.p4')::jsonb -> 'impact' -> 'memory_changes') entry$$,
  $$values ('manter'::text, 'decisao_posterior'::text, '2024-05-01T12:00:00'::text, 'null'::jsonb)$$,
  'prévia: a memória do papel mudou depois da nota e fica como está, com a data da decisão mais nova');
select is(current_setting('teste.p4')::jsonb -> 'impact' -> 'items' -> 0 -> 'next_suggestion' ->> 'non_catalog_kind', 'uso_despesa',
  'prévia: a próxima nota do papel continua sugerindo uso ou despesa');
select set_config('teste.a4', public.correct_payable_purchase_items('97900000-0000-4000-8000-0000000000a4', 'aplicar',
  '[{"item_id":"97900000-0000-4000-8000-000000000065","product_id":null,"conversion_factor":null,"non_catalog_kind":"revenda"}]',
  null, current_setting('teste.p4')::jsonb ->> 'impact_hash')::text, true);
reset role;
select results_eq(
  $$select item.non_catalog_kind, mapping.non_catalog_kind, mapping.updated_at
    from public.payable_purchase_items item cross join public.payable_non_catalog_mappings mapping
    where item.id = '97900000-0000-4000-8000-000000000065' and mapping.id = '97900000-0000-4000-8000-000000000083'$$,
  $$values ('revenda'::text, 'uso_despesa'::text, '2024-05-01 12:00+00'::timestamptz)$$,
  'confirmação: a nota antiga vira revenda, e a memória da decisão mais nova não muda');
set local role authenticated;
select set_config('request.jwt.claim.sub', '97900000-0000-4000-8000-000000000002', true);

-- Desfazer depois de a memória mudar: ela fica com a escolha mais nova ------------------

select set_config('teste.p5', public.correct_payable_purchase_items(null, 'previa',
  '[{"item_id":"97900000-0000-4000-8000-000000000067","product_id":null,"conversion_factor":null,"non_catalog_kind":"revenda"}]')::text, true);
select set_config('teste.a5', public.correct_payable_purchase_items('97900000-0000-4000-8000-0000000000a5', 'aplicar',
  '[{"item_id":"97900000-0000-4000-8000-000000000067","product_id":null,"conversion_factor":null,"non_catalog_kind":"revenda"}]',
  null, current_setting('teste.p5')::jsonb ->> 'impact_hash')::text, true);
-- Uma nota nova do mesmo fornecedor volta a lembrar a água como uso ou despesa.
reset role;
update public.payable_non_catalog_mappings
set non_catalog_kind = 'uso_despesa', updated_at = clock_timestamp()
where id = '97900000-0000-4000-8000-000000000085';
create temporary table memoria_agua_nova on commit drop as
select mapping.updated_at from public.payable_non_catalog_mappings mapping
where mapping.id = '97900000-0000-4000-8000-000000000085';
set local role authenticated;
select set_config('request.jwt.claim.sub', '97900000-0000-4000-8000-000000000002', true);
select set_config('teste.u5', public.correct_payable_purchase_items(null, 'previa', null,
  (current_setting('teste.a5')::jsonb ->> 'correction_id')::uuid)::text, true);
select results_eq(
  $$select entry ->> 'action', entry ->> 'reason', entry ->> 'newer_at' is not null
    from jsonb_array_elements(current_setting('teste.u5')::jsonb -> 'impact' -> 'memory_changes') entry$$,
  $$values ('manter'::text, 'mudou_depois'::text, true)$$,
  'prévia do desfazer: a memória da água mudou depois da correção e fica com a escolha mais nova');
select set_config('teste.d5', public.correct_payable_purchase_items('97900000-0000-4000-8000-0000000000d5', 'aplicar', null,
  (current_setting('teste.a5')::jsonb ->> 'correction_id')::uuid,
  current_setting('teste.u5')::jsonb ->> 'impact_hash')::text, true);
reset role;
select results_eq(
  $$select item.non_catalog_kind, mapping.non_catalog_kind, mapping.updated_at = nova.updated_at
    from public.payable_purchase_items item
    cross join public.payable_non_catalog_mappings mapping
    cross join memoria_agua_nova nova
    where item.id = '97900000-0000-4000-8000-000000000067' and mapping.id = '97900000-0000-4000-8000-000000000085'$$,
  $$values ('uso_despesa'::text, 'uso_despesa'::text, true)$$,
  'desfazer: a água volta a uso ou despesa e a memória mais nova não é tocada');
set local role authenticated;
select set_config('request.jwt.claim.sub', '97900000-0000-4000-8000-000000000002', true);

-- Produto -> revenda sem cadastro, com nota que sobra ------------------------------------

select set_config('teste.p6', public.correct_payable_purchase_items(null, 'previa',
  '[{"item_id":"97900000-0000-4000-8000-000000000063","product_id":null,"conversion_factor":null,"non_catalog_kind":"revenda"}]')::text, true);
select results_eq(
  $$select entry ->> 'kind', entry ->> 'purchase_id'
    from jsonb_array_elements(current_setting('teste.p6')::jsonb -> 'impact' -> 'decisions') entry$$,
  $$values ('origem_recalculada'::text, '97900000-0000-4000-8000-000000000042'::text)$$,
  'prévia: a nota que dava o custo da creatina sai, e vale a nota que sobrou');
select results_eq(
  $$select (entry ->> 'cost_before')::numeric, (entry ->> 'cost_after')::numeric
    from jsonb_array_elements(current_setting('teste.p6')::jsonb -> 'impact' -> 'products') entry$$,
  $$values (30.00::numeric, 25.00::numeric)$$,
  'prévia: o custo da creatina cadastrada volta a 25,00');
select results_eq(
  $$select entry -> 'after' ->> 'mapping_status', entry -> 'after' ->> 'non_catalog_kind'
    from jsonb_array_elements(current_setting('teste.p6')::jsonb -> 'impact' -> 'items') entry$$,
  $$values ('nao_aplicavel'::text, 'revenda'::text)$$,
  'prévia: o item vai para revenda sem cadastro');
select is(current_setting('teste.p6')::jsonb -> 'impact' -> 'memory_changes', '[]'::jsonb,
  'prévia: sem memória de fora do cadastro, nenhuma memória muda');
select set_config('teste.a6', public.correct_payable_purchase_items('97900000-0000-4000-8000-0000000000a6', 'aplicar',
  '[{"item_id":"97900000-0000-4000-8000-000000000063","product_id":null,"conversion_factor":null,"non_catalog_kind":"revenda"}]',
  null, current_setting('teste.p6')::jsonb ->> 'impact_hash')::text, true);
select results_eq(
  $$select mapping_status, non_catalog_kind, product_id, conversion_factor, usable_quantity, normalized_unit_cost, cost_applied
    from public.payable_purchase_items where id = '97900000-0000-4000-8000-000000000063'$$,
  $$values ('nao_aplicavel'::text, 'revenda'::text, null::uuid, null::numeric, null::numeric, null::numeric, null::boolean)$$,
  'confirmação: a creatina da nota nova vira revenda sem cadastro, sem custo de cadastro');
select is((select cost_price from public.products where id = '97900000-0000-4000-8000-000000000022'),
  25.00::numeric, 'confirmação: custo da creatina cadastrada recalculado pela nota que sobrou');
select is((select cost_applied from public.payable_purchase_items where id = '97900000-0000-4000-8000-000000000062'),
  true, 'confirmação: a nota que sobrou passa a dar o custo');

-- Produto -> revenda sem cadastro, única nota, e desfazer ----------------------------

select set_config('teste.p7', public.correct_payable_purchase_items(null, 'previa',
  '[{"item_id":"97900000-0000-4000-8000-000000000064","product_id":null,"conversion_factor":null,"non_catalog_kind":"revenda"}]')::text, true);
select results_eq(
  $$select entry ->> 'kind', (entry ->> 'cost_from_this_note')::boolean
    from jsonb_array_elements(current_setting('teste.p7')::jsonb -> 'impact' -> 'decisions') entry$$,
  $$values ('origem_sem_nota'::text, false)$$,
  'prévia: a barra perde a única nota e o custo do cadastro fica como estava');
select set_config('teste.a7', public.correct_payable_purchase_items('97900000-0000-4000-8000-0000000000a7', 'aplicar',
  '[{"item_id":"97900000-0000-4000-8000-000000000064","product_id":null,"conversion_factor":null,"non_catalog_kind":"revenda"}]',
  null, current_setting('teste.p7')::jsonb ->> 'impact_hash')::text, true);
select is((select cost_price from public.products where id = '97900000-0000-4000-8000-000000000023'),
  12.00::numeric, 'confirmação: sem outra nota, o custo da barra fica como estava');
select set_config('teste.u7', public.correct_payable_purchase_items(null, 'previa', null,
  (current_setting('teste.a7')::jsonb ->> 'correction_id')::uuid)::text, true);
select set_config('teste.d7', public.correct_payable_purchase_items('97900000-0000-4000-8000-0000000000d7', 'aplicar', null,
  (current_setting('teste.a7')::jsonb ->> 'correction_id')::uuid,
  current_setting('teste.u7')::jsonb ->> 'impact_hash')::text, true);
select results_eq(
  $$select mapping_status, non_catalog_kind, product_id, item_name, unit, category_snapshot, conversion_basis,
           conversion_factor, usable_quantity, normalized_unit_cost, cost_applied
    from public.payable_purchase_items where id = '97900000-0000-4000-8000-000000000064'$$,
  $$values ('mapeado'::text, null::text, '97900000-0000-4000-8000-000000000023'::uuid, '[TESTE] Barra fase 3'::text,
            'un'::text, 'Revenda'::text, 'simple'::text, 1::numeric, 1::numeric, 12::numeric, true)$$,
  'desfazer: a revenda volta ao produto com o que estava gravado, pela correção');

-- Correções antigas, sem o tipo -------------------------------------------------

-- Correção gravada na fase 5 (foto com situação, sem o tipo): o item foi de
-- produto para uso ou despesa e uma memória foi desligada.
reset role;
insert into public.payable_purchase_item_corrections (
  id, request_id, action, undoes_correction_id, product_ids, item_ids, requested, impact, impact_hash, corrected_by, corrected_at
) values (
  '97900000-0000-4000-8000-0000000000e1', '97900000-0000-4000-8000-0000000000e2', 'corrigir', null,
  array['97900000-0000-4000-8000-000000000023']::uuid[], array['97900000-0000-4000-8000-000000000068']::uuid[],
  '[{"item_id":"97900000-0000-4000-8000-000000000068","product_id":null,"conversion_factor":null,"usable_quantity":null}]',
  '{"action":"corrigir","memories_off":["97900000-0000-4000-8000-000000000081"],"items":[{"item_id":"97900000-0000-4000-8000-000000000068","purchase_id":"97900000-0000-4000-8000-000000000046",
    "before":{"mapping_status":"mapeado","product_id":"97900000-0000-4000-8000-000000000023","product_name":"[TESTE] Barra fase 3","product_unit":"un","item_name":"[TESTE] Barra fase 3","unit":"un","quantity":1,"category_snapshot":"Revenda","conversion_basis":"simple","conversion_factor":1,"usable_quantity":1,"normalized_unit_cost":10,"cost_applied":false},
    "after":{"mapping_status":"nao_aplicavel","product_id":null,"product_name":null,"product_unit":null,"item_name":"BARRA LEGADA","unit":"UN","quantity":1,"category_snapshot":null,"conversion_basis":null,"conversion_factor":null,"usable_quantity":null,"normalized_unit_cost":null,"cost_applied":null}}]}',
  'hash-fase5-corrigir', '97900000-0000-4000-8000-000000000001', '2024-06-01 12:00+00'
), (
  -- Pedido da fase 5 para uso ou despesa, sem o tipo, gravado antes desta migration.
  '97900000-0000-4000-8000-0000000000e3', '97900000-0000-4000-8000-0000000000e4', 'corrigir', null,
  '{}'::uuid[], array['97900000-0000-4000-8000-000000000069']::uuid[],
  '[{"item_id":"97900000-0000-4000-8000-000000000069","product_id":null,"conversion_factor":null,"usable_quantity":null}]',
  '{"action":"corrigir","items":[]}', 'hash-fase5-replay', '97900000-0000-4000-8000-000000000001', '2024-06-02 12:00+00'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '97900000-0000-4000-8000-000000000002', true);
select set_config('teste.u8', public.correct_payable_purchase_items(null, 'previa', null,
  '97900000-0000-4000-8000-0000000000e1')::text, true);
select results_eq(
  $$select entry ->> 'mapping_id', entry ->> 'action', entry ->> 'reason'
    from jsonb_array_elements(current_setting('teste.u8')::jsonb -> 'impact' -> 'memory_changes') entry$$,
  $$values ('97900000-0000-4000-8000-000000000081'::text, 'manter'::text, 'correcao_antiga'::text)$$,
  'prévia do desfazer de correção antiga: a memória que ela desligou não é religada');
select set_config('teste.d8', public.correct_payable_purchase_items('97900000-0000-4000-8000-0000000000d8', 'aplicar', null,
  '97900000-0000-4000-8000-0000000000e1', current_setting('teste.u8')::jsonb ->> 'impact_hash')::text, true);
select results_eq(
  $$select mapping_status, non_catalog_kind, product_id, item_name, category_snapshot, conversion_factor
    from public.payable_purchase_items where id = '97900000-0000-4000-8000-000000000068'$$,
  $$values ('mapeado'::text, null::text, '97900000-0000-4000-8000-000000000023'::uuid, '[TESTE] Barra fase 3'::text, 'Revenda'::text, 1::numeric)$$,
  'desfazer de correção antiga sem o tipo: o item volta ao produto');
select is((select active from public.payable_non_catalog_mappings where id = '97900000-0000-4000-8000-000000000081'),
  true, 'desfazer de correção antiga não mexe na memória');
select is(
  (public.correct_payable_purchase_items('97900000-0000-4000-8000-0000000000e4', 'aplicar',
    '[{"item_id":"97900000-0000-4000-8000-000000000069","product_id":null,"conversion_factor":null}]',
    null, 'hash-fase5-replay') ->> 'replayed')::boolean,
  true, 'replay de pedido gravado antes do tipo devolve o resultado gravado');

-- Desfazer recusado quando só o tipo mudou depois da correção --------------------

select set_config('teste.p9', public.correct_payable_purchase_items(null, 'previa',
  '[{"item_id":"97900000-0000-4000-8000-00000000006a","product_id":null,"conversion_factor":null,"non_catalog_kind":"revenda"}]')::text, true);
select set_config('teste.a9', public.correct_payable_purchase_items('97900000-0000-4000-8000-0000000000a9', 'aplicar',
  '[{"item_id":"97900000-0000-4000-8000-00000000006a","product_id":null,"conversion_factor":null,"non_catalog_kind":"revenda"}]',
  null, current_setting('teste.p9')::jsonb ->> 'impact_hash')::text, true);
-- Alguém troca o tipo por fora depois (simulado com a marca da correção).
reset role;
select set_config('pane.correcao_itens_nfe', 'sim', true);
update public.payable_purchase_items set non_catalog_kind = 'uso_despesa'
where id = '97900000-0000-4000-8000-00000000006a';
select set_config('pane.correcao_itens_nfe', '', true);
set local role authenticated;
select set_config('request.jwt.claim.sub', '97900000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.correct_payable_purchase_items(null, 'previa', null,
    (current_setting('teste.a9')::jsonb ->> 'correction_id')::uuid)$$,
  '22023', 'Um item mudou depois desta correção; ela não pode mais ser desfeita.',
  'desfazer é recusado quando o tipo do item mudou depois da correção');

-- Regra de conflito item a item e foto exata no desfazer (revisão de outra família) ---

select is(
  public.correct_payable_purchase_items(null, 'previa',
    '[{"item_id":"97900000-0000-4000-8000-00000000006b","product_id":null,"conversion_factor":null,"non_catalog_kind":"revenda"}]')
    -> 'impact' -> 'memory_changes' -> 0 ->> 'reason',
  'data_desconhecida', 'item sem a data da decisão deixa a memória como está');
select results_eq(
  $$select entry ->> 'action', entry ->> 'reason', entry ->> 'newer_at'
    from jsonb_array_elements(public.correct_payable_purchase_items(null, 'previa',
      '[{"item_id":"97900000-0000-4000-8000-00000000006c","product_id":null,"conversion_factor":null,"non_catalog_kind":"revenda"},
        {"item_id":"97900000-0000-4000-8000-00000000006d","product_id":null,"conversion_factor":null,"non_catalog_kind":"revenda"}]')
      -> 'impact' -> 'memory_changes') entry$$,
  $$values ('manter'::text, 'decisao_posterior'::text, '2024-04-20T12:00:00'::text)$$,
  'no mesmo pedido, o item antigo da memória basta para ela ficar como está');
select results_eq(
  $$select entry ->> 'action', entry ->> 'reason', entry ->> 'newer_at'
    from jsonb_array_elements(public.correct_payable_purchase_items(null, 'previa',
      '[{"item_id":"97900000-0000-4000-8000-00000000006f","product_id":null,"conversion_factor":null,"non_catalog_kind":"revenda"}]')
      -> 'impact' -> 'memory_changes') entry$$,
  $$values ('manter'::text, 'decisao_posterior'::text, '2024-05-02T12:00:00'::text)$$,
  'memória de insumo desligada depois da nota também é decisão mais nova');
select set_config('teste.pe', public.correct_payable_purchase_items(null, 'previa',
  '[{"item_id":"97900000-0000-4000-8000-00000000006e","product_id":null,"conversion_factor":null,"non_catalog_kind":"revenda"}]')::text, true);
select set_config('teste.ae', public.correct_payable_purchase_items('97900000-0000-4000-8000-0000000000ae', 'aplicar',
  '[{"item_id":"97900000-0000-4000-8000-00000000006e","product_id":null,"conversion_factor":null,"non_catalog_kind":"revenda"}]',
  null, current_setting('teste.pe')::jsonb ->> 'impact_hash')::text, true);
-- Outra gravação, que esperou a trava do fornecedor, reafirma a revenda com o
-- now() da transação dela, anterior ao carimbo da correção.
reset role;
update public.payable_non_catalog_mappings mapping
set non_catalog_kind = 'revenda',
    updated_at = (select correction.corrected_at - interval '1 second' from public.payable_purchase_item_corrections correction
                  where correction.request_id = '97900000-0000-4000-8000-0000000000ae')
where mapping.id = '97900000-0000-4000-8000-00000000008e';
set local role authenticated;
select set_config('request.jwt.claim.sub', '97900000-0000-4000-8000-000000000002', true);
select is(
  public.correct_payable_purchase_items(null, 'previa', null,
    (current_setting('teste.ae')::jsonb ->> 'correction_id')::uuid) -> 'impact' -> 'memory_changes' -> 0 ->> 'reason',
  'mudou_depois', 'desfazer não apaga a reafirmação gravada depois da correção, mesmo com carimbo anterior');
-- A correção seguinte do mesmo item também respeita essa reafirmação: compara
-- com a foto da correção anterior, não com o horário.
select is(
  public.correct_payable_purchase_items(null, 'previa',
    '[{"item_id":"97900000-0000-4000-8000-00000000006e","product_id":"97900000-0000-4000-8000-000000000023","conversion_factor":1}]')
    -> 'impact' -> 'memory_changes' -> 0 ->> 'reason',
  'decisao_posterior', 'correção nova do item não desliga a memória reafirmada depois da correção anterior');

-- Desfazer com duas memórias que casam com o item: a foto inteira confere.
select set_config('teste.pm', public.correct_payable_purchase_items(null, 'previa',
  '[{"item_id":"97900000-0000-4000-8000-000000000170","product_id":null,"conversion_factor":null,"non_catalog_kind":"revenda"}]')::text, true);
select set_config('teste.am', public.correct_payable_purchase_items('97900000-0000-4000-8000-0000000001a1', 'aplicar',
  '[{"item_id":"97900000-0000-4000-8000-000000000170","product_id":null,"conversion_factor":null,"non_catalog_kind":"revenda"}]',
  null, current_setting('teste.pm')::jsonb ->> 'impact_hash')::text, true);
select set_config('teste.um', public.correct_payable_purchase_items(null, 'previa', null,
  (current_setting('teste.am')::jsonb ->> 'correction_id')::uuid)::text, true);
select is(current_setting('teste.um')::jsonb -> 'impact' -> 'memory_changes' -> 0 ->> 'action', 'restaurar',
  'desfazer com duas memórias intocadas volta a memória de fora do cadastro');
select set_config('teste.dm', public.correct_payable_purchase_items('97900000-0000-4000-8000-0000000001d1', 'aplicar', null,
  (current_setting('teste.am')::jsonb ->> 'correction_id')::uuid,
  current_setting('teste.um')::jsonb ->> 'impact_hash')::text, true);
reset role;
select results_eq(
  $$select mapping.non_catalog_kind, mapping.updated_at = antes.updated_at
    from public.payable_non_catalog_mappings mapping cross join memoria_mel_antes antes
    where mapping.id = '97900000-0000-4000-8000-000000000180'$$,
  $$values ('uso_despesa'::text, true)$$,
  'desfazer: a memória do mel volta a uso ou despesa, com a versão de antes');
-- Depois do desfazer, a memória de insumo do mel deixa de casar com o item: a
-- foto da última correção acusa a mudança, que o horário sozinho não vê.
update public.payable_product_mappings set supplier_product_code = 'MEL-OUTRO'
where id = '97900000-0000-4000-8000-000000000181';
set local role authenticated;
select set_config('request.jwt.claim.sub', '97900000-0000-4000-8000-000000000002', true);
select is(
  public.correct_payable_purchase_items(null, 'previa',
    '[{"item_id":"97900000-0000-4000-8000-000000000170","product_id":null,"conversion_factor":null,"non_catalog_kind":"revenda"}]')
    -> 'impact' -> 'memory_changes' -> 0 ->> 'reason',
  'decisao_posterior', 'memória que mudou depois da última correção do item, mesmo sem horário mais novo, deixa a memória como está');

-- Memória que deixa de casar com o item depois da correção: o desfazer não a mexe.
select set_config('teste.pq', public.correct_payable_purchase_items(null, 'previa',
  '[{"item_id":"97900000-0000-4000-8000-000000000171","product_id":null,"conversion_factor":null,"non_catalog_kind":"revenda"}]')::text, true);
select set_config('teste.aq', public.correct_payable_purchase_items('97900000-0000-4000-8000-0000000001a2', 'aplicar',
  '[{"item_id":"97900000-0000-4000-8000-000000000171","product_id":null,"conversion_factor":null,"non_catalog_kind":"revenda"}]',
  null, current_setting('teste.pq')::jsonb ->> 'impact_hash')::text, true);
reset role;
update public.payable_non_catalog_mappings set supplier_product_code = 'PAOQ-OUTRO'
where id = '97900000-0000-4000-8000-000000000182';
set local role authenticated;
select set_config('request.jwt.claim.sub', '97900000-0000-4000-8000-000000000002', true);
select is(
  public.correct_payable_purchase_items(null, 'previa', null,
    (current_setting('teste.aq')::jsonb ->> 'correction_id')::uuid) -> 'impact' -> 'memory_changes' -> 0 ->> 'reason',
  'mudou_depois', 'desfazer não mexe na memória que deixou de casar com o item');

-- Ordem incerta (terceira revisão de outra família) ----------------------------

select is(
  public.correct_payable_purchase_items(null, 'previa',
    '[{"item_id":"97900000-0000-4000-8000-000000000172","product_id":"97900000-0000-4000-8000-000000000023","conversion_factor":1}]')
    -> 'impact' -> 'memory_changes' -> 0 ->> 'reason',
  'ordem_incerta', 'item sem correção anterior: memória gravada logo antes da decisão fica como está');
select is(
  public.correct_payable_purchase_items(null, 'previa',
    '[{"item_id":"97900000-0000-4000-8000-000000000173","product_id":null,"conversion_factor":null,"non_catalog_kind":"revenda"}]')
    -> 'impact' -> 'memory_changes' -> 0 ->> 'action',
  'trocar_tipo', 'memória bem mais velha que a decisão é decisão anterior: a correção troca o tipo');
reset role;
insert into public.payable_purchase_item_corrections (
  id, request_id, action, undoes_correction_id, product_ids, item_ids, requested, impact, impact_hash, corrected_by, corrected_at
)
select fixture.id, fixture.request_id, 'corrigir', null, '{}'::uuid[], array['97900000-0000-4000-8000-000000000174']::uuid[],
       '[{"item_id":"97900000-0000-4000-8000-000000000174","product_id":null,"conversion_factor":null,"usable_quantity":null,"non_catalog_kind":"uso_despesa"}]',
       jsonb_build_object('action', 'corrigir', 'memory_changes', '[]'::jsonb, 'items', jsonb_build_array(jsonb_build_object(
         'item_id', '97900000-0000-4000-8000-000000000174',
         'memories_snapshot', jsonb_build_array(jsonb_build_object('mapping_id', mapping.id, 'version', mapping.updated_at at time zone 'UTC'))))),
       'hash-empate', '97900000-0000-4000-8000-000000000001', '2024-06-03 12:00+00'
from (values ('97900000-0000-4000-8000-0000000000f1'::uuid, '97900000-0000-4000-8000-0000000000f2'::uuid),
             ('97900000-0000-4000-8000-0000000000f3'::uuid, '97900000-0000-4000-8000-0000000000f4'::uuid)) as fixture(id, request_id)
cross join public.payable_non_catalog_mappings mapping
where mapping.id = '97900000-0000-4000-8000-000000000185';
set local role authenticated;
select set_config('request.jwt.claim.sub', '97900000-0000-4000-8000-000000000002', true);
select is(
  public.correct_payable_purchase_items(null, 'previa',
    '[{"item_id":"97900000-0000-4000-8000-000000000174","product_id":null,"conversion_factor":null,"non_catalog_kind":"revenda"}]')
    -> 'impact' -> 'memory_changes' -> 0 ->> 'reason',
  'ordem_incerta', 'duas correções do item no mesmo instante deixam a ordem incerta e a memória fica');
select set_config('teste.pt', public.correct_payable_purchase_items(null, 'previa',
  '[{"item_id":"97900000-0000-4000-8000-000000000175","product_id":null,"conversion_factor":null,"non_catalog_kind":"revenda"}]')::text, true);
select set_config('teste.at', public.correct_payable_purchase_items('97900000-0000-4000-8000-0000000001a3', 'aplicar',
  '[{"item_id":"97900000-0000-4000-8000-000000000175","product_id":null,"conversion_factor":null,"non_catalog_kind":"revenda"}]',
  null, current_setting('teste.pt')::jsonb ->> 'impact_hash')::text, true);
reset role;
insert into public.payable_purchase_item_corrections (
  id, request_id, action, undoes_correction_id, product_ids, item_ids, requested, impact, impact_hash, corrected_by, corrected_at
)
select '97900000-0000-4000-8000-0000000000f5', '97900000-0000-4000-8000-0000000000f6', 'corrigir', null, '{}'::uuid[],
       array['97900000-0000-4000-8000-000000000175']::uuid[], '[]',
       '{"action":"corrigir","items":[{"item_id":"97900000-0000-4000-8000-000000000175"}]}', 'hash-empate-2',
       '97900000-0000-4000-8000-000000000001', correction.corrected_at
from public.payable_purchase_item_corrections correction
where correction.request_id = '97900000-0000-4000-8000-0000000001a3';
set local role authenticated;
select set_config('request.jwt.claim.sub', '97900000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.correct_payable_purchase_items(null, 'previa', null,
    (current_setting('teste.at')::jsonb ->> 'correction_id')::uuid)$$,
  '22023', 'Um item foi corrigido de novo depois desta correção; desfaça a correção mais nova.',
  'outra correção do item no mesmo instante bloqueia o desfazer');
reset role;
-- A correção (id maior) e o desfazer dela (id menor) no mesmo instante: o
-- desfazer é a última, e a foto dele é a que vale.
insert into public.payable_purchase_item_corrections (
  id, request_id, action, undoes_correction_id, product_ids, item_ids, requested, impact, impact_hash, corrected_by, corrected_at
) values (
  '97900000-0000-4000-8000-0000000000fe', '97900000-0000-4000-8000-0000000000fd', 'corrigir', null, '{}'::uuid[],
  array['97900000-0000-4000-8000-000000000176']::uuid[], '[]',
  '{"action":"corrigir","memory_changes":[],"items":[{"item_id":"97900000-0000-4000-8000-000000000176","memories_snapshot":[{"mapping_id":"97900000-0000-4000-8000-000000000187","version":"2000-01-01T00:00:00"}]}]}',
  'hash-par-1', '97900000-0000-4000-8000-000000000001', '2024-06-04 12:00+00'
);
insert into public.payable_purchase_item_corrections (
  id, request_id, action, undoes_correction_id, product_ids, item_ids, requested, impact, impact_hash, corrected_by, corrected_at
)
select '97900000-0000-4000-8000-0000000000f7', '97900000-0000-4000-8000-0000000000f8', 'desfazer', '97900000-0000-4000-8000-0000000000fe',
       '{}'::uuid[], array['97900000-0000-4000-8000-000000000176']::uuid[], '[]',
       jsonb_build_object('action', 'desfazer', 'memory_changes', '[]'::jsonb, 'items', jsonb_build_array(jsonb_build_object(
         'item_id', '97900000-0000-4000-8000-000000000176',
         'memories_snapshot', jsonb_build_array(jsonb_build_object('mapping_id', mapping.id, 'version', mapping.updated_at at time zone 'UTC'))))),
       'hash-par-2', '97900000-0000-4000-8000-000000000001', '2024-06-04 12:00+00'
from public.payable_non_catalog_mappings mapping where mapping.id = '97900000-0000-4000-8000-000000000187';
set local role authenticated;
select set_config('request.jwt.claim.sub', '97900000-0000-4000-8000-000000000002', true);
select is(
  public.correct_payable_purchase_items(null, 'previa',
    '[{"item_id":"97900000-0000-4000-8000-000000000176","product_id":null,"conversion_factor":null,"non_catalog_kind":"revenda"}]')
    -> 'impact' -> 'memory_changes' -> 0 ->> 'action',
  'trocar_tipo', 'no mesmo instante, o desfazer vem depois da correção dele, qualquer que seja o identificador');
select is(
  public.correct_payable_purchase_items(null, 'previa',
    '[{"item_id":"97900000-0000-4000-8000-000000000177","product_id":null,"conversion_factor":null,"non_catalog_kind":"revenda"}]')
    -> 'impact' -> 'memory_changes' -> 0 ->> 'reason',
  'ordem_incerta', 'limitação conhecida: memória de insumo desligada um minuto antes da decisão deixa a ordem incerta');

-- Administrador também corrige --------------------------------------------------

select set_config('request.jwt.claim.sub', '97900000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$select public.correct_payable_purchase_items(null, 'previa',
    '[{"item_id":"97900000-0000-4000-8000-000000000066","product_id":null,"conversion_factor":null,"non_catalog_kind":"revenda"}]')$$,
  'Administrador vê a prévia de uso ou despesa para revenda');
select results_eq(
  $$select entry ->> 'action', entry ->> 'reason'
    from jsonb_array_elements(public.correct_payable_purchase_items(null, 'previa',
      '[{"item_id":"97900000-0000-4000-8000-000000000066","product_id":null,"conversion_factor":null,"non_catalog_kind":"revenda"}]')
      -> 'impact' -> 'memory_changes') entry$$,
  $$values ('manter'::text, 'ja_certa'::text)$$,
  'memória que já sugere o tipo pedido não muda');

-- Nada do financeiro muda ----------------------------------------------------------

reset role;
select set_eq(
  $$select purchase.id, purchase.total_value, purchase.status, purchase.classification_status
    from public.payable_purchases purchase where purchase.id::text like '97900000-0000-4000-8000-00000000004%'$$,
  $$select id, total_value, status, classification_status from contas_antes$$,
  'nenhuma conta mudou de total, situação ou classificação');
select set_eq(
  $$select installment.id, installment.status, installment.amount, installment.paid_amount, installment.paid_date
    from public.payable_installments installment where installment.purchase_id::text like '97900000-0000-4000-8000-00000000004%'$$,
  $$select id, status, amount, paid_amount, paid_date from parcelas_antes$$,
  'as parcelas não mudam');
select set_eq(
  $$select split.purchase_id, split.category_id, split.amount
    from public.payable_purchase_categories split where split.purchase_id::text like '97900000-0000-4000-8000-00000000004%'$$,
  $$select purchase_id, category_id, amount from rateio_antes$$,
  'o rateio de DRE das contas não muda');
select set_eq(
  $$select id, category_id, amount, competence_month, reversed_at from public.finance_entries
    where source = 'contas_pagar' and source_ref = '97900000-0000-4000-8000-000000000071'$$,
  $$select id, category_id, amount, competence_month, reversed_at from livro_antes$$,
  'o livro-caixa da conta paga não muda');
select set_eq(
  $$select item.id, item.quantity, item.unit_price, item.line_total, item.acquisition_value
    from public.payable_purchase_items item where item.purchase_id::text like '97900000-0000-4000-8000-00000000004%'$$,
  $$select id, quantity, unit_price, line_total, acquisition_value from valores_antes$$,
  'nenhuma correção mudou quantidade, preço ou valor de aquisição de item algum');
select is((select count(*)::int from public.payable_purchase_item_corrections
           where item_ids = '{}' and requested::text like '%97900000-%'), 0,
  'toda correção desta prova é achada pelo item');
select is((select count(*)::int from public.payable_purchase_items
           where id::text like '97900000-0000-4000-8000-00000000006%' and mapping_status = 'nao_aplicavel' and non_catalog_kind is null), 0,
  'todo item fora do cadastro continua com tipo');

-- Histórico: Financeiro autorizado lê, Expedição não ------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '97900000-0000-4000-8000-000000000002', true);
select ok((select count(*)::int from public.payable_purchase_item_corrections
           where item_ids && array['97900000-0000-4000-8000-000000000060']::uuid[]) = 3,
  'Financeiro autorizado acha pelo item as três correções do whey');
select set_config('request.jwt.claim.sub', '97900000-0000-4000-8000-000000000004', true);
select is((select count(*)::int from public.payable_purchase_item_corrections), 0, 'Expedição JC não lê o histórico');

select * from finish();
rollback;
