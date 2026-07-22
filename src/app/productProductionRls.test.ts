import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migrationSource = readFileSync(
  new URL('../../docs/history/migrations-pre-baseline/20260718093517_corrigir_rls_producao_autenticada.sql', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n').toLowerCase()

describe('RLS da lista de produção de itens', () => {
  it('remove o acesso anônimo e concede o acesso de tabela ao usuário autenticado', () => {
    expect(migrationSource).toContain(
      'revoke all on table public.product_production from anon;',
    )
    expect(migrationSource).toContain(
      'grant select, insert, update, delete\non table public.product_production\nto authenticated;',
    )
    expect(migrationSource).toContain(
      'drop policy if exists anon_insert on public.product_production;',
    )
  })

  it('permite leitura para perfis ativos e escrita somente para administradores ativos', () => {
    expect(migrationSource).toContain(
      'create policy product_production_select_active_profiles',
    )
    expect(migrationSource).toContain(
      'create policy product_production_insert_admins',
    )
    expect(migrationSource).toContain(
      'create policy product_production_update_admins',
    )
    expect(migrationSource).toContain(
      'create policy product_production_delete_admins',
    )
    expect(migrationSource).toContain('and p.active')
    expect(migrationSource).toContain("and p.role = 'admin'")
  })
})
