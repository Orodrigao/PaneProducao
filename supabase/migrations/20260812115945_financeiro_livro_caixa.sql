-- Financeiro, fase 0: o livro-caixa central.
--
-- Plano: docs/FINANCEIRO.md. Esta fase cria o alicerce (categorias, contas e
-- lançamentos) e o lançamento avulso. Contas a pagar, recorrência, receita do
-- fechamento de caixa e DRE entram nas fases seguintes.
--
-- Princípio da decisão 1: o lançamento é imutável. Correção não sobrescreve
-- nem apaga — nasce um contra-lançamento (estorno) ligado ao original.

begin;

insert into public.app_permissions (key, module, label, description, sort_order)
values
  ('financeiro.acessar', 'Financeiro', 'Livro financeiro', 'Consultar os lançamentos de entrada e saída.', 320),
  ('financeiro.lancar', 'Financeiro', 'Lançar no financeiro', 'Registrar entradas e saídas avulsas.', 321),
  ('financeiro.estornar', 'Financeiro', 'Estornar lançamento', 'Anular um lançamento errado com contra-lançamento.', 322)
on conflict (key) do update set
  module = excluded.module,
  label = excluded.label,
  description = excluded.description,
  sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- Categorias: a estrutura do DRE.
-- ---------------------------------------------------------------------------
create table if not exists public.finance_categories (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  -- Andar do DRE: o que forma o resultado operacional, o que vem abaixo dele
  -- (empréstimo, investimento, retirada) e o que não é resultado nenhum
  -- (transferência entre contas).
  dre_tier text not null check (dre_tier in ('operacional', 'abaixo_da_linha', 'transferencia')),
  dre_group text not null,
  nature text not null check (nature in ('receita', 'despesa', 'transferencia')),
  -- Equipe só existe para mão de obra; é o recorte que substitui a tentativa
  -- de centro de custo por setor (decisão 4).
  team text check (team in ('producao', 'balcao', 'expedicao', 'administrativo')),
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint finance_categories_transfer_tier check (
    (nature = 'transferencia') = (dre_tier = 'transferencia')
  )
);

-- ---------------------------------------------------------------------------
-- Contas: bancos e caixas físicos. O caixa da loja é conta como qualquer
-- banco (decisão 7) — senão o dinheiro que paga fornecedor some do DRE.
-- ---------------------------------------------------------------------------
create table if not exists public.finance_accounts (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  kind text not null check (kind in ('banco', 'caixa')),
  store text check (store in ('jc', 'ja')),
  -- CNPJ é informativo (decisão de arquitetura: ERP gerencial, não fiscal).
  cnpj_label text,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint finance_accounts_cash_needs_store check (kind <> 'caixa' or store is not null)
);

-- ---------------------------------------------------------------------------
-- Lançamentos: o livro-caixa.
-- ---------------------------------------------------------------------------
create table if not exists public.finance_entries (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  entry_type text not null default 'lancamento' check (entry_type in ('lancamento', 'estorno')),
  category_id uuid not null references public.finance_categories(id),
  account_id uuid not null references public.finance_accounts(id),
  -- 'geral' é custo compartilhado explícito, não uma terceira loja (decisão 2).
  store text not null check (store in ('jc', 'ja', 'geral')),
  -- Competência: o mês em que o lançamento pesa no DRE (decisão 6).
  competence_month date not null check (competence_month = date_trunc('month', competence_month)::date),
  -- Previsto e realizado convivem sempre (decisão 6). No avulso os dois nascem
  -- iguais; a recorrência da fase 2 é quem os separa de verdade.
  due_date date not null,
  planned_amount numeric(12,2) not null check (planned_amount > 0),
  paid_date date not null,
  amount numeric(12,2) not null check (amount > 0 and amount <= 1000000),
  payment_method text not null check (payment_method in ('dinheiro', 'pix', 'transferencia', 'boleto', 'cartao', 'debito_automatico', 'outro')),
  description text not null check (length(trim(description)) >= 3),
  -- Origem: nesta fase só 'avulso'. As fases 1, 2 e 3 acrescentam as origens
  -- automáticas (conta a pagar, recorrência, fechamento de caixa).
  source text not null default 'avulso' check (source in ('avulso')),
  reversal_of uuid references public.finance_entries(id),
  reversal_reason text,
  reversed_at timestamptz,
  reversed_by uuid references auth.users(id),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint finance_entries_reversal_shape check (
    (entry_type = 'estorno') = (reversal_of is not null)
    and (entry_type = 'estorno') = (nullif(trim(coalesce(reversal_reason, '')), '') is not null)
  ),
  constraint finance_entries_no_self_reversal check (reversal_of is null or reversal_of <> id)
);

