import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function migration(name: string): string {
  return readFileSync(resolve(process.cwd(), 'supabase/migrations', name), 'utf8')
    .replace(/\r\n/g, '\n')
    .toLowerCase()
}

// Compras e cotações não entram mais neste pacote: a migration
// `freeze_legacy_compras_cotacoes`, já na main, revogou o acesso a essas
// tabelas. As antigas `harden_purchase_tables`/`harden_procurement_tables`
// reabririam o que o freeze fechou, então foram descartadas.
const prepare = migration('20260718214305_prepare_authenticated_operational_calls.sql')
const operational = migration('20260718214827_harden_operational_table_access.sql')
const defaults = migration('20260718214909_assert_anon_hardening_and_revoke_defaults.sql')

const quotationPage = readFileSync(
  resolve(process.cwd(), 'src/app/cotacoes/detalhe/page.tsx'),
  'utf8',
)
const discountPage = readFileSync(
  resolve(process.cwd(), 'src/app/simulador-desconto/page.tsx'),
  'utf8',
)
const leftoversPage = readFileSync(
  resolve(process.cwd(), 'src/app/sobras/page.tsx'),
  'utf8',
)

describe('hardening das tabelas operacionais', () => {
  it('revoga anon e authenticated antes de conceder os verbos mínimos das tabelas', () => {
    const tables = [
      'orders',
      'breads',
      'bread_movements',
      'frozen_movements',
      'shelf_counts',
      'product_components',
    ]

    tables.forEach(table => {
      expect(operational).toContain(
        `revoke all on table public.${table} from public, anon, authenticated;`,
      )
      expect(operational).toContain(`grant all on table public.${table} to service_role;`)
    })
  })

  it('não recria policy de escrita para anon ou public', () => {
    expect(operational).not.toMatch(
      /create\s+policy[\s\S]*?for\s+(insert|update|delete|all)[\s\S]*?to\s+(anon|public)/,
    )
    expect(defaults).toContain("'anon' = any(policy.roles)")
    expect(defaults).toContain("'public' = any(policy.roles)")
  })

  it('limita cada tabela aos verbos usados pela aplicação', () => {
    expect(operational).toContain(
      'grant select, insert, delete on table public.bread_movements to authenticated;',
    )
    expect(operational).toContain(
      'grant select, insert on table public.frozen_movements to authenticated;',
    )
    expect(operational).toContain(
      'grant select, insert, update on table public.shelf_counts to authenticated;',
    )
  })

  it('amarra as escritas operacionais a permissão, perfil e conteúdo esperado', () => {
    expect(operational).toContain('bread_movements_insert_discard_permission')
    expect(operational).toContain("movement_type = 'descarte_loja'")
    expect(operational).toContain("reference_type in ('descarte', 'descarte_kit')")
    expect(operational).toContain('discard_row.responsible = profile.display_name')
    expect(operational).toContain(
      "private.current_user_has_permission('sobras.acessar', profile.store)",
    )
    expect(operational).toContain('frozen_movements_insert_permission')
    expect(operational).toContain('responsible = profile.display_name')
    expect(operational).toContain('shelf_counts_update_permission')
    expect(operational).toContain('counted_by = profile.display_name')
  })
})

describe('rollout autenticado', () => {
  it('prepara uma RPC estreita antes de retirar o UPDATE amplo em breads', () => {
    expect(prepare).toContain(
      'insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)',
    )
    expect(prepare).toContain("coalesce(profile.allowed_routes, '[]'::jsonb) ? mapping.route")
    expect(prepare).not.toContain('profile.display_name')
    expect(prepare).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/,
    )
    expect(prepare).toContain('create or replace function public.mark_bread_for_shelf')
    expect(prepare).toContain('security definer')
    expect(prepare).toContain("private.current_user_has_permission('sobras.acessar', v_scope)")
    expect(prepare).toContain(
      'revoke all on function public.mark_bread_for_shelf(text) from public, anon, authenticated;',
    )
    expect(prepare).toContain(
      'grant execute on function public.mark_bread_for_shelf(text) to authenticated;',
    )
    expect(leftoversPage).toContain("supabase.rpc('mark_bread_for_shelf'")
    expect(leftoversPage).not.toContain("supabase.from('breads').update({ is_shelf: true })")
  })

  it('envia a sessão do usuário nas Edge Functions em vez da chave anon como bearer', () => {
    expect(quotationPage).toContain("supabase.functions.invoke<{ items?: ParsedItem[] }>('parse-cotacao'")
    expect(discountPage).toContain(
      "supabase.functions.invoke<{ analysis?: string; error?: string }>('analisar-desconto'",
    )

    ;[quotationPage, discountPage].forEach(source => {
      expect(source).not.toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY')
      expect(source).not.toContain('/functions/v1/')
      expect(source).not.toMatch(/authorization.+bearer.+sb_key/i)
    })
  })

  it('fecha os grants padrão futuros e aborta se restar escrita anônima', () => {
    expect(defaults).toContain(
      'alter default privileges for role postgres in schema public',
    )
    expect(defaults).not.toContain('alter default privileges for role supabase_admin')
    expect(defaults).toContain(
      "grant_entry.privilege_type in (\n        'insert',\n        'update',\n        'delete',",
    )
    expect(defaults).toContain(
      'hardening incompleto: ainda existe grant de escrita para anon em public.',
    )
    expect(defaults).toContain(
      'hardening incompleto: ainda existe policy de escrita aplicavel a anon em public.',
    )
  })
})
