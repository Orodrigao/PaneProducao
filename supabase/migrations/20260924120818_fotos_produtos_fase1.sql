-- Fundação da foto principal: o arquivo é privado, tem caminho imutável e o
-- vínculo só muda pelas portas que conferem a permissão explícita.

insert into public.app_permissions (key, module, label, description, sort_order)
values (
  'catalogo.gerenciar_fotos',
  'Catálogo',
  'Gerenciar fotos de produtos',
  'Adicionar, substituir ou remover a foto principal de um produto.',
  120
)
on conflict (key) do update set
  module = excluded.module,
  label = excluded.label,
  description = excluded.description,
  sort_order = excluded.sort_order
where (app_permissions.module, app_permissions.label, app_permissions.description, app_permissions.sort_order)
  is distinct from (excluded.module, excluded.label, excluded.description, excluded.sort_order);

create table public.product_photos (
  product_id uuid primary key references public.products(id) on delete cascade,
  storage_path text not null unique,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  constraint product_photos_storage_path_check check (
    storage_path ~ (
      '^products/' || product_id::text ||
      '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$'
    )
  )
);

create table private.product_photo_audit (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null,
  action text not null check (action in ('add', 'replace', 'remove')),
  old_storage_path text,
  new_storage_path text,
  actor_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint product_photo_audit_change_check check (
    (action = 'add' and old_storage_path is null and new_storage_path is not null)
    or (action = 'replace' and old_storage_path is not null and new_storage_path is not null)
    or (action = 'remove' and old_storage_path is not null and new_storage_path is null)
  )
);

alter table public.product_photos enable row level security;
alter table public.product_photos force row level security;
alter table private.product_photo_audit enable row level security;
alter table private.product_photo_audit force row level security;

revoke all on table public.product_photos from public, anon, authenticated;
grant select on table public.product_photos to authenticated;
revoke all on table private.product_photo_audit from public, anon, authenticated;

create policy product_photos_select_active_profiles on public.product_photos
for select to authenticated
using (
  exists (
    select 1
    from public.app_profiles profile
    where profile.user_id = (select auth.uid())
      and profile.active
  )
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-photos', 'product-photos', false, 524288, array['image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- A fase de tela deve decodificar e reencodar a imagem antes do upload. A
-- lista de MIME e o metadado do Storage não substituem essa validação binária.

create policy product_photos_files_select_active_profiles on storage.objects
for select to authenticated
using (
  bucket_id = 'product-photos'
  and exists (
    select 1
    from public.app_profiles profile
    where profile.user_id = (select auth.uid())
      and profile.active
  )
  and exists (
    select 1
    from public.product_photos photo
    where photo.storage_path = storage.objects.name
  )
);

create policy product_photos_files_insert_photo_manager on storage.objects
for insert to authenticated
with check (
  bucket_id = 'product-photos'
  and (select private.current_user_has_permission('catalogo.gerenciar_fotos', '*'))
  and name ~ '^products/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$'
  and not exists (
    select 1
    from public.product_photos photo
    where photo.storage_path = storage.objects.name
  )
);

create policy product_photos_files_delete_photo_manager on storage.objects
for delete to authenticated
using (
  bucket_id = 'product-photos'
  and (select private.current_user_has_permission('catalogo.gerenciar_fotos', '*'))
  and owner_id::text = (select auth.uid())::text
  and name ~ '^products/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$'
  and not exists (
    select 1
    from public.product_photos photo
    where photo.storage_path = storage.objects.name
  )
);

create function private.audit_product_photo_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.product_photo_audit (
    product_id, action, old_storage_path, new_storage_path, actor_id
  ) values (
    coalesce(new.product_id, old.product_id),
    case
      when tg_op = 'INSERT' then 'add'
      when tg_op = 'UPDATE' then 'replace'
      else 'remove'
    end,
    case when tg_op in ('UPDATE', 'DELETE') then old.storage_path end,
    case when tg_op in ('INSERT', 'UPDATE') then new.storage_path end,
    (select auth.uid())
  );
  return coalesce(new, old);
end;
$$;

create trigger product_photos_audit_change
after insert or update or delete on public.product_photos
for each row execute function private.audit_product_photo_change();

create function public.set_product_photo(p_product_id uuid, p_storage_path text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_previous_storage_path text;
begin
  if v_actor_id is null
    or not (select private.current_user_has_permission('catalogo.gerenciar_fotos', '*')) then
    raise exception using errcode = '42501', message = 'Sem permissão para gerenciar fotos de produtos.';
  end if;

  if p_storage_path is null
    or p_storage_path !~ (
      '^products/' || p_product_id::text ||
      '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$'
    ) then
    raise exception using errcode = '22023', message = 'Caminho da foto inválido para este produto.';
  end if;

  perform 1
  from public.products product
  where product.id = p_product_id
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'Produto não encontrado.';
  end if;

  select photo.storage_path
  into v_previous_storage_path
  from public.product_photos photo
  where photo.product_id = p_product_id;

  if not exists (
    select 1
    from storage.objects object
    where object.bucket_id = 'product-photos'
      and object.name = p_storage_path
      and object.owner_id::text = v_actor_id::text
      and coalesce(object.metadata ->> 'mimetype', '') = 'image/webp'
  ) then
    raise exception using errcode = '22023', message = 'A foto precisa ser enviada em WebP por quem fará a associação.';
  end if;

  if v_previous_storage_path is not distinct from p_storage_path then
    return null;
  end if;

  insert into public.product_photos (product_id, storage_path, created_by, updated_by)
  values (p_product_id, p_storage_path, v_actor_id, v_actor_id)
  on conflict (product_id) do update set
    storage_path = excluded.storage_path,
    updated_by = excluded.updated_by,
    updated_at = now()
  where product_photos.storage_path is distinct from excluded.storage_path;

  return v_previous_storage_path;
end;
$$;

create function public.clear_product_photo(p_product_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_storage_path text;
begin
  if (select auth.uid()) is null
    or not (select private.current_user_has_permission('catalogo.gerenciar_fotos', '*')) then
    raise exception using errcode = '42501', message = 'Sem permissão para gerenciar fotos de produtos.';
  end if;

  delete from public.product_photos
  where product_id = p_product_id
  returning storage_path into v_storage_path;

  if v_storage_path is null then
    raise exception using errcode = 'P0002', message = 'O produto não tem foto principal.';
  end if;

  return v_storage_path;
end;
$$;

revoke all on function private.audit_product_photo_change() from public, anon, authenticated;
revoke all on function public.set_product_photo(uuid, text) from public, anon;
grant execute on function public.set_product_photo(uuid, text) to authenticated;
revoke all on function public.clear_product_photo(uuid) from public, anon;
grant execute on function public.clear_product_photo(uuid) to authenticated;