-- Um estorno por lançamento: a segunda tentativa esbarra aqui, mesmo em
-- chamadas simultâneas.
create unique index if not exists finance_entries_one_reversal_idx
  on public.finance_entries (reversal_of)
  where reversal_of is not null;

create index if not exists finance_entries_competence_idx
  on public.finance_entries (competence_month desc, created_at desc);
create index if not exists finance_entries_category_idx
  on public.finance_entries (category_id, competence_month desc);
create index if not exists finance_entries_store_idx
  on public.finance_entries (store, competence_month desc);

-- ---------------------------------------------------------------------------
-- Privilégios: nada de escrita direta. Toda gravação passa pelas funções.
-- ---------------------------------------------------------------------------
revoke all on table public.finance_categories from anon, authenticated;
revoke all on table public.finance_accounts from anon, authenticated;
revoke all on table public.finance_entries from anon, authenticated;

create or replace function private.current_user_can_finance(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.app_profiles profile
    where profile.user_id = (select auth.uid())
      and profile.active
      and (
        profile.role = 'admin'
        or exists (
          select 1
          from public.app_user_permissions assignment
          where assignment.user_id = profile.user_id
            and assignment.permission_key = p_permission
        )
      )
  );
$$;

-- Escopo por loja. 'geral' é dado da empresa inteira: exige escopo global,
-- nunca a concessão de uma loja só.
create or replace function private.current_user_can_finance_store(p_permission text, p_store text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.app_profiles profile
    where profile.user_id = (select auth.uid())
      and profile.active
      and (
        profile.role = 'admin'
        or exists (
          select 1
          from public.app_user_permissions assignment
          where assignment.user_id = profile.user_id
            and assignment.permission_key = p_permission
            and (
              assignment.scope = '*'
              or (p_store <> 'geral' and assignment.scope = p_store)
            )
        )
      )
  );
$$;

