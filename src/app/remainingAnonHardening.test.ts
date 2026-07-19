import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migrationSource = readFileSync(
  new URL(
    '../../supabase/migrations/20260719133328_harden_remaining_erp_anon_tables.sql',
    import.meta.url,
  ),
  'utf8',
).toLowerCase()

const sobrasPageSource = readFileSync(
  new URL('./sobras/page.tsx', import.meta.url),
  'utf8',
).toLowerCase()

const erpTables = [
  'bread_movements',
  'breads',
  'frozen_movements',
  'orders',
  'product_components',
  'production_actuals',
  'shelf_counts',
]

describe('hardening das tabelas restantes do PaneERP', () => {
  it.each(erpTables)('revoga completamente o acesso anon de %s', table => {
    expect(migrationSource).toContain(
      `revoke all on table public.${table} from public, anon, authenticated`,
    )
  })

  it('remove todas as policies anon legadas conhecidas', () => {
    for (const table of erpTables) {
      for (const command of ['select', 'insert', 'update', 'delete']) {
        expect(migrationSource).toContain(
          `drop policy if exists anon_${command} on public.${table}`,
        )
      }
    }
  })

  it('nao mistura tabelas do ControlePizza na migration do ERP', () => {
    expect(migrationSource).not.toContain('public.pizza_')
  })

  it('falha a migration se algum acesso publico sobreviver', () => {
    expect(migrationSource).toContain("has_table_privilege(\n      'anon'")
    expect(migrationSource).toContain("'anon' = any(policy.roles)")
    expect(migrationSource).toContain("'public' = any(policy.roles)")
    expect(migrationSource).toContain(
      "raise exception 'hardening incompleto: anon ainda possui grant",
    )
  })

  it('mantem production_actuals somente para leitura direta autenticada', () => {
    expect(migrationSource).toContain(
      'grant select on table public.production_actuals to authenticated',
    )
    expect(migrationSource).not.toContain(
      'grant select, insert on table public.production_actuals to authenticated',
    )
  })

  it('restringe movimentos e contagens operacionais por rota e loja', () => {
    expect(migrationSource).toContain("coalesce(p.allowed_routes, '[]'::jsonb) ? '/sobras'")
    expect(migrationSource).toContain(
      'lower(p.store) = lower(public.bread_movements.location)',
    )
    expect(migrationSource).toContain(
      'lower(p.store) = lower(public.shelf_counts.store)',
    )
  })

  it('troca o update amplo de paes na tela por uma funcao autenticada e limitada', () => {
    expect(migrationSource).toContain(
      'create or replace function public.mark_bread_as_shelf',
    )
    expect(migrationSource).toContain(
      'revoke all on function public.mark_bread_as_shelf(text) from anon',
    )
    expect(sobrasPageSource).toContain(
      "supabase.rpc('mark_bread_as_shelf', { p_bread_id: b.id })",
    )
    expect(sobrasPageSource).not.toContain(
      "supabase.from('breads').update({ is_shelf: true })",
    )
  })
})
