-- Fase 2 de "peso medio converte PJ por peso no Forno": Focaccia PJ ja tinha
-- cadastro proprio no catalogo (Focaccia Alecrim kg, Focaccia Azeitonas kg -
-- ambas ja ligadas a tabelas de preco ativas), fisicamente diferente da
-- Focaccia de loja (tabuleiro pesado vendido ao PJ x unidade pequena de
-- balcao). Faltava so a classificacao operacional, por isso a Geolar nao
-- conseguia programa-las no Forno ("produto sem classificacao operacional
-- para producao"). Confirmado por Rodrigo em 2026-09-15: os dois sabores sao
-- reais. Mesmo padrao estreito da migration 20260912185323 (Baguete Rocca):
-- is_fabricacao_propria e production_area ja estao corretos, o update toca
-- somente as tres colunas que faltam, guardado pelo estado atual auditado.
begin;

update public.products
set production_process = 'forno',
    allows_planned_production = true,
    allows_unplanned_production = false
where id in (
  '8a52d914-06da-414f-a8fc-d0abab063a89', -- Focaccia Alecrim kg
  '1ed4b77c-6be8-4e06-bbca-d60dbebcfcb1'  -- Focaccia Azeitonas kg
)
  and is_fabricacao_propria is true
  and production_area = 'padaria'
  and production_process is null
  and allows_planned_production is null
  and allows_unplanned_production is null;

commit;
