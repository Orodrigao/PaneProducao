-- Corrige a classificacao operacional de dois produtos reais que a Geolar nao
-- consegue programar na Producao PJ: Baguete Rocca (fabricacao propria ja
-- verdadeira, mas sem processo/apontamento) e Focaccia Tomate (fabricacao
-- propria ainda falsa). Confirmado por Rodrigo em 2026-09-12: ambos sao
-- fabricacao propria, feitos pela Padaria, com processo final no Forno, e
-- devem ser programaveis pela Geolar (producao planejada, sem lancamento
-- livre). Correcao estreita por nome e pelo estado auditado em producao;
-- nao reclassifica categoria nem outros produtos.
begin;

-- Baguete Rocca ja tem is_fabricacao_propria e production_area corretos; o
-- update toca somente as tres colunas que faltam. Isso tambem evita acionar
-- a toa o gatilho sync_site_bread_catalog_after_product_change, que observa
-- is_fabricacao_propria e production_area (ver relato da tarefa).
update public.products
set production_process = 'forno',
    allows_planned_production = true,
    allows_unplanned_production = false
where name = 'Baguete Rocca'
  and is_fabricacao_propria is true
  and production_area = 'padaria'
  and production_process is null
  and allows_planned_production is null
  and allows_unplanned_production is null;

update public.products
set is_fabricacao_propria = true,
    production_area = 'padaria',
    production_process = 'forno',
    allows_planned_production = true,
    allows_unplanned_production = false
where name = 'Focaccia Tomate'
  and is_fabricacao_propria is false
  and production_area is null
  and production_process is null
  and allows_planned_production is null
  and allows_unplanned_production is null;

commit;