revoke all on function private.current_user_can_finance(text) from public;
revoke all on function private.current_user_can_finance_store(text, text) from public;
grant execute on function private.current_user_can_finance(text) to authenticated;
grant execute on function private.current_user_can_finance_store(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Plano de categorias (anexo de docs/FINANCEIRO.md).
-- ---------------------------------------------------------------------------
insert into public.finance_categories (key, label, dre_tier, dre_group, nature, team, sort_order)
values
  ('venda_balcao',            'Venda balcão',                  'operacional',     'receita',      'receita',       null,             10),
  ('ifood',                   'iFood',                         'operacional',     'receita',      'receita',       null,             20),
  ('clientes_pj',             'Clientes PJ',                   'operacional',     'receita',      'receita',       null,             30),
  ('buck_ex',                 'Buck (EX)',                     'operacional',     'receita',      'receita',       null,             40),
  ('outras_receitas',         'Outras receitas',               'operacional',     'receita',      'receita',       null,             50),
  ('cmv_materia_prima',       'CMV — Matéria-prima',           'operacional',     'cmv',          'despesa',       null,            110),
  ('cmv_embalagem',           'CMV — Embalagem',               'operacional',     'cmv',          'despesa',       null,            120),
  ('cmv_revenda',             'CMV — Revenda',                 'operacional',     'cmv',          'despesa',       null,            130),
  ('mao_obra_producao',       'Mão de obra — Produção',        'operacional',     'mao_de_obra',  'despesa',       'producao',      210),
  ('mao_obra_balcao_jc',      'Mão de obra — Balcão JC',       'operacional',     'mao_de_obra',  'despesa',       'balcao',        220),
  ('mao_obra_balcao_ja',      'Mão de obra — Balcão JA',       'operacional',     'mao_de_obra',  'despesa',       'balcao',        230),
  ('mao_obra_expedicao',      'Mão de obra — Expedição',       'operacional',     'mao_de_obra',  'despesa',       'expedicao',     240),
  ('mao_obra_administrativo', 'Mão de obra — Administrativo',  'operacional',     'mao_de_obra',  'despesa',       'administrativo',250),
  ('mao_obra_encargos',       'Mão de obra — Encargos',        'operacional',     'mao_de_obra',  'despesa',       null,            260),
  ('mao_obra_diarias',        'Mão de obra — Diárias e extras','operacional',     'mao_de_obra',  'despesa',       null,            270),
  ('ocupacao',                'Ocupação',                      'operacional',     'ocupacao',     'despesa',       null,            310),
  ('impostos',                'Impostos',                      'operacional',     'impostos',     'despesa',       null,            320),
  ('taxas_cartao_apps',       'Taxas de cartão e apps',        'operacional',     'taxas',        'despesa',       null,            330),
  ('manutencao',              'Manutenção',                    'operacional',     'manutencao',   'despesa',       null,            340),
  ('servicos_terceiros',      'Serviços de terceiros',         'operacional',     'servicos',     'despesa',       null,            350),
  ('financeiras',             'Financeiras',                   'operacional',     'financeiras',  'despesa',       null,            360),
  ('outras_despesas',         'Outras despesas',               'operacional',     'outras',       'despesa',       null,            370),
  ('emprestimos',             'Empréstimos',                   'abaixo_da_linha', 'emprestimos',  'despesa',       null,            410),
  ('equipamento',             'Equipamento / investimento',    'abaixo_da_linha', 'investimento', 'despesa',       null,            420),
  ('retiradas_distribuicao',  'Retiradas — distribuição',      'abaixo_da_linha', 'retiradas',    'despesa',       null,            430),
  ('transferencia',           'Transferência entre contas',    'transferencia',   'transferencia','transferencia', null,            510)
on conflict (key) do update set
  label = excluded.label,
  dre_tier = excluded.dre_tier,
  dre_group = excluded.dre_group,
  nature = excluded.nature,
  team = excluded.team,
  sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- Contas. A conta digital do Bling não entra: ela morre junto com o Bling.
-- ---------------------------------------------------------------------------
insert into public.finance_accounts (key, label, kind, store, cnpj_label, sort_order)
values
  ('caixa_fisico_jc', 'Caixa físico JC',   'caixa', 'jc', 'RGE Pane e Pizza',  10),
  ('caixa_fisico_ja', 'Caixa físico JA',   'caixa', 'ja', 'SF Salute',         20),
  ('banco_caixa_jc',  'Caixa (banco) JC',  'banco', null, 'RGE Pane e Pizza', 110),
  ('banco_sicredi_jc','Sicredi JC',        'banco', null, 'RGE Pane e Pizza', 120),
  ('banco_sicoob_jc', 'Sicoob JC',         'banco', null, 'RGE Pane e Pizza', 130),
  ('banco_nubank_jc', 'Nubank JC',         'banco', null, 'RGE Pane e Pizza', 140),
  ('banco_caixa_ja',  'Caixa (banco) JA',  'banco', null, 'SF Salute',        210),
  ('banco_sicredi_ja','Sicredi JA',        'banco', null, 'SF Salute',        220),
  ('banco_sicoob_ja', 'Sicoob JA',         'banco', null, 'SF Salute',        230),
  ('banco_ifood',     'Conta digital iFood','banco', null, 'Pane e Salute',   310)
on conflict (key) do update set
  label = excluded.label,
  kind = excluded.kind,
  store = excluded.store,
  cnpj_label = excluded.cnpj_label,
  sort_order = excluded.sort_order;

-- Perfis financeiros ativos recebem o escopo global: o livro cobre a empresa
-- inteira, incluindo os lançamentos 'geral'.
insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
select profile.user_id, permission.key, '*', null::uuid
from public.app_profiles profile
cross join public.app_permissions permission
where profile.active
  and profile.role = 'financeiro'
  and permission.key in ('financeiro.acessar', 'financeiro.lancar', 'financeiro.estornar')
on conflict (user_id, permission_key, scope) do nothing;

-- ---------------------------------------------------------------------------
-- Ações protegidas.
-- ---------------------------------------------------------------------------
create or replace function public.create_finance_entry(
  p_request_id uuid,
  p_category_key text,
  p_account_key text,
  p_store text,
  p_amount numeric,
  p_paid_date date,
  p_payment_method text,
  p_description text,
  p_competence_month date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry_id uuid;
  v_category record;
  v_account record;
  v_paid_date date;
  v_competence date;
  v_amount numeric(12,2);
begin
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'Identificador do lançamento obrigatório.';
  end if;

  -- Idempotência: repetir a mesma requisição devolve o mesmo lançamento em vez
  -- de duplicar ou estourar erro de unicidade.
  select existing.id into v_entry_id
  from public.finance_entries existing
  where existing.request_id = p_request_id;
  if v_entry_id is not null then
    return v_entry_id;
  end if;

  if p_store is null or p_store not in ('jc', 'ja', 'geral') then
    raise exception using errcode = '22023', message = 'Escolha a loja do lançamento (JC, JA ou geral).';
  end if;

  if not private.current_user_can_finance_store('financeiro.lancar', p_store) then
    raise exception using errcode = '42501', message = 'Sem permissão para lançar no financeiro desta loja.';
  end if;

  select category.* into v_category
  from public.finance_categories category
  where category.key = p_category_key and category.active;
  if v_category.id is null then
    raise exception using errcode = '22023', message = 'Categoria inválida ou inativa.';
  end if;
  if v_category.nature = 'transferencia' then
    raise exception using errcode = '22023', message = 'Transferência entre contas ainda não é lançada por aqui.';
  end if;

  select account.* into v_account
  from public.finance_accounts account
  where account.key = p_account_key and account.active;
  if v_account.id is null then
    raise exception using errcode = '22023', message = 'Conta inválida ou inativa.';
  end if;
  if v_account.kind = 'caixa' and p_store <> 'geral' and v_account.store <> p_store then
    raise exception using errcode = '22023', message = 'O caixa físico escolhido é de outra loja.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception using errcode = '22023', message = 'Informe um valor maior que zero.';
  end if;
  v_amount := round(p_amount, 2);
  if v_amount > 1000000 then
    raise exception using errcode = '22023', message = 'Valor acima do limite permitido. Confira o que foi digitado.';
  end if;

  v_paid_date := coalesce(p_paid_date, current_date);
  if v_paid_date > current_date + 1 then
    raise exception using errcode = '22023', message = 'A data do lançamento não pode ser no futuro.';
  end if;
  if v_paid_date < date '2020-01-01' then
    raise exception using errcode = '22023', message = 'Data do lançamento muito antiga. Confira o que foi digitado.';
  end if;

  v_competence := date_trunc('month', coalesce(p_competence_month, v_paid_date))::date;
  if v_competence > (date_trunc('month', current_date) + interval '1 month')::date then
    raise exception using errcode = '22023', message = 'Mês de competência muito à frente.';
  end if;

  if p_payment_method is null or p_payment_method not in
     ('dinheiro', 'pix', 'transferencia', 'boleto', 'cartao', 'debito_automatico', 'outro') then
    raise exception using errcode = '22023', message = 'Forma de pagamento inválida.';
  end if;

  if nullif(trim(coalesce(p_description, '')), '') is null or length(trim(p_description)) < 3 then
    raise exception using errcode = '22023', message = 'Descreva o lançamento com pelo menos 3 letras.';
  end if;

  insert into public.finance_entries (
    request_id, entry_type, category_id, account_id, store, competence_month,
    due_date, planned_amount, paid_date, amount, payment_method, description,
    source, created_by
  )
  values (
    p_request_id, 'lancamento', v_category.id, v_account.id, p_store, v_competence,
    v_paid_date, v_amount, v_paid_date, v_amount, p_payment_method, trim(p_description),
    'avulso', (select auth.uid())
  )
  returning id into v_entry_id;

  return v_entry_id;
end;
$$;

create or replace function public.reverse_finance_entry(
  p_request_id uuid,
  p_entry_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reversal_id uuid;
  v_original record;
begin
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'Identificador do estorno obrigatório.';
  end if;

  select existing.id into v_reversal_id
  from public.finance_entries existing
  where existing.request_id = p_request_id;
  if v_reversal_id is not null then
    return v_reversal_id;
  end if;

  if nullif(trim(coalesce(p_reason, '')), '') is null or length(trim(p_reason)) < 3 then
    raise exception using errcode = '22023', message = 'Informe o motivo do estorno.';
  end if;

  select entry.* into v_original
  from public.finance_entries entry
  where entry.id = p_entry_id
  for update;
  if v_original.id is null then
    raise exception using errcode = 'P0002', message = 'Lançamento não encontrado.';
  end if;

  if not private.current_user_can_finance_store('financeiro.estornar', v_original.store) then
    raise exception using errcode = '42501', message = 'Sem permissão para estornar lançamentos desta loja.';
  end if;

  if v_original.entry_type = 'estorno' then
    raise exception using errcode = '22023', message = 'Um estorno não pode ser estornado.';
  end if;
  if v_original.reversed_at is not null then
    raise exception using errcode = '22023', message = 'Este lançamento já foi estornado.';
  end if;

  -- O contra-lançamento repete o fato ao contrário e fica ligado ao original;
  -- o original permanece intacto no livro.
  insert into public.finance_entries (
    request_id, entry_type, category_id, account_id, store, competence_month,
    due_date, planned_amount, paid_date, amount, payment_method, description,
    source, reversal_of, reversal_reason, created_by
  )
  values (
    p_request_id, 'estorno', v_original.category_id, v_original.account_id, v_original.store,
    v_original.competence_month, v_original.due_date, v_original.planned_amount,
    current_date, v_original.amount, v_original.payment_method,
    'Estorno de: ' || v_original.description,
    v_original.source, v_original.id, trim(p_reason), (select auth.uid())
  )
  returning id into v_reversal_id;

  update public.finance_entries
  set reversed_at = now(),
      reversed_by = (select auth.uid()),
      reversal_reason = trim(p_reason)
  where id = v_original.id;

  return v_reversal_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS: leitura por permissão; escrita nenhuma (só pelas funções acima).
-- ---------------------------------------------------------------------------
alter table public.finance_categories enable row level security;
alter table public.finance_categories force row level security;
alter table public.finance_accounts enable row level security;
alter table public.finance_accounts force row level security;
alter table public.finance_entries enable row level security;
alter table public.finance_entries force row level security;

create policy finance_categories_select_finance
on public.finance_categories for select to authenticated
using (private.current_user_can_finance('financeiro.acessar'));

create policy finance_accounts_select_finance
on public.finance_accounts for select to authenticated
using (private.current_user_can_finance('financeiro.acessar'));

create policy finance_entries_select_finance
on public.finance_entries for select to authenticated
using (private.current_user_can_finance_store('financeiro.acessar', store));

grant select on public.finance_categories to authenticated;
grant select on public.finance_accounts to authenticated;
grant select on public.finance_entries to authenticated;

revoke all on function public.create_finance_entry(uuid, text, text, text, numeric, date, text, text, date) from public;
revoke all on function public.reverse_finance_entry(uuid, uuid, text) from public;
grant execute on function public.create_finance_entry(uuid, text, text, text, numeric, date, text, text, date) to authenticated;
grant execute on function public.reverse_finance_entry(uuid, uuid, text) to authenticated;

commit;
