import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'docs/history/migrations-pre-baseline/20260718203439_romaneio_permissoes_granulares.sql'),
  'utf8',
).toLowerCase()

describe('migration de permissões do Romaneio', () => {
  it('cria ações granulares e escopo por destino', () => {
    expect(migration).toContain("'romaneio.visualizar'")
    expect(migration).toContain("'romaneio.confirmar_saida'")
    expect(migration).toContain("'romaneio.conferir_recebimento'")
    expect(migration).toContain('private.current_user_has_permission')
  })

  it('protege saída e recebimento com funções transacionais autenticadas', () => {
    expect(migration).toContain('create or replace function public.confirm_romaneio_departure')
    expect(migration).toContain('create or replace function public.confirm_romaneio_receipt')
    expect(migration).toContain('for update of romaneio')
    expect(migration).toContain('grant execute on function public.confirm_romaneio_departure(uuid) to authenticated')
    expect(migration).toContain('revoke all on function public.confirm_romaneio_departure(uuid) from public, anon')
  })

  it('remove a policy que autorizava por cargo ou loja', () => {
    expect(migration).toContain('drop policy if exists romaneios_manage_route_store')
    expect(migration).toContain('drop policy if exists romaneio_items_manage_route_store')
  })
})
