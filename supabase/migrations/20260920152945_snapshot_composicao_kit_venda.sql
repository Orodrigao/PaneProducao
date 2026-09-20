-- A baixa de componentes de kit (20260916110309) é controle operacional do
-- que saiu na venda, não insumo do CMV (decisão de Rodrigo, 2026-09-20): o
-- custo real continua vindo só do inventário periódico.
--
-- Mas o motor antigo também refazia, a cada INSERT/UPDATE/DELETE em
-- product_components, a baixa de TODAS as vendas de kit já confirmadas,
-- usando a composição atual em vez da composição vigente quando cada venda
-- aconteceu. Corrigir a receita de um kit hoje reescrevia silenciosamente o
-- que a tela de Estoque de pães mostra ter saído em vendas de meses atrás, e
-- podia mudar o saldo ali exibido sem nenhuma venda ou produção nova.
--
-- Esta migration remove esse gatilho: editar a composição de um kit deixa de
-- tocar a baixa de vendas já confirmadas. A baixa de uma venda passa a ser
-- fixada no momento em que ela é gerada (confirmação, substituição,
-- restauração ou mudança do vínculo produto<->venda) e só muda de novo por
-- um desses eventos explícitos — nunca por uma edição de receita feita à
-- parte. Venda confirmada depois da correção da receita usa a receita nova;
-- venda confirmada antes mantém a baixa que já tinha.

begin;

drop trigger sync_kit_sale_movements_after_component_change on public.product_components;
drop function private.sync_kit_sale_movements_after_component_change();
drop function private.sync_kit_sale_movements_for_product(uuid);

commit;
