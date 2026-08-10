-- Fase 1 do contas a receber: prazo de pagamento no cliente e CNPJ sem duplicata.
--
-- O prazo nasce vazio de proposito. Preencher os clientes existentes com um
-- padrao inventado produziria vencimento errado em cobranca real; e melhor a
-- tela dizer "sem prazo definido" e o contas a receber recusar gerar cobranca
-- para quem ainda nao tem prazo combinado.
--
-- Plano da funcionalidade: docs/CONTAS_A_RECEBER.md

begin;

alter table public.customers
  add column if not exists payment_term_days integer;

alter table public.customers
  drop constraint if exists customers_payment_term_days_check;

alter table public.customers
  add constraint customers_payment_term_days_check
  check (
    payment_term_days is null
    or (payment_term_days >= 0 and payment_term_days <= 180)
  );

comment on column public.customers.payment_term_days is
  'Prazo de pagamento em dias corridos, contado da entrega. NULL = prazo ainda nao combinado; nesse caso o contas a receber nao gera cobranca. 0 = a vista.';

-- Unifica clientes ativos que repetem o mesmo CNPJ.
--
-- Regra conservadora: so desativa a duplicata que nao carrega historico algum
-- (nenhum pedido e nenhum preco especial). Duplicata com historico permanece
-- ativa e faz a verificacao abaixo falhar, porque decidir qual cadastro vale
-- exige a operacao, nao uma migration.
--
-- Em producao, em 2026-08-10, existia uma unica ocorrencia: o CNPJ
-- 54.338.407/0001-52 cadastrado como "NDCG - NIX" (com pedidos) e como
-- "NDCG RESTAURANTE LTDA - Nix" (sem nada). Num banco novo, nada acontece aqui.
with normalizado as (
  select
    id,
    active,
    created_at,
    nullif(regexp_replace(coalesce(doc, ''), '[^0-9]', '', 'g'), '') as doc_numerico
  from public.customers
),
duplicados as (
  select n.id, n.doc_numerico, n.created_at,
    (select count(*) from public.orders o where o.customer_id = n.id) as pedidos,
    (select count(*) from public.customer_price_overrides v where v.customer_id = n.id) as precos
  from normalizado n
  where n.active
    and n.doc_numerico is not null
    and exists (
      select 1 from normalizado outro
      where outro.active
        and outro.doc_numerico = n.doc_numerico
        and outro.id <> n.id
    )
),
ranqueados as (
  select id, doc_numerico, pedidos, precos,
    row_number() over (
      partition by doc_numerico
      order by pedidos desc, precos desc, created_at asc
    ) as posicao
  from duplicados
)
update public.customers cliente
set active = false,
    notes = concat_ws(
      ' ',
      nullif(btrim(coalesce(cliente.notes, '')), ''),
      '[Cadastro duplicado do mesmo CNPJ, desativado na unificacao de 2026-08-10. Nao possuia pedido nem preco especial.]'
    )
from ranqueados
where ranqueados.id = cliente.id
  and ranqueados.posicao > 1
  and ranqueados.pedidos = 0
  and ranqueados.precos = 0;

-- O cadastro preservado do NDCG fica com a razao social completa. Nada muda em
-- pedido antigo: `orders.pj_client` guarda o nome usado no dia da venda.
update public.customers
set name = 'NDCG RESTAURANTE LTDA - Nix'
where active
  and name = 'NDCG - NIX'
  and regexp_replace(coalesce(doc, ''), '[^0-9]', '', 'g') = '54338407000152';

-- Falha alto e claro se ainda restar CNPJ repetido entre clientes ativos, em
-- vez de deixar o indice abaixo estourar com erro cru de unicidade.
do $$
declare
  v_repetidos text;
begin
  select string_agg(distinct doc_numerico, ', ')
    into v_repetidos
  from (
    select nullif(regexp_replace(coalesce(doc, ''), '[^0-9]', '', 'g'), '') as doc_numerico
    from public.customers
    where active
  ) numerado
  where doc_numerico is not null
  group by doc_numerico
  having count(*) > 1;

  if v_repetidos is not null then
    raise exception using
      errcode = '23505',
      message = 'Ha clientes ativos com o mesmo CNPJ e historico em ambos: ' || v_repetidos,
      hint = 'Decida na tela de Clientes qual cadastro vale antes de aplicar esta migration.';
  end if;
end;
$$;

create unique index if not exists customers_doc_numerico_ativo_unico
  on public.customers ((regexp_replace(doc, '[^0-9]', '', 'g')))
  where doc is not null
    and btrim(doc) <> ''
    and regexp_replace(doc, '[^0-9]', '', 'g') <> ''
    and active;

comment on index public.customers_doc_numerico_ativo_unico is
  'Impede dois clientes ativos com o mesmo CNPJ, ignorando pontuacao. Cadastro inativo pode repetir, para preservar historico.';

commit;
